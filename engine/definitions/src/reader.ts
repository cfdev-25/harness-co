import { spawn } from "node:child_process";
import type { Reader } from "@harness/compose";

type Entry = Awaited<ReturnType<Reader["ls"]>>[number];

export interface RepoReader extends Reader {
	close(): void;
}

/** git's own name for the empty tree. It resolves without being written, so a
    chain node that must contribute nothing can point at it (see validate.ts). */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const FLAGS = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "gc.auto=0"];

/**
 * The `Reader` of 00 §4.4 over a bare repo (02 §4), memoised by oid and by
 * (commit, dir) for the life of one request — 02 §8.3 reads every team tree
 * once per push, not once per user, and that is where the 5 s target comes
 * from. `env` carries receive-pack's quarantine while a push is being
 * validated; the new objects are not in `<repo>/objects` yet.
 */
export function reader(gitDir: string, env: Record<string, string> = {}): RepoReader {
	const batch = spawn("git", [...FLAGS, `--git-dir=${gitDir}`, "cat-file", "--batch"], { env: { ...process.env, ...env } });
	const queue: Array<{ resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }> = [];
	let buffer = Buffer.alloc(0);
	let pending: { size: number; waiter: (typeof queue)[number] } | null = null;
	batch.stdout.on("data", (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		for (;;) {
			if (!pending) {
				const end = buffer.indexOf(10);
				if (end < 0) return;
				const header = buffer.subarray(0, end).toString("utf8").split(" ");
				buffer = buffer.subarray(end + 1);
				const waiter = queue.shift();
				if (!waiter) return;
				if (header.length < 3) {
					waiter.reject(new Error(`cat-file: ${header.join(" ")}`));
					continue;
				}
				pending = { size: Number(header[2]), waiter };
			}
			if (buffer.length < pending.size + 1) return;
			pending.waiter.resolve(new Uint8Array(buffer.subarray(0, pending.size)));
			buffer = buffer.subarray(pending.size + 1);
			pending = null;
		}
	});

	const blobs = new Map<string, Promise<Uint8Array>>();
	const listings = new Map<string, Promise<Entry[]>>();
	const plumb = (args: string[], input?: Buffer) =>
		new Promise<{ code: number; out: string }>((resolve) => {
			const child = spawn("git", [...FLAGS, `--git-dir=${gitDir}`, ...args], { env: { ...process.env, ...env } });
			let out = "";
			child.stdout.on("data", (chunk: Buffer) => {
				out += chunk;
			});
			child.stderr.resume();
			child.stdin.end(input);
			child.on("close", (code) => resolve({ code: code ?? 1, out }));
		});

	return {
		async ls(commit, dir) {
			const key = `${commit}:${dir}`;
			let listing = listings.get(key);
			if (!listing) {
				listing = plumb(["ls-tree", "-z", dir ? `${commit}:${dir}` : commit]).then(({ code, out }) =>
					// 00 §4.4: an absent directory lists as []. A missing path is
					// the only way `ls-tree` fails here, so the code is the answer.
					code !== 0
						? []
						: out
								.split("\0")
								.filter(Boolean)
								.map((line) => {
									const [meta, name] = line.split("\t");
									const [mode, , oid] = meta.split(" ");
									return { name, mode: mode as Entry["mode"], oid };
								}),
				);
				listings.set(key, listing);
			}
			return listing;
		},
		cat(oid) {
			let blob = blobs.get(oid);
			if (!blob) {
				blob = new Promise<Uint8Array>((resolve, reject) => {
					queue.push({ resolve, reject });
					batch.stdin.write(`${oid}\n`);
				});
				blobs.set(oid, blob);
			}
			return blob;
		},
		async write(bytes) {
			return (await plumb(["hash-object", "-w", "--stdin"], Buffer.from(bytes))).out.trim();
		},
		async mktree(entries) {
			const lines = entries
				.map((entry) => `${entry.mode} ${entry.mode === "040000" ? "tree" : "blob"} ${entry.oid}\t${entry.name}\n`)
				.join("");
			return (await plumb(["mktree"], Buffer.from(lines))).out.trim();
		},
		close() {
			batch.stdin.end();
			batch.kill();
		},
	};
}
