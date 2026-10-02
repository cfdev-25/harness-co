import { covers } from "@harness/compose";
import type { Enforcer } from "@harness/compose/contracts";

/**
 * 03 §5.7 row 6 (W6-D153). Boundaries of kind `command` onto the plan, so the
 * two adapters read them from `SpawnPlan` and neither filters the composed
 * policy for itself — the road `deny` (endpoints, `network`) and `denyWrite`
 * (`filesystem`) already travel.
 *
 * Nothing is enforced here and nothing can be: a command boundary is
 * `intercepted`, which means the runtime is asked to refuse the call before it
 * runs (06 §13). Pi's extension does it with `commandMatches`; Claude Code
 * does it with a `permissions.deny` rule the adapter writes, and only for the
 * patterns its own matcher can hold (07 §8). A pattern neither can hold is a
 * pattern that is not on the plan: `commandMatches` is also what validated it
 * at the write, so by here every pattern says something.
 */
export const commands: Enforcer = {
	name: "commands",
	plan(composed, choices, _minted, plan) {
		const covering = composed.policy.boundaries.filter(
			(boundary) => boundary.kind === "command" && covers(boundary.scope, composed.chain, choices.harness?.id ?? null),
		);
		const seen = new Set(plan.commands.map((one) => one.pattern));
		return {
			...plan,
			commands: [
				...plan.commands,
				...covering
					// The same pattern set twice on the chain is one refusal, and the
					// first node to set it is the one that gets named.
					.filter((boundary) => !seen.has(boundary.value) && seen.add(boundary.value))
					.map((boundary) => ({ id: boundary.id, pattern: boundary.value, reason: boundary.reason })),
			],
		};
	},
};

