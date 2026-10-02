import { alwaysLoadedLists, compose } from "@harness/compose";
import type {
	Boundary,
	Grant,
	HarnessDef,
	HarnessProvider,
	ModelProvider,
	Routing,
	Scope,
	SecurityGroup,
	Sidecar,
} from "@harness/compose/contracts";
import { post } from "./auth.js";
import { Refusal } from "./codes.js";
import type { Config } from "./config.js";
import { gitOut } from "./git.js";
import { type RepoReader, reader } from "./reader.js";
import { type Node, chainOf, nodes } from "./repos.js";

interface Edge {
	org: string;
	from_kind: string;
	from_id: string;
	rel: string;
	to_kind: string;
	to_id: string;
}

/** 02 §8.2's tables, keyed by table name. `idx_refs` is the endpoint's own
    `{ org, ref, commit }` (00 §4.10) and is not repeated as a row. */
interface Rows {
	idx_nodes: Array<{ org: string; path: string; kind: string; ref: string; parent_path: string | null }>;
	idx_assets: Array<{ org: string; node_path: string; id: string; kind: string; name: string; tree: string; sidecar: Sidecar }>;
	idx_harnesses: Array<{ org: string; node_path: string; id: string; name: string; def: HarnessDef }>;
	idx_policy: Array<{ org: string; node_path: string; file: string; body: unknown }>;
	idx_effective: Array<{ org: string; user_id: string; asset_id: string; from_path: string; shadows_path: string | null }>;
	idx_edges: Edge[];
}

const userId = (ref: string): string => ref.slice("refs/heads/users/".length);

/** 02 §8.4. `idx_stale` is api's table and no endpoint lists it, so the rows
    this process wrote are held here too and retried every 10 s. A restart is
    covered by `POST /internal/reindex/{org}` (§8.5), not by a second store. */
const stale = new Map<string, { repo: string; org: string; ref: string; commit: string }>();

export function reconcile(config: Config): NodeJS.Timeout {
	const timer = setInterval(() => {
		for (const row of [...stale.values()])
			// A retry that fails leaves the row for the next tick; the broker keeps
			// refusing the org until one succeeds (§9). A success deletes it.
			void indexRef(config, row.repo, row.org, row.ref, row.commit, []).catch(() => undefined);
	}, 10_000);
	timer.unref();
	return timer;
}

/**
 * 02 §8.3, post-receive, synchronous (D44). The push does not return success
 * until the index is written; a failure writes `idx_stale` and the broker
 * refuses the org until the reconciler clears it (§8.4, §9).
 */
export async function indexRef(
	config: Config,
	repo: string,
	org: string,
	ref: string,
	commit: string,
	changed: string[],
): Promise<void> {
	const read = reader(repo);
	try {
		const all = await nodes(repo, org);
		const node = all.find((candidate) => candidate.ref === ref);
		if (!node) throw new Error(`${ref} has no node`);
		// Step 1. Affected chains: org ref -> all users; team ref -> its subtree;
		// user ref -> that user.
		const affected = all.filter(
			(candidate) =>
				candidate.kind === "user" &&
				(node.kind === "org" || candidate.path === node.path || candidate.path.startsWith(`${node.path}.`)),
		);
		const rows: Rows = {
			idx_nodes: all.map((each) => ({ org, path: each.path, kind: each.kind, ref: each.ref, parent_path: each.parent })),
			idx_assets: [],
			idx_harnesses: [],
			idx_policy: [],
			idx_effective: [],
			idx_edges: [],
		};
		// Step 4. Placements, harnesses and policy come from the pushed ref's own
		// trees; the effective set is per person, from compose().
		await placements(read, org, node, commit, rows);
		for (const user of affected) {
			const composed = await compose(await chainOf(repo, all, user, { ref, commit }), read);
			for (const asset of composed.assets)
				rows.idx_effective.push({
					org,
					user_id: userId(user.ref),
					asset_id: asset.id,
					from_path: asset.from.path,
					shadows_path: asset.shadows?.from.path ?? null,
				});
		}
		rows.idx_edges = dedupe(rows.idx_edges);
		// Step 5.
		await post(config, "/v1/internal/index", { org, ref, commit, rows });
		// Step 5b. A user-ref push never revokes: a person's own assets are not policy.
		const policyPaths = changed.filter((path) => path.startsWith("policy/") || path.startsWith("harnesses/"));
		if (policyPaths.length > 0 && node.kind !== "user")
			await post(config, "/v1/internal/policy-changed", { org, refs: [{ ref, commit, paths: policyPaths }] });
		stale.delete(`${org}/${ref}`);
	} catch (error) {
		// Step 6. The ref update has already happened - git semantics - which is
		// why the broker consults idx_stale rather than trusting the index.
		await post(config, "/v1/internal/index", { org, ref, commit, stale: { error: String(error) } });
		stale.set(`${org}/${ref}`, { repo, org, ref, commit });
		throw new Refusal("definitions.index_failed", 500);
	} finally {
		read.close();
	}
}

/** 02 §8.5. Every ref re-indexed from the repo alone; each ref's write replaces
    that ref's rows, so the result is the fresh index (`reindex_equals_fresh_index`). */
export async function reindex(config: Config, repo: string, org: string): Promise<{ chains: number; ms: number }> {
	const started = Date.now();
	const all = await nodes(repo, org);
	for (const node of all) {
		const commit = (await gitOut(repo, ["rev-parse", node.ref])).trim();
		await indexRef(config, repo, org, node.ref, commit, []);
	}
	return { chains: all.filter((node) => node.kind === "user").length, ms: Date.now() - started };
}

