import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { assetsRoot, frontmatterName } from "./core.js";
import { differs, ensureRepo, g, worktreeTree } from "./git.js";

const isFile = async (path: string) =>
	stat(path).then(
		(info) => info.isFile(),
		() => false,
	);

/**
 * An asset's kind and name.
 *
 * Inside the work tree the layout already says both — assets live at
 * `<kind>/<name>/` — so nothing is guessed and any kind works, including ones
 * added after this code was written. Outside it, the shape is inspected, which
 * is only needed by `adopt` on a directory the user made somewhere else.
 */
export async function identify(path: string): Promise<{ kind: string; name: string }> {
	const relative_ = relative(assetsRoot(), resolve(path));
	if (relative_ && !relative_.startsWith("..")) {
		const [kind, name] = relative_.split("/");
		if (kind && name) return { kind, name };
	}
	const info = await stat(path);
	if (info.isDirectory()) {
		if (await isFile(join(path, "SKILL.md"))) {
			return {
				kind: "skill",
				name: frontmatterName(await readFile(join(path, "SKILL.md"), "utf8"), basename(path)),
			};
		}
		if (await isFile(join(path, "run"))) {
			const doc = await readFile(join(path, "TOOL.md"), "utf8").catch(() => "");
			return { kind: "tool", name: doc ? frontmatterName(doc, basename(path)) : basename(path) };
		}
		throw new Error(
			`Cannot tell what ${basename(path)} is. Move it under ${assetsRoot()}/<kind>/<name>/, ` +
				"or give it SKILL.md (skill) or an executable run (tool).",
		);
	}
	if (extname(path).toLowerCase() === ".md") {
		return { kind: "memory", name: frontmatterName(await readFile(path, "utf8"), basename(path, extname(path))) };
	}
	throw new Error("Push a directory under the assets work tree, or one Markdown memory file.");
}

/**
 * Records the push on the user's own branch. Bookkeeping for them, never read
 * by us. Assets pushed from outside the work tree simply have no local
 * history; the server already has the version either way.
 */
export async function record(path: string, message: string): Promise<void> {
	const key = relative(assetsRoot(), resolve(path));
	if (!key || key.startsWith("..")) return;
	await ensureRepo();
	await g("add", "--", key);
	await g("commit", "--allow-empty", "-m", message, "--", key);
}

const REMOTE = "refs/harness/remote";

interface Delivered {
	seq?: number;
	shadows?: { seq?: number } | null;
}

async function remoteRef(): Promise<string | undefined> {
	return g("rev-parse", "--verify", "--quiet", `${REMOTE}^{commit}`).catch(() => undefined);
}

async function deliveredVersions(remote: string | undefined): Promise<Record<string, Delivered>> {
	if (!remote) return {};
	return g("show", `${remote}:versions.json`)
		.then((text) => JSON.parse(text) as Record<string, Delivered>)
		.catch(() => ({}));
}

/**
 * What the user has, compared to what the team last delivered. No network: the
 * answer is entirely in the work tree and the remote ref.
 */
export async function status(): Promise<number> {
	await ensureRepo();
	const remote = await remoteRef();
	const versions = await deliveredVersions(remote);
	const keys = Object.keys(versions).sort();
	if (keys.length === 0) {
		console.log("No team assets yet. Run `harness run` to receive them.");
		return 0;
	}
	const work = await worktreeTree();
	for (const key of keys) {
		const modified = await differs(work, remote, key);
		const shadowSeq = versions[key]?.shadows?.seq;
		const labels = [modified ? "modified" : "clean"];
		if (shadowSeq !== undefined) labels.push(`override (team at v${shadowSeq})`);
		console.log(`${key.padEnd(32)} ${labels.join("  ")}`);
	}
	return 0;
}

/** Throws away local changes to one asset and takes the delivered copy. */
export async function reset(args: string[]): Promise<number> {
	const yes = args.includes("--yes");
	const key = args.find((arg) => !arg.startsWith("-"));
	if (!key) throw new Error("Usage: harness reset <kind>/<name> [--yes]");
	await ensureRepo();
	const remote = await remoteRef();
	if (!remote) throw new Error("Nothing has been delivered yet, so there is nothing to reset to.");
	if (!yes) {
		if (!process.stdin.isTTY) throw new Error(`This discards your changes to ${key}. Re-run with --yes.`);
		const { createInterface } = await import("node:readline/promises");
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		const answer = await rl.question(`Discard your changes to ${key}? [y/N] `);
		rl.close();
		if (answer.trim().toLowerCase() !== "y") return 1;
	}
	await rm(join(assetsRoot(), key), { recursive: true, force: true });
	await g("checkout", remote, "--", key);
	console.log(`Reset ${key} to the team's version.`);
	return 0;
}

/** Moves a directory the user made by hand into the work tree. */
export async function adopt(args: string[]): Promise<number> {
	const source = args[0];
	if (!source) throw new Error("Usage: harness adopt <path>");
	const from = resolve(source);
	const { kind, name } = await identify(from);
	const target = join(assetsRoot(), kind, name);
	await mkdir(join(assetsRoot(), kind), { recursive: true, mode: 0o700 });
	await rename(from, target);
	console.log(`Adopted ${kind}/${name}. Run \`harness push ${target} --message "..."\` to share it.`);
	return 0;
}
