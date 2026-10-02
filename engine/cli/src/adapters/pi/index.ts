import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, RenderContext } from "@harness/compose/contracts";
import { importPi } from "./import.js";
import { launch } from "./launch.js";
import { locate } from "./locate.js";
import { probe } from "./probe.js";
import { rehydrate } from "./rehydrate.js";
import { render } from "./render.js";

export { PI_PIN, piBundle } from "./locate.js";

/** A static claim about Pi, per 07 §6. Declared, never discovered: a
    difference between providers is in this table and nowhere else (A3). */
const capabilities = {
	skill: "native", // settings.json `skills: [dir…]` points into the work tree (D95)
	prompt: "native", // --prompt-template <agentDir>/prompts
	system_prompt: "native", // the extension returns it on before_agent_start (D137)
	memory: "emulated", // AGENTS.md after the system prompts
	tool_index: "emulated", // appended to AGENTS.md, absolute run paths
	tool_gating: "emulated", // the read geometry is the control (06); policy.json says why
	audit: "emulated", // the extension appends to the spool on tool_result
	state_isolation: "native", // PI_CODING_AGENT_DIR, PI_CODING_AGENT_SESSION_DIR
	project_suppression: "native", // --no-extensions --no-prompt-templates --no-approve
	model_org: "native", // models.json baseUrl → the proxy
	model_native: "native", // auth.json seeded from the stable store (§11)
} as const;

export const pi: Adapter = {
	id: "pi",
	displayName: "Pi",
	landing: "ours",
	// Pi's models.json `api` accepts either shape; openai-completions first
	// because that is what a bare base URL has always meant here.
	speaks: ["openai-completions", "anthropic-messages"],
	capabilities,
	// W7-D2. The providers Pi ships its own `/login` for — one OAuth flow each
	// in `pi/packages/ai/src/auth/oauth/`, named by Pi's own provider id. A
	// keyless one of these is *your sign-in*, not a missing key. The mirror the
	// server reads is `modelNative` in the harness-providers preset.
	modelNative: ["anthropic", "openai-codex", "openrouter", "github-copilot", "kimi-coding", "xai"],
	locate,
	/** The directory Pi auto-discovers settings, extensions and skills from,
	    so the agent cannot plant an extension the next session loads. A
	    directory, not a file, so none can be created beside a denied one. */
	denyWrite: (ctx: RenderContext) => [join(ctx.workspace, ".pi")],
	ambientStores: () => [join(homedir(), ".pi")],
	render,
	rehydrate,
	launch,
	import: importPi,
	probe,
};
