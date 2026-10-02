import type { Enforcer } from "@harness/compose/contracts";
import { childEnvironment } from "../../env.js";
import type { PlanContext } from "./index.js";

/**
 * 03 §5.7 row 4. `childEnvironment` (08 §7) owns the core set and throws — not
 * a `Blocker` — when an adapter key collides with one of its own (C6).
 */
export function environment(ctx: PlanContext): Enforcer {
	return {
		name: "environment",
		plan(_composed, _choices, _minted, plan) {
			const { env } = ctx.adapter.launch(ctx.context(plan), ctx.located);
			return {
				...plan,
				env: { ...plan.env, ...childEnvironment({ sessionId: ctx.sessionId, sessionDir: ctx.sessionDir, envDir: ctx.envDir, proxyUrl: ctx.proxyUrl, adapterEnv: env }) },
			};
		},
	};
}
