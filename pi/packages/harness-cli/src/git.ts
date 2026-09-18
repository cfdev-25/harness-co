import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { assetsGitDir, assetsRoot } from "./core.js";

const run = promisify(execFile);

/**
 * Every git invocation goes through here, and every one carries the same
 * flags. Two of them are security controls, not conveniences:
 *
 *  - The git directory lives outside the work tree, and the work tree is
 *    writable from inside the jail. Refs and objects therefore are not.
 *  - `core.hooksPath=/dev/null` because the supervisor runs git *outside* the
 *    jail, as the user. A hook the agent planted would otherwise execute with
 *    the user's full privilege on the next commit. `-c` on the command line
 *    beats any config the agent could write.
 */
export async function g(...args: string[]): Promise<string> {
	return gAt(assetsRoot(), ...args);
}

/** As `g`, but against a scratch work tree. Objects still land in the real store. */
export async function gAt(workTree: string, ...args: string[]): Promise<string> {
	const { stdout } = await run(
		"git",
		[
			`--git-dir=${assetsGitDir()}`,
			`--work-tree=${workTree}`,
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"core.fsmonitor=false",
			// The server stores file contents, not modes, so a mode is never a
			// difference we can act on. Tracking it only produces conflicts that
			// cannot be resolved.
			"-c",
			"core.fileMode=false",
			"-c",
			"user.name=harness",
			"-c",
			"user.email=harness@local",
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
