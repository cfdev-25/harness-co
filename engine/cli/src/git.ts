import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Chain } from "@harness/compose/contracts";
import { assetsGitDir, assetsRoot } from "./selection.js";
import { refuse } from "./output.js";

const exec = promisify(execFile);

/** git's own id for "no entries at all" — the base tree of a first push. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Every git invocation goes through here, and every one carries the same flags
 * (C30, S6). Two of them are security controls, not conveniences:
 *
 *  - The git directory lives outside the work tree, and the work tree is
 *    writable from inside the jail. Refs and objects therefore are not.
 *  - `core.hooksPath=/dev/null` because the supervisor runs git *outside* the
 *    jail, as the person. A hook the agent planted would otherwise execute with
 *    their full privilege on the next commit. `-c` on the command line beats
 *    any config the agent could write.
 */
export async function g(...args: string[]): Promise<string> {
	return gAt(assetsRoot(), ...args);
}

/** As `g`, but against a scratch work tree. Objects still land in the real store. */
export async function gAt(workTree: string, ...args: string[]): Promise<string> {
	return raw(workTree, [], args);
}

/**
 * The two network verbs, and the only place the login token appears. D24a: it
 * rides on the command line as a header and is **never** written to
 * `assets.git/config`, because reads inside the jail are allow-by-default and a
 * secret must not depend on one control (test `token_header_never_in_config`).
 */
export async function gNet(token: string, ...args: string[]): Promise<string> {
	return raw(assetsRoot(), ["-c", `http.extraHeader=Authorization: Bearer ${token}`], args);
}

async function raw(workTree: string, extra: string[], args: string[]): Promise<string> {
	const { stdout } = await exec(
		"git",
		[
			`--git-dir=${assetsGitDir()}`,
			`--work-tree=${workTree}`,
			"-c", "core.hooksPath=/dev/null",
			"-c", "core.fsmonitor=false",
			// The delivery carries contents, not modes, so a mode is never a
			// difference we can act on; tracking it only produces unresolvable conflicts.
			"-c", "core.fileMode=false",
			"-c", "user.name=harness",
			"-c", "user.email=harness@local",
			...extra,
			...args,
		],
		{ maxBuffer: 64 * 1024 * 1024 },
	);
	return stdout.trimEnd();
}

export async function ensureRepo(): Promise<void> {
	await mkdir(assetsRoot(), { recursive: true, mode: 0o700 });
	await mkdir(assetsGitDir(), { recursive: true, mode: 0o700 });
	try {
		await access(join(assetsGitDir(), "HEAD"));
	} catch {
		await g("init", "--quiet");
	}
}

