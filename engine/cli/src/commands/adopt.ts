import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { readVersions } from "../hydrate.js";
import { refuse, say } from "../output.js";
import { assetsRoot } from "../selection.js";

const isFile = (path: string) => stat(path).then((info) => info.isFile(), () => false);

/** §11.11's shapes: `SKILL.md` → skill; `CONTEXT.md` → context; `ENVIRONMENT.md` → environment; executable `run` → tool; one `.md` → memory. */
async function inferKind(dir: string): Promise<string | undefined> {
	if (await isFile(join(dir, "SKILL.md"))) return "skill";
	if (await isFile(join(dir, "CONTEXT.md"))) return "context";
	if (await isFile(join(dir, "ENVIRONMENT.md"))) return "environment";
	if (await isFile(join(dir, "run"))) return "tool";
	const entries = await readdir(dir).catch(() => []);
	if (entries.filter((name) => name.toLowerCase().endsWith(".md")).length === 1) return "memory";
	return undefined;
}

/**
 * §11.11 (D114) without the printing, so the exit review can adopt what the
 * agent made through the same code (§10.0 step 4). Mints a sidecar only when
 * the directory has none; `newId` mints one regardless, and is the remedy for
 * an id collision and for 02 D46. `hint` is the kind the caller already knows —
 * the exit review's directory is at `<kind>/<name>`, so its path is a better
 * answer than the shape is. No git operation: the next `run`/`pull` converges
 * it. Returns the key it settled on.
 */
export async function adoptDir(path: string, newId: boolean, kinds: string[], hint?: string): Promise<string> {
	const from = resolve(path);
	const sidecarPath = join(from, "asset.json");
	const existing = await readFile(sidecarPath, "utf8").then((text) => JSON.parse(text) as { id?: string; kind?: string }, () => undefined);

	let kind = existing?.kind ?? hint ?? (await inferKind(from));
	if (kind === undefined) {
		if (stdin.isTTY !== true) refuse("cli.kind_unknown", `Cannot tell what ${basename(from)} is.`, `Say the kind: one of ${kinds.join(", ")}.`);
		const rl = createInterface({ input: stdin, output: stdout });
		kind = (await rl.question(`What kind is this? (${kinds.join(", ")}) `).finally(() => rl.close())).trim();
	}
	if (!kinds.includes(kind)) {
		refuse("cli.kind_unknown", `"${kind}" is not a kind your organization uses. Kinds: ${kinds.join(", ")}.`, "—");
	}

	// An id already on the chain is a same-path-different-id conflict waiting to
	// happen, so it is refused here rather than at pre-receive (D3).
	const onChain = new Set(Object.values(await readVersions("refs/harness/remote")).map((one) => one.id));
	let id = existing?.id;
	if (!newId && id !== undefined && onChain.has(id)) {
		const clash = Object.entries(await readVersions("refs/harness/remote")).find(([, one]) => one.id === id);
		refuse("cli.id_collision", `${path} carries the id of ${clash?.[0] ?? "an asset"}, which already exists.`, `harness adopt --new-id ${path}`);
	}
	if (newId || id === undefined) id = randomUUID();

	const name = basename(from);
	const target = join(assetsRoot(), kind, name);
	await mkdir(join(assetsRoot(), kind), { recursive: true, mode: 0o700 });
	if (target !== from) await rename(from, target);
	await writeFile(join(target, "asset.json"), `${JSON.stringify({ id, kind }, null, 2)}\n`, { mode: 0o600 });
	return `${kind}/${name}`;
}

/** §11.11 as the command: the same work, and the one line it prints. */
/** A directory already placed under `<assetsRoot>/<kind>/` names its kind by
    where it is (07 §6a) — the exit review's printed `adopt` lines point there. */
function kindFromPlacement(path: string): string | undefined {
	const rel = relative(assetsRoot(), resolve(path));
	const [kind, name, ...rest] = rel.split(sep);
	return kind && name && rest.length === 0 && !rel.startsWith("..") ? kind : undefined;
}

export async function adopt(path: string, newId: boolean, kinds: string[]): Promise<number> {
	const key = await adoptDir(path, newId, kinds, kindFromPlacement(path));
	say(`Adopted \`${key}\`. \`harness push ${key} --message "…"\` to keep it.`);
	return 0;
}
