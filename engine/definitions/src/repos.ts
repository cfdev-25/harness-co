import { join } from "node:path";
import type { Chain, ChainNode, NodeKind } from "@harness/compose/contracts";
import { Refusal } from "./codes.js";
import { git, gitOut } from "./git.js";
import { EMPTY_TREE } from "./reader.js";

export const ZERO = "0".repeat(40);

export interface Node {
	kind: NodeKind;
	path: string;
	ref: string;
	parent: string | null;
}

export const repoPath = (root: string, org: string): string => join(root, `${org}.git`);

/** 02 §4. `core.hooksPath` is deliberately absent from the config file: it is
    set per process by the transport, so a repo restored from a bundle behaves
    identically and can never be made to run someone else's hooks. */
export async function createRepo(root: string, org: string): Promise<string> {
	const repo = repoPath(root, org);
	await gitOut("", ["init", "--bare", "--quiet", repo]);
	for (const [key, value] of [
		["core.sharedRepository", "group"],
		["receive.denyNonFastForwards", "true"],
		["receive.fsckObjects", "true"],
	])
		await gitOut(repo, ["config", key, value]);
	return repo;
}

/**
 * D43: a branch is an orphan commit with an empty tree, message
 * `created <node_path>` (02 §5.3). The message is also the only record of a
 * user branch's dotted path — no body in 00 §4.10 carries it back — so
 * `nodes()` reads it there.
 */
export async function createBranch(repo: string, ref: string, nodePath: string): Promise<string> {
	const commit = (await gitOut(repo, ["commit-tree", EMPTY_TREE, "-m", `created ${nodePath}`])).trim();
	await gitOut(repo, ["update-ref", ref, commit, ZERO]);
	paths.get(repo)?.set(ref, nodePath);
	return commit;
}

/** ref → node path, per repo. A root commit never changes, so this never goes stale. */
const paths = new Map<string, Map<string, string>>();

async function branchPath(repo: string, ref: string): Promise<string> {
	let memo = paths.get(repo);
	if (!memo) paths.set(repo, (memo = new Map()));
	const hit = memo.get(ref);
	if (hit !== undefined) return hit;
	const roots = (await gitOut(repo, ["rev-list", "--max-parents=0", ref])).trim().split("\n");
	const subject = (await gitOut(repo, ["show", "-s", "--format=%s", roots[roots.length - 1]])).trim();
	const nodePath = subject.startsWith("created ") ? subject.slice("created ".length) : "";
	memo.set(ref, nodePath);
	return nodePath;
}

const parentOf = (path: string): string | null => (path.includes(".") ? path.slice(0, path.lastIndexOf(".")) : null);

/** Every node the repo holds. A team's path is its ref; a user's is its root
    commit message; the org's is the first segment of any child's, because
    `/internal/orgs` is given only an id. */
export async function nodes(repo: string, org: string): Promise<Node[]> {
	const refs = (await gitOut(repo, ["for-each-ref", "--format=%(refname)", "refs/heads"])).split("\n").filter(Boolean);
	const teams = refs.filter((ref) => ref.startsWith("refs/heads/teams/")).map((ref) => ref.slice("refs/heads/teams/".length));
	const users: Node[] = [];
	for (const ref of refs.filter((ref) => ref.startsWith("refs/heads/users/")))
		users.push({ kind: "user", path: await branchPath(repo, ref), ref, parent: null });
	const child = [...teams, ...users.map((user) => user.path)].filter(Boolean).sort()[0];
	const orgPath = child ? child.split(".")[0] : org;
	return [
		{ kind: "org", path: orgPath, ref: "refs/heads/org", parent: null },
		...teams.sort().map((path): Node => ({ kind: "team", path, ref: `refs/heads/teams/${path}`, parent: parentOf(path) })),
		...users.map((user): Node => ({ ...user, parent: parentOf(user.path) })),
	];
}

/** 00 §4.1: root first, narrowest last. A dotted prefix with no ref is not a
    node and is skipped — the chain is what the repo holds, not what a name implies. */
export function lineage(all: Node[], leaf: Node): Node[] {
	const byPath = new Map(all.map((node) => [node.path, node]));
	const line: Node[] = [];
	for (let path: string | null = leaf.path; path; path = parentOf(path)) {
		const node = byPath.get(path);
		if (node) line.unshift(node);
	}
	return line;
}

/** The lineage with commits resolved; `at` overrides one ref's commit with the
    value being pushed, which is not yet the ref's tip during validation. */
export async function chainOf(repo: string, all: Node[], leaf: Node, at?: { ref: string; commit: string }): Promise<Chain> {
	const chain: Chain = [];
	for (const node of lineage(all, leaf))
		chain.push({
			kind: node.kind,
			path: node.path,
			ref: node.ref,
			commit: node.ref === at?.ref ? at.commit : (await gitOut(repo, ["rev-parse", node.ref])).trim(),
		} satisfies ChainNode);
	return chain;
}

export async function changedPaths(repo: string, old: string, next: string, env: Record<string, string> = {}): Promise<string[]> {
	const range = old === ZERO ? ["--root", next] : [old, next];
	return (await gitOut(repo, ["diff-tree", "-r", "--name-only", "--no-commit-id", ...range], { env }))
		.split("\n")
		.filter(Boolean);
}

/** D48, one push at a time per repo. Not `flock`: 02 §12 shards an org to one
    instance, so this process is the repo's only writer, and a lock file would
    add a stale-lock recovery path that nothing else in the service needs. */
const locks = new Map<string, Promise<void>>();

export async function withLock<T>(repo: string, work: () => Promise<T>): Promise<T> {
	const held = locks.get(repo) ?? Promise.resolve();
	let release = () => {};
	locks.set(
		repo,
		held.then(() => new Promise<void>((resolve) => (release = resolve))),
	);
	let timer: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			held,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Refusal("definitions.busy", 503)), 30_000);
				timer.unref();
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
	try {
		return await work();
	} finally {
		release();
	}
}

/** Repo size after the push (§7 step 15). During validation the new objects are
    in the quarantine, which is a second object directory, so both are counted. */
export async function sizeBytes(repo: string, env: Record<string, string>): Promise<number> {
	const count = async (with_: Record<string, string>) => {
		const report = await gitOut(repo, ["count-objects", "-v"], { env: with_ });
		const kib = (key: string) => Number(new RegExp(`^${key}: (\\d+)$`, "m").exec(report)?.[1] ?? 0);
		return (kib("size") + kib("size-pack")) * 1024;
	};
	return (await count({})) + (env.GIT_OBJECT_DIRECTORY ? await count(env) : 0);
}

export async function headOf(repo: string, ref: string): Promise<string> {
	const result = await git(repo, ["rev-parse", ref]);
	return result.code === 0 ? result.out.toString("utf8").trim() : ZERO;
}
