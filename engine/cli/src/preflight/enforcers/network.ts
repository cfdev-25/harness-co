import { covers, effectiveReach } from "@harness/compose";
import type { Enforcer } from "@harness/compose/contracts";

/**
 * 03 §5.7 row 1. Runs after `credentials` because the upstream hosts are the
 * connector table's. P5/D20: a chain with no endpoint boundary has `deny = []`
 * and still has the derived host list, never `[]`.
 *
 * `hosts` is now only ever that derived list (D131 retired `"any"`): the rest
 * of the internet is `reach`, which the harness takes the last step on here —
 * this is the one place that knows both the chain and the chosen harness.
 */
export const network: Enforcer = {
	name: "network",
	plan(composed, choices, _minted, plan) {
		const derived = new Set(Object.values(plan.connectors).map((connector) => new URL(connector.upstream).hostname));
		derived.add(new URL(choices.model.endpoint).hostname);
		const deny = composed.policy.boundaries
			.filter((boundary) => boundary.kind === "endpoint" && covers(boundary.scope, composed.chain, choices.harness?.id ?? null))
			.map((boundary) => boundary.value);
		// The deny list is applied always, whatever reach says (P3).
		return { ...plan, hosts: [...derived].sort(), deny: [...plan.deny, ...deny], reach: effectiveReach(composed.policy.reach, choices.harness) };
	},
};
