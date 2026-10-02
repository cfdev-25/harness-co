import { execFile } from "node:child_process";
import type { Reader } from "./contracts.js";

/**
 * C30, non-negotiable: every git invocation carries these. `core.hooksPath`
 * matters most here — `definitions` runs git over a repo people push to, so a
 * hook planted in one would run as the service.
 */
const FLAGS = [
	"-c",
	"core.hooksPath=/dev/null",
	"-c",
	"core.fsmonitor=false",
	"-c",
	"core.fileMode=false",
	"-c",
	"user.name=harness",
	"-c",
	"user.email=harness@local",
];

function git(gitDir: string, args: string[], stdin?: Uint8Array): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			"git",
			[`--git-dir=${gitDir}`, ...FLAGS, ...args],
			{ encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
			(error, stdout) => (error ? reject(error) : resolve(stdout)),
		);
		child.stdin?.end(stdin ?? new Uint8Array());
	});
}

/**
 * The `Reader` of 00 §4.4 over a bare repo: `ls-tree`, `cat-file --batch`,
 * `hash-object -w` and `mktree`, and nothing else. `engine/cli` points it at
 * `~/.harness/assets.git` (01 §7.2) and `definitions` at the org's repo
 * (02 §4), so there is one implementation of the four wrappers.
 *
 * One `cat-file --batch` per read rather than a long-lived one: `Reader` has
 * no close, so a resident process would outlive the composition that started
 * it. Memoising reads across a push is `definitions`' concern (02 §8.3).
 */
export function gitReader(gitDir: string): Reader {
	return {
		async ls(commit, dir) {
			let out: Buffer;
			try {
				out = await git(gitDir, ["ls-tree", "-z", `${commit}:${dir}`]);
			} catch (error) {
				// The contract names one failure here — an absent directory lists as
				// [] — and git reports an absent commit with the same message. Fail
				// open on both and a chain naming a commit the repo does not have
				// would compose to nothing, which hydration row 3 reads as "the team
				// deleted everything". So the commit is verified before the [].
				await git(gitDir, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]).catch(() => {
					throw error;
				});
				return [];
			}
			return out
				.toString("utf8")
				.split("\0")
				.filter((line) => line.length > 0)
				.map((line) => {
					const tab = line.indexOf("\t");
					const [mode, , oid] = line.slice(0, tab).split(" ");
					return { name: line.slice(tab + 1), mode: mode as "040000", oid };
				});
		},
		async cat(oid) {
			const out = await git(gitDir, ["cat-file", "--batch"], new TextEncoder().encode(`${oid}\n`));
			const header = out.indexOf(0x0a);
			const size = Number(out.subarray(0, header).toString("utf8").split(" ")[2]);
			return new Uint8Array(out.subarray(header + 1, header + 1 + size));
		},
		async write(bytes) {
			return (await git(gitDir, ["hash-object", "-w", "--stdin"], bytes)).toString("utf8").trim();
		},
		async mktree(entries) {
			// `Reader` gives a mode and no type, because a mode already says which
			// it is; 040000 is the only tree mode git writes.
			const body = entries
				.map((entry) => `${entry.mode} ${entry.mode === "040000" ? "tree" : "blob"} ${entry.oid}\t${entry.name}\0`)
				.join("");
			return (await git(gitDir, ["mktree", "-z"], new TextEncoder().encode(body))).toString("utf8").trim();
		},
	};
}
