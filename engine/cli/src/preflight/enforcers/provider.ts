import type { Enforcer } from "@harness/compose/contracts";
import type { PlanContext } from "./index.js";

/**
 * 03 §5.7 row 5. The passthrough is appended after the adapter's own argv; the
 * sandbox wrapper is prepended later, at spawn (06), so nothing typed after
 * `--` can place itself outside the profile.
 */
export function provider(ctx: PlanContext): Enforcer {
	return {
		name: "provider",
		plan(_composed, _choices, _minted, plan) {
			return { ...plan, argv: [...ctx.adapter.launch(ctx.context(plan), ctx.located).argv, ...ctx.passthrough] };
		},
	};
}
