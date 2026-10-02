import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { post } from "./auth.js";
import { Refusal } from "./codes.js";
import type { Config } from "./config.js";
import { git, gitOut } from "./git.js";
import { indexRef, reindex } from "./indexer.js";
import { EMPTY_TREE } from "./reader.js";
import { ZERO, changedPaths, createBranch, createRepo, headOf, repoPath, withLock } from "./repos.js";
import { validate } from "./validate.js";

/** 02 §5.3. Local to this module: it is not a 00 §4 contract (10 rule 10). */
interface CommitRequest {
	org_id: string;
	ref: string;
	expectedHead: string | null;
	author: { userId: string; name: string; email: string };
	message: string;
	changes: Array<
		| { path: string; from: { commit: string; path: string } }
		| { path: string; blob: string }
		| { path: string; delete: true }
	>;
	reason: { kind: "promote" | "accept" | "rollback" | "admin-edit" | "grant" | "revoke"; request?: string };
}

/** 02 §12: `definitions` is the one writer of its own events onto the org's
    chain (C34). A failure to record is not a reason to refuse work already done. */
export async function audit(config: Config, org: string, event: Record<string, unknown>): Promise<void> {
	await post(config, "/v1/internal/audit", { org, events: [{ at: new Date().toISOString(), ...event }] });
}

/**
 * 02 §5.3: the one validate -> update-ref -> index sequence. A push reaches the
 * same two phases through the hooks (index.ts), so a hook and an internal
 * commit cannot diverge.
 */
export async function applyRefUpdate(
	config: Config,
	org: string,
	ref: string,
	old: string,
	next: string,
	actor: string,
	reason?: CommitRequest["reason"],
): Promise<void> {
	const repo = repoPath(config.root, org);
	await validate({ repo, org, actor, internal: true, creating: old === ZERO, env: {}, quota: config.quota }, { ref, old, new: next });
	// The compare-and-swap is git's own: update-ref refuses if the ref moved.
	if ((await git(repo, ["update-ref", ref, next, old])).code !== 0) throw new Refusal("definitions.head_moved", 409);
	const paths = await changedPaths(repo, old, next);
	await audit(config, org, { event: reason ? "definitions.commit" : "definitions.push", ref, old, new: next, actor, paths, reason });
	await indexRef(config, repo, org, ref, next, paths);
}

async function body<T>(request: IncomingMessage): Promise<T> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as T;
}

/** 02 §5.3 and 00 §4.10. Every route here is reached only with the service
    token (D42); index.ts checks it before calling. */
