import type { ChainNode, ComposedAsset, Conflict, Sidecar } from "./contracts.js";
import { SPECS, readJson } from "./policy.js";

/** One asset directory found on one node, before precedence is applied. */
export interface Placement {
	id: string;
	kind: string;
	name: string;
	from: ChainNode;
	/** git tree id of the asset directory on that node. */
	tree: string;
	sidecar: Sidecar;
}

export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 01 §5 rules 1–2, and 01 §6 step 4. `kind` is the `<kind>` directory segment;
 * a sidecar that names a different one is malformed rather than moved,
 * because the directory is the asset and the file is only its claim.
 */
export function readSidecar(bytes: Uint8Array, kind: string): Sidecar | string {
	const parsed = readJson(bytes, SPECS.sidecar, "asset.json");
	if ("why" in parsed) return parsed.why;
	const sidecar = parsed.value as Sidecar;
	if (sidecar.kind !== kind) return `asset.json says kind ${sidecar.kind}, but the directory is under ${kind}`;
	return sidecar;
}

/**
 * 01 §5 rule 3 / §6 step 4: one id appears at most once on one branch. All but
 * the first occurrence by path order are skipped — first, not last, so the
 * surviving copy does not change when somebody adds a directory later in the
 * alphabet.
 */
export function dedupeOnNode(
	node: ChainNode,
	found: Placement[],
): { kept: Placement[]; conflicts: Conflict[] } {
	const byPath = [...found].sort((a, b) => cmp(`${a.kind}/${a.name}`, `${b.kind}/${b.name}`));
	const first = new Map<string, Placement[]>();
	for (const placement of byPath) first.set(placement.id, [...(first.get(placement.id) ?? []), placement]);
	const conflicts: Conflict[] = [];
	for (const [id, copies] of [...first].sort((a, b) => cmp(a[0], b[0])))
		if (copies.length > 1)
			conflicts.push({
				kind: "duplicate-id-on-one-branch",
				id,
				from: node,
				paths: copies.map((copy) => `${copy.kind}/${copy.name}`),
			});
	return { kept: [...first.values()].map((copies) => copies[0]), conflicts };
}

/**
 * 01 §6 steps 5 and 6, and the D3 rules they encode (01 §5 rules 4–5).
 * `placements` is every kept placement in chain order, root first.
 *
 * Path first, precedence second: a contested path is dropped before anything
 * is declared a winner, so a same-path-different-id pair can never be read as
 * an override in one direction and a conflict in the other.
 */
export function resolveByIdAndPath(placements: Placement[]): { assets: ComposedAsset[]; conflicts: Conflict[] } {
	const conflicts: Conflict[] = [];
	const claimant = new Map<string, Placement>();
	// Fail closed (I5): 01 §9's message is "neither can be loaded", so both ids
	// go, not just the narrower claimant — nothing at that path resolves.
	const dropped = new Set<string>();
	for (const placement of placements) {
		const path = `${placement.kind}/${placement.name}`;
		const held = claimant.get(path);
		if (!held) {
			claimant.set(path, placement);
			continue;
		}
		// Same path, same id is an override (§5 rule 4); the narrower wins below.
		if (held.id === placement.id) continue;
		conflicts.push({
			kind: "same-path-different-id",
			path,
			a: { id: held.id, from: held.from },
			b: { id: placement.id, from: placement.from },
		});
		dropped.add(held.id);
		dropped.add(placement.id);
	}
	// 5. Precedence by id, chain order: the last copy is the narrowest, and the
	// one before it is what it shadows. A copy at a different path is a rename,
	// and the composed tree takes the narrower name (§5 rule 4).
	const byId = new Map<string, Placement[]>();
	for (const placement of placements)
		if (!dropped.has(placement.id)) byId.set(placement.id, [...(byId.get(placement.id) ?? []), placement]);
	const assets = [...byId.values()].map((copies) => {
		const won = copies[copies.length - 1];
		const under = copies[copies.length - 2];
		return {
			id: won.id,
			kind: won.kind,
			name: won.name,
			from: won.from,
			tree: won.tree,
			sidecar: won.sidecar,
			...(under ? { shadows: { from: under.from, tree: under.tree } } : {}),
		};
	});
	// 15. sorted by kind then name.
	assets.sort((a, b) => cmp(a.kind, b.kind) || cmp(a.name, b.name));
	return { assets, conflicts };
}
