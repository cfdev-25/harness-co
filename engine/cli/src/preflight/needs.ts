import { scopeSpecificity } from "@harness/compose";
import type { Blocker, Choices, Composed, ComposedAsset, Grant, SecurityGroup, Slot } from "@harness/compose/contracts";
import { LOCAL_PROBES } from "./probes.js";

type Candidate = { grant: Grant; entry: SecurityGroup["entries"][number] };
const unsatisfied = (need: Slot["need"], blocker?: Blocker): Slot => ({ need, state: "unsatisfied", evidence: "declared", resolvedFrom: null, ...(blocker ? { blocker } : {}) });

/**
 * 03 §5.4–§5.5, before mint, pure. One `Slot` per `Need` in every loaded
 * sidecar, in load order then declaration order. A format mismatch (step 5) is
 * a `Blocker` and not a slot, so both lists come back.
 */
export function walkNeeds(composed: Composed, choices: Choices, load: { loaded: ComposedAsset[]; missing: string[] }): { slots: Slot[]; blockers: Blocker[] } {
	const slots: Slot[] = [];
	const blockers: Blocker[] = [];
	const byId = new Map(composed.assets.map((one) => [one.id, one]));
	const loadedIds = new Set(load.loaded.map((one) => one.id));
	const teams = composed.chain.filter((node) => node.kind === "team").map((node) => node.path);
	const here = teams[teams.length - 1] ?? composed.chain[0]?.path ?? "your organization";
	const parent = teams[teams.length - 2];
	const harnessName = choices.harness?.name ?? "this harness";

	// Step 1: the model credential first, so the mint call's `aliases` lead with
	// it. A model provider with no `credential` is gateway mode: no slot.
	const modelAlias = choices.model.provider.credential?.alias;
	// D11/D9: in native mode nothing covers the alias by design, so the slot is
	// `deferred` against the person's own sign-in rather than a missing group.
	if (modelAlias !== undefined && choices.native) {
		slots.push({ need: { kind: "credential", alias: modelAlias }, state: "deferred", evidence: "declared", resolvedFrom: { source: "local", tool: choices.provider.id } });
	} else if (modelAlias !== undefined) slots.push(credentialSlot(modelAlias));

	// §5.3 step 5 → a slot per assigned id the chain does not provide (P8).
	for (const id of load.missing) {
		slots.push(
			unsatisfied({ kind: "asset", id }, {
				code: "preflight.asset_missing",
				message: `${harnessName} names an asset that nothing on your chain provides.`,
				remedy: `Remove ${id} from ${harnessName}, or ask an admin to share it with you.`,
				link: choices.harness ? `/console/org/harnesses/${choices.harness.id}` : "/console/org/harnesses",
			}),
		);
	}

	for (const asset of load.loaded) {
		for (const need of asset.sidecar.needs ?? []) {
			// Step 2: composition is a fact, so a present id is verified.
			if (need.kind === "asset") {
				if (loadedIds.has(need.id)) slots.push({ need, state: "satisfied", evidence: "verified", resolvedFrom: null });
				else {
					const wanted = byId.get(need.id);
					// P8: an id the chain never delivered names the chain, not the harness.
					const remedy = wanted
						? `Add ${wanted.name} to ${harnessName}, or remove ${asset.name}.`
						: `Nothing on ${composed.chain.map((node) => node.path).join(" › ")} provides ${need.id}; ask an admin to share it, or remove ${asset.name}.`;
					slots.push(unsatisfied(need, { code: "preflight.asset_needed", message: `${asset.name} needs ${wanted?.name ?? need.id}, which is not in this harness.`, remedy }));
				}
			} else if (need.kind === "environment") {
				// W5-D15: a tool's environment travels with it — the harness lists it or it does not.
				if (load.loaded.some((one) => one.kind === "environment" && one.name === need.name)) {
					slots.push({ need, state: "satisfied", evidence: "verified", resolvedFrom: null });
				} else {
					slots.push(unsatisfied(need, {
						code: "preflight.asset_needed",
						message: `${asset.name} needs the environment ${need.name}, which is not in this harness.`,
						remedy: `Add environment/${need.name} to ${harnessName}, or remove ${asset.name}.`,
					}));
				}
			} else if (need.kind === "login") {
				// Step 4: a tool in the table is probed later (§5.9); one that is not is
				// an OAuth in the provider's own store and is never counted as satisfied.
				slots.push({ need, state: need.tool in LOCAL_PROBES ? "unsatisfied" : "deferred", evidence: "declared", resolvedFrom: null });
			} else slots.push(credentialSlot(need.alias));
		}
		// Step 5 (C19), per asset: a format mismatch names both sides.
		const format = asset.sidecar.format;
		if (format !== undefined && format !== choices.model.wireFormat) {
			blockers.push({
				code: "preflight.asset_format",
				message: `${asset.name} needs the ${format} format, and ${choices.model.provider.id} exposes ${Object.keys(choices.model.provider.endpoints).join(", ")}.`,
				remedy: `Drop it from this harness, or route through a provider exposing ${format}.`,
				link: `/console/org/assets/${asset.id}`,
			});
		}
	}
	return { slots, blockers };

	/** Step 3's `compatible(alias)`: every grant/group/entry that could fill it. */
	function compatible(alias: string): Candidate[] {
		return choices.grants.flatMap((grant) => {
			const group = grant.group === undefined ? undefined : composed.policy.groups[grant.group];
			if (group === undefined) return [];
			if (grant.narrowedFrom !== undefined && !grant.narrowedFrom.aliases.includes(alias)) return [];
			return group.entries.filter((entry) => entry.alias === alias).map((entry) => ({ grant, entry }));
		});
	}

	function credentialSlot(alias: string): Slot {
		const need = { kind: "credential", alias } as const;
		const ranked = compatible(alias).sort((a, b) => rank(b.grant) - rank(a.grant));
		if (ranked.length === 0) {
			// The PRD's sentence: a sub-team asks its parent, a top-level team the org.
			const remedy = parent === undefined ? `Ask an organization admin to grant a group holding \`${alias}\` to ${here}.` : `Ask a ${parent} admin to narrow one into the sub-team.`;
			return unsatisfied(need, { code: "preflight.no_compatible_group", message: `${here} holds no group with an entry for \`${alias}\`.`, remedy, link: "/console/org/groups" });
		}
		// D51: the narrowest grant wins, and an exact tie refuses rather than guesses.
		if (ranked.length > 1 && rank(ranked[0].grant) === rank(ranked[1].grant)) {
			return unsatisfied(need, {
				code: "preflight.ambiguous_group",
				message: `Two grants of equal scope hold \`${alias}\`: ${ranked[0].grant.id}, ${ranked[1].grant.id}.`,
				remedy: "Ask an organization admin to remove one of them, or to narrow one further.",
				link: "/console/org/groups",
			});
		}
		// The candidate is recorded and stays `declared` until the broker answers (§5.5).
		const { grant, entry } = ranked[0];
		return { need, state: "unsatisfied", evidence: "declared", resolvedFrom: { source: "vault", vault: entry.secret.vault, group: grant.group as string, grant: grant.id } };
	}

	/** `(depth, narrowed)` lexicographically, as one comparable number. */
	function rank(grant: Grant): number {
		const [depth, narrowed] = scopeSpecificity(grant.scope, composed.chain);
		return depth * 2 + narrowed;
	}
}
