import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Chain, Composed, Reader } from "./contracts.js";

/**
 * The conformance fixture runner of 01 §6. One truth, three consumers: the
 * CLI, `definitions` and the console's Playwright suite all read the same
 * `expected.json` (00 §10), so the runner is exported rather than living in a
 * test file. See `fixtures/README.md` for the shape of a case.
 */
export interface FixtureCase {
	name: string;
	dir: string;
	chain: Chain;
	expected: unknown;
}

export function fixtureCases(root: string): FixtureCase[] {
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "expected.json")))
		.map((entry) => ({
			name: entry.name,
			dir: join(root, entry.name),
			chain: JSON.parse(readFileSync(join(root, entry.name, "chain.json"), "utf8")) as Chain,
			expected: JSON.parse(readFileSync(join(root, entry.name, "expected.json"), "utf8")) as unknown,
		}))
		.sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * Every oid in a `Composed` is replaced by the fixture path it came from, so
 * an expectation survives a git version that hashes differently and reads as
 * the thing it names. The composed tree came from no branch, so it is
 * `<composed>`; that it is stable is `compose_is_deterministic`'s job.
 */
export function normalise(composed: Composed, symbols: Map<string, string>): unknown {
	const substitute = (value: unknown): unknown => {
		if (typeof value === "string") return symbols.get(value) ?? value;
		if (Array.isArray(value)) return value.map(substitute);
		if (value && typeof value === "object")
			return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, substitute(entry)]));
		return value;
	};
	return { ...(substitute(composed) as Composed), tree: "<composed>" };
}

// ---------------------------------------------------------------------------
// T1: the same cases with no git at all
// ---------------------------------------------------------------------------

interface Entry {
	name: string;
	mode: "040000" | "100644";
	oid: string;
}

/**
 * A `Reader` over the case's `branches/` directories, hashing content the way
 * git hashes *ideas* rather than the way git hashes objects — the oids are
 * only ever compared to themselves and are normalised away before any
 * assertion. Reproducing git's own object format here would be a second
 * implementation of git with none of its tests; `gitFixture` is how the
 * fixtures are checked against the real thing.
 */
export function memoryFixture(dir: string): { reader: Reader; chain: Chain; symbols: Map<string, string> } {
	const store = new Map<string, Uint8Array | Entry[]>();
	const symbols = new Map<string, string>();
	const roots = new Map<string, string>();
	const oid = (tag: string, body: string) => `${tag}${createHash("sha1").update(body).digest("hex")}`;

	const put = (entries: Entry[]) => {
		const id = oid("t", entries.map((entry) => `${entry.mode} ${entry.name} ${entry.oid}`).join("\n"));
		store.set(id, entries);
		return id;
	};
	const load = (from: string, placeholder: string, rel: string): string => {
		const entries: Entry[] = [];
		for (const child of readdirSync(from, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
			const path = rel ? `${rel}/${child.name}` : child.name;
			if (child.isDirectory()) entries.push({ name: child.name, mode: "040000", oid: load(join(from, child.name), placeholder, path) });
			else {
				const bytes = new Uint8Array(readFileSync(join(from, child.name)));
				const id = oid("b", Buffer.from(bytes).toString("base64"));
				store.set(id, bytes);
				entries.push({ name: child.name, mode: "100644", oid: id });
			}
		}
		const id = put(entries);
		symbols.set(id, `${placeholder}:${rel}`);
		return id;
	};

	const branches = join(dir, "branches");
	for (const branch of existsSync(branches) ? readdirSync(branches) : []) roots.set(branch, load(join(branches, branch), branch, ""));
	const chain = JSON.parse(readFileSync(join(dir, "chain.json"), "utf8")) as Chain;
	// An empty branch is an empty tree (01 §4.1), so a placeholder with no
	// directory still resolves rather than reporting a missing commit.
	for (const node of chain) if (!roots.has(node.commit)) roots.set(node.commit, put([]));

	const reader: Reader = {
		async ls(commit, path) {
			let here = store.get(roots.get(commit) ?? "");
			for (const segment of path.split("/")) {
				if (!Array.isArray(here)) return [];
				const next = here.find((entry) => entry.name === segment);
				here = next ? store.get(next.oid) : undefined;
			}
			return Array.isArray(here) ? here : [];
		},
		async cat(id) {
			const found = store.get(id);
			return found instanceof Uint8Array ? found : new Uint8Array();
		},
		async write(bytes) {
			const id = oid("b", Buffer.from(bytes).toString("base64"));
			store.set(id, bytes);
			return id;
		},
		async mktree(entries) {
			return put(entries as Entry[]);
		},
	};
	return { reader, chain, symbols };
}

// ---------------------------------------------------------------------------
// T2: the same cases against a bare repo built in a tmpdir
// ---------------------------------------------------------------------------

function run(args: string[], env?: Record<string, string>): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile("git", args, { env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) =>
			error ? reject(error) : resolve(stdout.trimEnd()),
		);
		// `hash-object --stdin` reads until end of file, and node leaves the pipe
		// open unless it is told not to.
		child.stdin?.end();
	});
}

/**
 * Materialises a case's branches as orphan commits in a bare repo (01 §4.1,
 * 02 D43: an empty tree and no parent) and returns the chain with the real
 * commits substituted for the placeholders.
 */
export async function gitFixture(dir: string, repo: string, scratch: string): Promise<{ chain: Chain; symbols: Map<string, string> }> {
	await run(["init", "--bare", "--quiet", repo]);
	const chain = JSON.parse(readFileSync(join(dir, "chain.json"), "utf8")) as Chain;
	const symbols = new Map<string, string>();
	const commits = new Map<string, string>();
	const branches = join(dir, "branches");
	// Fixed identity and dates: a fixture that hashed differently on each run
	// would make `compose_is_deterministic` a test of the clock.
	const env = {
		GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
		GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
		GIT_INDEX_FILE: join(scratch, "index"),
	};
	for (const node of chain) {
		if (commits.has(node.commit)) continue;
		const from = join(branches, node.commit);
		const base = ["--git-dir", repo, "-c", "core.hooksPath=/dev/null", "-c", "core.fileMode=false", "-c", "user.name=harness", "-c", "user.email=harness@local"];
		// 01 §4.1: a branch starts as an empty tree with no parent, so an absent
		// branches/<placeholder>/ is a node that holds nothing, not a missing one.
		await run([...base, "read-tree", "--empty"], env);
		if (existsSync(from)) await run([...base, "--work-tree", from, "add", "--all", "--force", "--", "."], env);
		const tree = await run([...base, "write-tree"], env);
		const commit = await run([...base, "commit-tree", tree, "-m", `branch ${node.path}`], env);
		commits.set(node.commit, commit);
		symbols.set(commit, node.commit);
		for (const line of (await run([...base, "ls-tree", "-r", "-t", "-z", commit])).split("\0").filter(Boolean)) {
			const tab = line.indexOf("\t");
			const [mode, , oid] = line.slice(0, tab).split(" ");
			if (mode === "040000") symbols.set(oid, `${node.commit}:${line.slice(tab + 1)}`);
		}
		symbols.set(tree, `${node.commit}:`);
	}
	return { chain: chain.map((node) => ({ ...node, commit: commits.get(node.commit) as string })), symbols };
}