async function json(read: RepoReader, oid: string): Promise<unknown> {
	return JSON.parse(Buffer.from(await read.cat(oid)).toString("utf8"));
}

async function placements(read: RepoReader, org: string, node: Node, commit: string, rows: Rows): Promise<void> {
	for (const kind of await read.ls(commit, "assets")) {
		if (kind.mode !== "040000") continue;
		for (const directory of await read.ls(commit, `assets/${kind.name}`)) {
			if (directory.mode !== "040000") continue;
			const entries = await read.ls(commit, `assets/${kind.name}/${directory.name}`);
			const sidecarEntry = entries.find((entry) => entry.name === "asset.json");
			if (!sidecarEntry) continue; // not an asset; compose() reported it
			const sidecar = (await json(read, sidecarEntry.oid)) as Sidecar;
			rows.idx_assets.push({
				org,
				node_path: node.path,
				id: sidecar.id,
				kind: kind.name,
				name: directory.name,
				tree: directory.oid,
				sidecar,
			});
			rows.idx_edges.push(edge(org, "asset", sidecar.id, "placed_on", "node", node.path));
			for (const need of sidecar.needs ?? [])
				if (need.kind === "credential") rows.idx_edges.push(edge(org, "asset", sidecar.id, "needs_alias", "alias", need.alias));
		}
	}
	for (const entry of await read.ls(commit, "harnesses")) {
		const def = (await json(read, entry.oid)) as HarnessDef;
		rows.idx_harnesses.push({ org, node_path: node.path, id: def.id, name: def.name, def });
		for (const asset of def.assets) rows.idx_edges.push(edge(org, "harness", def.id, "includes", "asset", asset));
	}
	for (const entry of await read.ls(commit, "policy")) {
		const raw = await json(read, entry.oid);
		// W5-D10: `always-loaded.json` lands in `idx_policy` in the two-list shape
		// whatever the branch holds, so every reader of the index — the console,
		// the broker, `routes_writes` — sees one shape and none of them guesses.
		const body = entry.name === "always-loaded.json" ? alwaysLoadedLists(raw as never) : raw;
		rows.idx_policy.push({ org, node_path: node.path, file: entry.name, body });
		policyEdges(org, entry.name, body, rows.idx_edges);
	}
}

const edge = (org: string, from_kind: string, from_id: string, rel: string, to_kind: string, to_id: string): Edge => ({
	org,
	from_kind,
	from_id,
	rel,
	to_kind,
	to_id,
});

const dedupe = (edges: Edge[]): Edge[] => [...new Map(edges.map((each) => [Object.values(each).join("\t"), each])).values()];

/** `scoped_to` and `only_for` are the same two rels for a grant, a boundary and
    a harness provider (02 §8.2), so they are read off `Scope` once. */
function scopeEdges(org: string, kind: string, id: string, scope: Scope, edges: Edge[]): void {
	for (const team of scope.teams === "all" ? ["all"] : scope.teams) edges.push(edge(org, kind, id, "scoped_to", "team", team));
	for (const harness of scope.harnesses ?? []) edges.push(edge(org, kind, id, "only_for", "harness", harness));
}

/** The rest of 02 §8.2's vocabulary, derived from the policy files verbatim. */
function policyEdges(org: string, file: string, body: unknown, edges: Edge[]): void {
	if (file === "groups.json")
		for (const group of body as SecurityGroup[])
			for (const entry of group.entries) {
				edges.push(edge(org, "group", group.name, "entry", "alias", entry.alias));
				edges.push(edge(org, "group", group.name, "entry_secret", "secret", `${entry.secret.vault}:${entry.secret.ref}`));
				edges.push(edge(org, "group", group.name, "entry_upstream", "origin", entry.upstream));
			}
	if (file === "grants.json")
		for (const grant of body as Grant[]) {
			if (grant.group) edges.push(edge(org, "grant", grant.id, "grants", "group", grant.group));
			if (grant.narrowedFrom) edges.push(edge(org, "grant", grant.id, "narrowed_from", "grant", grant.narrowedFrom.grant));
			scopeEdges(org, "grant", grant.id, grant.scope, edges);
		}
	if (file === "boundaries.json")
		for (const boundary of body as Boundary[]) scopeEdges(org, "boundary", boundary.id, boundary.scope, edges);
	// W6-D3's `name` needs nothing here: the file goes into `idx_policy` as
	// `body`, verbatim, so a new field travels to every reader of the index
	// without an edge — a display name is not a relationship.
	if (file === "harness-providers.json")
		for (const provider of body as HarnessProvider[]) {
			scopeEdges(org, "harness_provider", provider.id, provider.scope, edges);
			for (const format of provider.speaks) edges.push(edge(org, "harness_provider", provider.id, "speaks", "wire_format", format));
		}
	if (file === "model-providers.json")
		for (const provider of body as ModelProvider[]) {
			if (provider.credential)
				edges.push(edge(org, "model_provider", provider.id, "credential", "alias", provider.credential.alias));
			for (const format of Object.keys(provider.endpoints))
				edges.push(edge(org, "model_provider", provider.id, "exposes", "wire_format", format));
		}
	if (file === "routing.json") {
		const routing = body as Routing;
		const to: Record<string, string> = { teams: "team", harnesses: "harness", providers: "harness_provider" };
		for (const [rel, table] of [
			["default_for", routing.defaultFor],
			["approved_for", routing.approvedFor],
		] as const)
			for (const [key, map] of Object.entries(table))
				for (const [subject, value] of Object.entries(map))
					for (const provider of Array.isArray(value) ? value : [value])
						edges.push(edge(org, "model_provider", provider, rel, to[key], subject));
	}
}
