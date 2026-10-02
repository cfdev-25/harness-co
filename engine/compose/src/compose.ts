import type {
	AssetKind,
	Boundary,
	Chain,
	ChainNode,
	Composed,
	Conflict,
	EffectivePolicy,
	EffectiveReach,
	Grant,
	HarnessDef,
	HarnessProvider,
	ModelProvider,
	Reach,
	Reader,
	Routing,
	SecurityGroup,
} from "./contracts.js";
import { SPECS, narrowingFault, readJson } from "./policy.js";
import { narrowReach, noReach } from "./reach.js";
import { type Placement, cmp, dedupeOnNode, readSidecar, resolveByIdAndPath } from "./sidecar.js";
import { buildTree } from "./tree.js";

/** C32: absent is not empty. A missing file composes to nothing, not to a policy. */
const NO_ROUTING: Routing = {
	defaultFor: { teams: {}, harnesses: {}, providers: {} },
	approvedFor: { teams: {}, harnesses: {}, providers: {} },
};

/** 01 §3: every "read <path>" is `ls` the containing directory, then `cat` the entry's oid. */
async function readFile(node: ChainNode, dir: string, name: string, reader: Reader): Promise<Uint8Array | null> {
	const entry = (await reader.ls(node.commit, dir)).find((candidate) => candidate.name === name);
	return entry && entry.mode !== "040000" ? reader.cat(entry.oid) : null;
}

const byKey = <T>(rows: T[], key: (row: T) => string): Record<string, T> =>
	Object.fromEntries(rows.map((row) => [key(row), row]));

/** 01 §6 step 1. */
function chainFault(chain: Chain): string | null {
	if (chain.length === 0) return "it is empty";
	if (chain[0].kind !== "org") return `it starts at a ${chain[0].kind}, not an organisation`;
	const last = chain[chain.length - 1];
	if (last.kind !== "user") return `it ends at a ${last.kind}, not a person`;
	for (let at = 1; at < chain.length; at++) {
		const { path } = chain[at];
		const parent = chain[at - 1].path;
		if (!path.startsWith(`${parent}.`) || path.slice(parent.length + 1).includes("."))
			return `${path} does not extend ${parent} by one segment`;
	}
	return null;
}

/**
 * 01 §6, numbered as it is there. Pure given a `Reader`, and it never throws
 * for a content fault: a file on a branch is whatever somebody pushed, so
 * every fault is a `Conflict` the caller turns into a `Blocker` (01 §9).
 */