export async function internal(config: Config, request: IncomingMessage, url: URL): Promise<{ status: number; value: unknown }> {
	const segments = url.pathname.split("/").filter(Boolean).slice(1);
	const method = request.method ?? "GET";

	if (method === "POST" && segments[0] === "orgs") {
		const { org_id, node_path } = await body<{ org_id: string; node_path?: string }>(request);
		// The dotted org path is the only record of the tree the repo serves (00 §4.10); nothing derives it from refs.
		if (!node_path) return { status: 400, value: { code: "definitions.node_path_required", message: "An organization needs its dotted path to be created." } };
		const repo = await createRepo(config.root, org_id);
		// The root commit travels back: `api` seeds the org branch in the same
		// transaction (D30h) and nothing has indexed this ref yet, so this is the
		// only `expectedHead` the seed commit can have.
		const commit = await createBranch(repo, "refs/heads/org", node_path);
		return { status: 201, value: { org: org_id, commit } };
	}

	if (method === "POST" && segments[0] === "branches") {
		const { org_id, ref, node_path } = await body<{ org_id: string; ref: string; node_path: string }>(request);
		const repo = repoPath(config.root, org_id);
		const commit = await withLock(repo, async () => {
			const created = await createBranch(repo, ref, node_path);
			await audit(config, org_id, { event: "definitions.push", ref, old: ZERO, new: created, actor: "api", paths: [] });
			await indexRef(config, repo, org_id, ref, created, []);
			return created;
		});
		return { status: 201, value: { commit } };
	}

	if (method === "POST" && segments[0] === "commit") {
		const parsed = await body<CommitRequest>(request);
		const repo = repoPath(config.root, parsed.org_id);
		return withLock(repo, async () => {
			const commit = await buildCommit(repo, parsed);
			try {
				await applyRefUpdate(config, parsed.org_id, parsed.ref, parsed.expectedHead ?? ZERO, commit, parsed.author.userId, parsed.reason);
			} catch (error) {
				if (error instanceof Refusal && error.code === "definitions.head_moved")
					return { status: 409, value: { code: error.code, message: error.message, head: await headOf(repo, parsed.ref) } };
				throw error;
			}
			return { status: 200, value: { commit } };
		});
	}

	if (method === "POST" && segments[0] === "reindex") {
		const org = segments[1];
		const repo = repoPath(config.root, org);
		const result = await withLock(repo, () => reindex(config, repo, org));
		await audit(config, org, { event: "definitions.reindex", ...result });
		return { status: 200, value: result };
	}

	// 00 §4.10's read endpoints. 02 §5.3 spells log and diff as path segments,
	// which cannot carry a ref: `refs/heads/teams/a.b` has slashes in it.
	if (method === "GET" && segments[0] === "tree") {
		const repo = repoPath(config.root, segments[1]);
		const object = `${segments[2]}:${segments.slice(3).join("/")}`;
		const type = (await gitOut(repo, ["cat-file", "-t", object])).trim();
		if (type === "blob") return { status: 200, value: { blob: (await git(repo, ["cat-file", "blob", object])).out.toString("base64") } };
		const entries = (await gitOut(repo, ["ls-tree", "-z", object]))
			.split("\0")
			.filter(Boolean)
			.map((line) => {
				const [meta, name] = line.split("\t");
				const [mode, kind, oid] = meta.split(" ");
				return { name, mode, kind, oid };
			});
		return { status: 200, value: { entries } };
	}

	if (method === "GET" && segments[0] === "log") {
		const repo = repoPath(config.root, url.searchParams.get("org") ?? "");
		const path = url.searchParams.get("path");
		const out = await gitOut(repo, [
			"log",
			`-n${url.searchParams.get("limit") ?? "50"}`,
			"--name-only",
			"--format=%x00%H%x1f%an%x1f%ae%x1f%aI%x1f%s",
			url.searchParams.get("ref") ?? "HEAD",
			...(path ? ["--", path] : []),
		]);
		const commits = out
			.split("\0")
			.filter(Boolean)
			.map((record) => {
				const [header, ...rest] = record.split("\n");
				const [commit, name, email, at, message] = header.split("\u001f");
				return { commit, author: { name, email }, at, message, paths: rest.filter(Boolean) };
			});
		return { status: 200, value: { commits } };
	}

	if (method === "GET" && segments[0] === "diff") {
		const repo = repoPath(config.root, url.searchParams.get("org") ?? "");
		const path = url.searchParams.get("path");
		const diff = await gitOut(repo, [
			"diff",
			url.searchParams.get("a") ?? EMPTY_TREE,
			url.searchParams.get("b") ?? EMPTY_TREE,
			...(path ? ["--", path] : []),
		]);
		return { status: 200, value: { diff } };
	}

	return { status: 404, value: {} };
}

/** 02 §5.3's `changes`, built in a scratch index. The work tree is an empty
    temporary directory: `rm --cached` is a porcelain that insists on one, and
    with `--cached` it never touches it. */
async function buildCommit(repo: string, parsed: CommitRequest): Promise<string> {
	const scratch = mkdtempSync(join(tmpdir(), "harness-commit-"));
	const env = { GIT_INDEX_FILE: join(scratch, "index"), GIT_WORK_TREE: scratch };
	try {
		await gitOut(repo, ["read-tree", parsed.expectedHead ?? EMPTY_TREE], { env });
		for (const change of parsed.changes) {
			await gitOut(repo, ["rm", "--cached", "-r", "--ignore-unmatch", "--quiet", "--", change.path], { env });
			if ("delete" in change) continue;
			if ("blob" in change) {
				const oid = (await gitOut(repo, ["hash-object", "-w", "--stdin"], { input: Buffer.from(change.blob, "base64") })).trim();
				await gitOut(repo, ["update-index", "--add", "--cacheinfo", `100644,${oid},${change.path}`], { env });
			} else {
				const source = `${change.from.commit}:${change.from.path}`;
				const type = (await gitOut(repo, ["cat-file", "-t", source])).trim();
				const oid = (await gitOut(repo, ["rev-parse", source])).trim();
				if (type === "tree") await gitOut(repo, ["read-tree", `--prefix=${change.path}/`, oid], { env });
				else await gitOut(repo, ["update-index", "--add", "--cacheinfo", `100644,${oid},${change.path}`], { env });
			}
		}
		const tree = (await gitOut(repo, ["write-tree"], { env })).trim();
		return (
			await gitOut(repo, ["commit-tree", tree, ...(parsed.expectedHead ? ["-p", parsed.expectedHead] : []), "-m", parsed.message], {
				env: {
					GIT_AUTHOR_NAME: parsed.author.name,
					GIT_AUTHOR_EMAIL: parsed.author.email,
					GIT_COMMITTER_NAME: parsed.author.name,
					GIT_COMMITTER_EMAIL: parsed.author.email,
				},
			})
		).trim();
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}