/** The current work tree as a tree object, without touching the real index. */
export async function worktreeTree(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "harness-index-"));
	const index = join(dir, "index");
	try {
		await withIndex(index, async () => {
			await g("add", "--all", "--force", "--", ".");
		});
		return await withIndex(index, () => g("write-tree"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** Runs body with GIT_INDEX_FILE pointed at a scratch index. */
export async function withIndex<T>(index: string, body: () => Promise<T>): Promise<T> {
	const previous = process.env.GIT_INDEX_FILE;
	process.env.GIT_INDEX_FILE = index;
	try {
		return await body();
	} finally {
		if (previous === undefined) delete process.env.GIT_INDEX_FILE;
		else process.env.GIT_INDEX_FILE = previous;
	}
}

/** True when two tree-ish differ at `path`. Either side may be absent. */
export async function differs(a: string | undefined, b: string | undefined, path: string): Promise<boolean> {
	if (a === undefined || b === undefined) return a !== b;
	try {
		await g("diff", "--quiet", a, b, "--", path);
		return false;
	} catch {
		return true;
	}
}

export const chainPath = (): string => join(assetsGitDir(), "chain.json");

/**
 * Boot row 1 — 01 §7.2 steps 2–5. `definitions` advertises exactly the person's
 * chain (02 §4), so this cannot fetch more than it should; `--prune` drops a ref
 * that left the chain. The commits come from what was actually advertised, so a
 * node the server named but did not serve is refused rather than composed.
 */
export async function fetchChain(token: string, origin: string, advertised: Chain): Promise<Chain> {
	await ensureRepo();
	try {
		await gNet(token, "fetch", "--prune", origin, "+refs/heads/*:refs/remotes/origin/*");
	} catch (cause) {
		refuse("preflight.api_unreachable", `Could not reach the Harness API at ${origin}.`, "Is it running? `harness preflight identity`.");
	}
	const chain: Chain = [];
	for (const node of advertised) {
		const commit = await g("rev-parse", "--verify", "--quiet", `refs/remotes/origin/${node.ref.replace(/^refs\/heads\//, "")}^{commit}`).catch(() => "");
		if (commit === "") {
			refuse("repo.chain_mismatch", `The server named \`${node.path}\` in your chain but did not serve its branch.`, "Run `harness pull` again; if it persists this is a bug in the definitions service.");
		}
		chain.push({ ...node, commit });
	}
	// Step 5: `--offline` composes from this file and `refs/remotes/origin/*`.
	await writeFile(chainPath(), `${JSON.stringify(chain, null, 2)}\n`, { mode: 0o600 });
	return chain;
}

/** `--offline` (D113): the chain recorded at the last successful fetch. */
export async function offlineChain(): Promise<Chain> {
	try {
		return JSON.parse(await readFile(chainPath(), "utf8")) as Chain;
	} catch {
		refuse("cli.offline_no_refs", "Nothing has been fetched on this machine yet, so there is nothing to run offline.", "`harness pull` when you are online.");
	}
}

/** Where a push takes its one path's content from (01 §7.3: two sources, same steps). */
export type PushSource =
	| { path: string; kind: "tree"; oid: string } // assets/<key>, from the work tree
	| { path: string; kind: "blob"; oid: string } // harnesses/<id>.json, from a scratch file
	| { path: string; kind: "absent" }; // removing an override

/**
 * 01 §7.3 steps 3–9. The branch tree is built from the person's branch plus this
 * one path, **never** the work tree, so `main` holds only what they added or
 * overrode. There is exactly one refspec and no argument reaches it
 * (`push_never_targets_team_ref`), and `--force` appears nowhere (S3).
 */
export async function pushOnePath(
	options: { token: string; origin: string; userId: string; message: string; source: PushSource },
): Promise<string> {
	const { token, origin, userId, message, source } = options;
	const base = await g("rev-parse", "--verify", "--quiet", `refs/remotes/origin/users/${userId}^{commit}`).catch(() => "");
	const dir = await mkdtemp(join(tmpdir(), "harness-push-"));
	let commit: string;
	try {
		commit = await withIndex(join(dir, "index"), async () => {
			await g("read-tree", base === "" ? EMPTY_TREE : `${base}^{tree}`);
			await g("rm", "-r", "--cached", "--ignore-unmatch", "--", source.path);
			if (source.kind === "tree") await g("read-tree", `--prefix=${source.path}/`, source.oid);
			if (source.kind === "blob") await g("update-index", "--add", "--cacheinfo", `100644,${source.oid},${source.path}`);
			const tree = await g("write-tree");
			return g("commit-tree", tree, ...(base === "" ? [] : ["-p", base]), "-m", message);
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	await g("update-ref", "refs/heads/main", commit);
	try {
		await gNet(token, "push", origin, `refs/heads/main:refs/heads/users/${userId}`);
	} catch (cause) {
		const text = String((cause as { stderr?: string }).stderr ?? cause);
		// 02 §5's messages are written to be shown, so the remote's own words win.
		// `rejected` alone says nothing: git prints it for every refusal, including
		// a pre-receive one, so only the two non-fast-forward phrasings mean that.
		const remote = text
			.split("\n")
			.filter((line) => line.startsWith("remote:"))
			.map((line) => line.slice(7).trim())
			.filter((line) => line !== "")
			.join(" ");
		if (remote !== "") refuse("repo.push_refused", remote, "`harness offer` proposes a change to the team instead.");
		if (/non-fast-forward|fetch first/i.test(text)) {
			refuse("repo.branch_moved", "Your branch moved on another machine, so this push was refused.", "`harness pull`, then push again.");
		}
		refuse("repo.push_refused", text.trim().split("\n").pop() ?? "The server refused this push.", "`harness preflight` shows what your organization allows.");
	}
	await gNet(token, "fetch", origin, `+refs/heads/users/${userId}:refs/remotes/origin/users/${userId}`);
	// The recorded chain follows the push, so an offline compose between two
	// runs (`push`, `remove`) sees the branch as it now is, not as it was booted.
	await recordUserCommit(commit);
	return commit;
}

async function recordUserCommit(commit: string): Promise<void> {
	let chain: Array<{ kind: string; commit: string }>;
	try {
		chain = JSON.parse(await readFile(chainPath(), "utf8")) as Array<{ kind: string; commit: string }>;
	} catch {
		return; // no chain recorded yet: nothing to keep current
	}
	const user = chain.find((node) => node.kind === "user");
	if (user === undefined || user.commit === commit) return;
	user.commit = commit;
	await writeFile(chainPath(), `${JSON.stringify(chain, null, 2)}\n`);
}
