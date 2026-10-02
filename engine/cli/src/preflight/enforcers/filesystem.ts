import { join } from "node:path";
import { covers } from "@harness/compose";
import type { Enforcer } from "@harness/compose/contracts";
import type { PlanContext } from "./index.js";

/** 06 §7.2's standing deny-read set, relative to `HOME`. */
const STANDING = [".config/harness", ".ssh", ".aws", ".gnupg", ".kube", ".docker", ".config/gh", ".npmrc", ".netrc", ".git-credentials", ".config/anthropic", ".claude", ".pi", ".harness/agents"];

/**
 * 03 §5.7 row 3 over 06 §7's geometry. Pure: the directory listing under
 * `assets/tool` is read by `preflight.ts` and arrives as `ctx.toolDirs`, so
 * this file computes and never looks.
 */
export function filesystem(ctx: PlanContext): Enforcer {
	return {
		name: "filesystem",
		plan(composed, choices, _minted, plan) {
			const loaded = new Set(ctx.loaded.map((asset) => asset.id));
			const boundaries = composed.policy.boundaries.filter((boundary) => covers(boundary.scope, composed.chain, choices.harness?.id ?? null));
			const denied = new Set(boundaries.filter((boundary) => boundary.kind === "capability").map((boundary) => boundary.value));
			// C12/C13: a tool directory on disk is readable only when its id is in
			// the load set and no covering capability boundary denies `tool.<name>`.
			// A directory with no sidecar cannot be classified, so it is denied.
			const excluded = ctx.toolDirs
				.filter((dir) => dir.id === null || !loaded.has(dir.id) || denied.has(`tool.${dir.name}`))
				.map((dir) => join(ctx.assetsRoot, "tool", dir.name));
			return {
				...plan,
				filesystem: {
					// 06 §7.1, set once and then frozen.
					allowWrite: [ctx.workspace, ctx.assetsRoot, ctx.agentDir, join(ctx.sessionDir, "audit.jsonl"), join(ctx.sessionDir, "tmp"), ctx.envDir],
					denyRead: [
						...plan.filesystem.denyRead,
						...STANDING.map((path) => join(ctx.home, path)),
						join(ctx.sessionDir, "denied"),
						...excluded,
						...ctx.adapter.ambientStores(),
						...boundaries.filter((boundary) => boundary.kind === "filesystem").map((boundary) => boundary.value),
					],
					denyWrite: [...plan.filesystem.denyWrite, ...ctx.adapter.denyWrite(ctx.context(plan))],
				},
			};
		},
	};
}