export async function compose(chain: Chain, reader: Reader): Promise<Composed> {
	const conflicts: Conflict[] = [];
	const report = (conflict: Conflict) => conflicts.push(conflict);

	// 1. Validate the chain.
	const fault = chainFault(chain);
	if (fault) {
		// The conflict needs a node and there may be none; naming the chain in
		// both fields keeps the shape honest without inventing an org.
		const nowhere: ChainNode = chain[0] ?? { kind: "org", path: "<chain>", ref: "<chain>", commit: "<chain>" };
		report({ kind: "malformed", path: "<chain>", from: nowhere, why: fault });
		return finish(chain, [], conflicts, emptyPolicy(), [], {}, reader);
	}
	const org = chain[0];

	/** Read one `policy/<file>` from a node, validated against its 00 §4.3 shape. */
	const policyFile = async <T>(node: ChainNode, file: keyof typeof SPECS): Promise<T | null> => {
		const bytes = await readFile(node, "policy", String(file), reader);
		if (!bytes) return null;
		const parsed = readJson(bytes, SPECS[file], String(file));
		// A file that fails to validate is treated as absent for the rest of the walk.
		if ("why" in parsed) {
			report({ kind: "malformed", path: `policy/${String(file)}`, from: node, why: parsed.why });
			return null;
		}
		return parsed.value as T;
	};

	// 2. Read org policy. Each file is optional; a missing one is [] or {}.
	const kinds = (await policyFile<AssetKind[]>(org, "kinds.json")) ?? [];
	const groups = byKey((await policyFile<SecurityGroup[]>(org, "groups.json")) ?? [], (group) => group.name);
	const modelProviders = byKey((await policyFile<ModelProvider[]>(org, "model-providers.json")) ?? [], (p) => p.id);
	const providers = (await policyFile<HarnessProvider[]>(org, "harness-providers.json")) ?? [];
	const routing = (await policyFile<Routing>(org, "routing.json")) ?? NO_ROUTING;
	// W5-D10: `{ required, recommended }`, and a bare array is the `required` list
	// — one normalisation here, so nothing downstream sees the older shape.
	const declaredLoads = alwaysLoadedLists(await policyFile<AlwaysLoadedFile>(org, "always-loaded.json"));
	// 03 §5.2 step 3: approval scope is by team only, so a provider that names
	// harnesses is a compose fault, raised here and nowhere else.
	const harnessProviders = byKey(
		providers.filter((provider) => {
			if (!provider.scope.harnesses) return true;
			report({
				kind: "malformed",
				path: "policy/harness-providers.json",
				from: org,
				why: `${provider.id}'s approval scope names harnesses; approval is by team only`,
			});
			return false;
		}),
		(provider) => provider.id,
	);

	const boundaries: Boundary[] = [];
	const grants: Grant[] = [];
	// 10a (D131). The chain's reach, narrowed one node at a time. `off` until a
	// node says otherwise, set by the organisation — the node that can turn it on.
	let reach: EffectiveReach = noReach(org.path);
	const harnesses: HarnessDef[] = [];
	/** Which node each harness's winning definition came off, for 10b's conflict. */
	const winnerNode = new Map<string, ChainNode>();
	/** W5-D12: every node that holds a definition for this id, root first. The
	    last is the winner, and the one before it is the copy it is a version of. */
	const harnessNodes: Record<string, string[]> = {};
	const placements: Placement[] = [];

	// 3. Per node, root first.
	for (const node of chain) {
		// 01 §4.2: anything under policy/ on a users/… branch, and anything
		// org-only on a team branch, is malformed and ignored.
		if (node.kind !== "org")
			for (const entry of await reader.ls(node.commit, "policy")) {
				// D131 puts `reach.json` beside them: per node, like boundaries.
				if (node.kind === "team" && ["boundaries.json", "grants.json", "reach.json"].includes(entry.name)) continue;
				report({
					kind: "malformed",
					path: `policy/${entry.name}`,
					from: node,
					why:
						node.kind === "user"
							? "a person's branch holds no policy"
							: `only the organisation branch holds policy/${entry.name}`,
				});
			}

		if (node.kind !== "user") {
			// 7. Boundaries: union only, each id rewritten so the source is legible.
			for (const boundary of (await policyFile<Boundary[]>(node, "boundaries.json")) ?? [])
				boundaries.push({ ...boundary, id: `${node.path}/${boundary.id}` });
			// 10a (D131). Reach, narrowed: a step that widens is reported and the
			// parent stands, so nothing below the organisation can reach further.
			const step = await policyFile<Reach>(node, "reach.json");
			if (step) {
				const said = { mode: step.mode, hosts: step.hosts ?? [] };
				// The organisation is the top of the walk: its file *is* the start,
				// and only what is below it can widen anything.
				if (node.kind === "org") reach = { ...said, hosts: said.mode === "off" ? [] : said.hosts, setBy: node.path };
				else {
					const walked = narrowReach(reach, said, node.path);
					if (walked.why) report({ kind: "reach-widened", at: node.path, from: node, why: walked.why });
					reach = walked.reach;
				}
			}
			// 8 and 9. Grants: the org's as they stand, a team's only as a narrowing.
			for (const grant of (await policyFile<Grant[]>(node, "grants.json")) ?? []) {
				// D132: the reach grant is retired. It grants nothing, so it is not a
				// grant, and the branch is told rather than quietly read differently.
				if ((grant as { reach?: string }).reach) {
					report({ kind: "reach-grant-retired", grant: grant.id, from: node });
					continue;
				}
				if (node.kind === "org") {
					grants.push(grant);
					continue;
				}
				const fault = narrowingFault(grant, node, grants, groups);
				if (fault)
					// `clause` carries which of §6 step 9's clauses failed, so 02 §10 can
					// choose `grant_widens` over `grant_outside_subtree` without reading
					// English. The cast is the contract's, not ours: 00 §4.2 declares
					// `clause: "a" | "b" | "c"` and step 9 has five clauses plus step 8's
					// "narrows nothing" — and (d), an alias the team does not hold, *is*
					// `grant_widens`. The union must be "a" | "b" | "c" | "d" | "e" |
					// "none"; the cast goes when it is. Clamping to three values here
					// would report (d) and (e) as a clause that did not fail.
					report({ kind: "invalid-grant", grant: grant.id, from: node, ...fault } as Conflict);
				else grants.push(grant);
			}
		}

		// 11. Harnesses, from every node. Ids that resolve to nothing are kept (C18).
		for (const entry of await reader.ls(node.commit, "harnesses")) {
			const parsed = readJson(await reader.cat(entry.oid), SPECS.harness, entry.name);
			if ("why" in parsed) {
				report({ kind: "malformed", path: `harnesses/${entry.name}`, from: node, why: parsed.why });
				continue;
			}
			const harness = parsed.value as HarnessDef;
			if (entry.name !== `${harness.id}.json`) {
				report({
					kind: "malformed",
					path: `harnesses/${entry.name}`,
					from: node,
					why: `the file is named ${entry.name} but the harness is ${harness.id}`,
				});
				continue;
			}
			// D3 for harnesses: the same id on a nearer node is the person's (or the
			// team's) version of that harness and replaces the farther one. Nodes
			// are walked root first, so the last writer is the nearest.
			const at = harnesses.findIndex((one) => one.id === harness.id);
			if (at === -1) harnesses.push(harness);
			else harnesses[at] = harness;
			winnerNode.set(harness.id, node);
			const held = harnessNodes[harness.id] ?? [];
			if (held[held.length - 1] !== node.path) harnessNodes[harness.id] = [...held, node.path];
		}

		// 3 and 4. Assets: one ls per kind, one cat per sidecar.
		const found: Placement[] = [];
		for (const kindEntry of await reader.ls(node.commit, "assets")) {
			if (kindEntry.mode !== "040000") continue;
			const kind = kindEntry.name;
			for (const dir of await reader.ls(node.commit, `assets/${kind}`)) {
				const path = `assets/${kind}/${dir.name}`;
				if (dir.mode !== "040000") {
					report({ kind: "malformed", path, from: node, why: "an asset is a directory, and this is not one" });
					continue;
				}
				const bytes = await readFile(node, path, "asset.json", reader);
				if (!bytes) {
					report({ kind: "malformed", path, from: node, why: "there is no asset.json, so this is not an asset" });
					continue;
				}
				const sidecar = readSidecar(bytes, kind);
				if (typeof sidecar === "string") {
					report({ kind: "malformed", path, from: node, why: sidecar });
					continue;
				}
				// C37: a kind is one line of data, so an undeclared one is data missing,
				// not code missing. The directory is skipped either way.
				if (!kinds.includes(kind)) {
					report({ kind: "unknown-kind", assetKind: kind, path, from: node });
					continue;
				}
				found.push({ id: sidecar.id, kind, name: dir.name, from: node, tree: dir.oid, sidecar });
			}
		}
		const deduped = dedupeOnNode(node, found);
		for (const conflict of deduped.conflicts) report(conflict);
		placements.push(...deduped.kept.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.name, b.name)));
	}

	// 10b (D131). A harness may take one last step; the chain is complete now, so
	// this is where a widening one is caught. The value itself is the session's
	// (`effectiveReach`) — `EffectivePolicy` is every harness at once.
	for (const harness of harnesses) {
		if (!harness.reach) continue;
		const from = winnerNode.get(harness.id) ?? org;
		const walked = narrowReach(reach, harness.reach, `harness:${harness.id}`);
		if (walked.why) report({ kind: "reach-widened", at: `harness:${harness.id}`, from, why: walked.why });
	}

	// 5 and 6.
	const resolved = resolveByIdAndPath(placements);
	for (const conflict of resolved.conflicts) report(conflict);

	// 12. Required and recommended: the winning copy must be the organisation's
	// own, for both lists — a recommended id a new harness would copy has to
	// name an asset every member of the organisation already holds.
	const ours = (id: string) => {
		if (resolved.assets.some((asset) => asset.id === id && asset.from.kind === "org")) return true;
		report({
			kind: "malformed",
			path: "policy/always-loaded.json",
			from: org,
			why: `${id} is not an organisation asset`,
		});
		return false;
	};
	const required = declaredLoads.required.filter(ours);
	// An id on both lists is required: the stronger of the two states wins, and
	// naming it twice is a tidiness fault, not a composition one.
	const recommended = declaredLoads.recommended.filter((id) => !required.includes(id)).filter(ours);

	const policy: EffectivePolicy = {
		boundaries,
		grants,
		groups,
		modelProviders,
		harnessProviders,
		routing,
		kinds,
		required,
		recommended,
		reach,
	};
	return finish(chain, resolved.assets, conflicts, policy, harnesses, harnessNodes, reader);
}

