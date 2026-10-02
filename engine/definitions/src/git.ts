import { spawn } from "node:child_process";

/** 02 §6.4: every invocation carries these three. `core.hooksPath` is
    `/dev/null` here because the only place our hooks may fire is the
    receive-pack the transport spawns (§6.1) — never a read inside a request. */
const FLAGS = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "gc.auto=0"];

const IDENTITY = {
	GIT_AUTHOR_NAME: "harness",
	GIT_AUTHOR_EMAIL: "definitions@harness",
	GIT_COMMITTER_NAME: "harness",
	GIT_COMMITTER_EMAIL: "definitions@harness",
};

export interface GitResult {
	code: number;
	out: Buffer;
	err: string;
}

export interface GitOptions {
	/** The push being validated runs with receive-pack's quarantine in it (§7). */
	env?: Record<string, string>;
	input?: Buffer;
}

export function git(gitDir: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
	const child = spawn("git", [...FLAGS, ...(gitDir ? [`--git-dir=${gitDir}`] : []), ...args], {
		env: { ...process.env, ...IDENTITY, ...options.env },
	});
	const out: Buffer[] = [];
	let err = "";
	child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => {
		err += chunk;
	});
	child.stdin.end(options.input);
	return new Promise((resolve) =>
		child.on("close", (code) => resolve({ code: code ?? 1, out: Buffer.concat(out), err })),
	);
}

export async function gitOut(gitDir: string, args: string[], options: GitOptions = {}): Promise<string> {
	const result = await git(gitDir, args, options);
	if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.err.trim()}`);
	return result.out.toString("utf8");
}
