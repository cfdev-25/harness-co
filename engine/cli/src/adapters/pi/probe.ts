import { join } from "node:path";
import type { Blocker, ProbeRunner, RenderContext } from "@harness/compose/contracts";
import { PI_PIN } from "./locate.js";

/**
 * Under the exact session profile (C26), after render and before the person's
 * session. It never sends a model request (D93): the fence guarantees a
 * request goes to the proxy or nowhere (05), and `rehydrate` has already
 * proved the config points there.
 */
export async function probe(ctx: RenderContext, run: ProbeRunner): Promise<void> {
	const version = await run([process.execPath, ctx.choices.located.path, "--version"]);
	const reported = version.stdout.trim().split(/\s+/).pop() ?? "";
	if (!reported.includes(PI_PIN.version)) {
		throw {
			code: "adapter.probe_version",
			message: `Pi ${reported || "(no version)"} started, but ${PI_PIN.version} was checked.`,
			remedy: "Re-run the command.",
		} satisfies Blocker;
	}
	// An unexpected success here is a failure (I5): the store must be out of reach.
	const ambient = await run(["/bin/cat", join(process.env.HOME ?? "", ".pi", "agent", "auth.json")]);
	if (ambient.code === 0) {
		throw {
			code: "adapter.probe_ambient",
			message: "`~/.pi/agent/auth.json` is readable inside the session.",
			remedy: "This is a sandbox defect; report it.",
		} satisfies Blocker;
	}
}