function emptyPolicy(): EffectivePolicy {
	return {
		boundaries: [],
		grants: [],
		groups: {},
		modelProviders: {},
		harnessProviders: {},
		routing: NO_ROUTING,
		kinds: [],
		required: [],
		recommended: [],
		reach: noReach("<chain>"),
	};
}

/** 13, 14 and 15. */
async function finish(
	chain: Chain,
	assets: Composed["assets"],
	conflicts: Conflict[],
	policy: EffectivePolicy,
	harnesses: HarnessDef[],
	harnessFrom: Record<string, string[]>,
	reader: Reader,
): Promise<Composed> {
	const { tree } = await buildTree(assets, policy.required, reader);
	return { chain, assets, conflicts, policy, harnesses, harnessFrom, tree };
}

/** W5-D10's file, in either shape. A bare array is the `required` list. */
type AlwaysLoadedFile = string[] | { required?: string[]; recommended?: string[] };

/** The one reader of `policy/always-loaded.json`'s two shapes. Exported because
    the indexer (02) normalises the same file on its way into `idx_policy`. */
export function alwaysLoadedLists(body: AlwaysLoadedFile | null | undefined): { required: string[]; recommended: string[] } {
	if (!body) return { required: [], recommended: [] };
	if (Array.isArray(body)) return { required: [...body], recommended: [] };
	return { required: [...(body.required ?? [])], recommended: [...(body.recommended ?? [])] };
}
