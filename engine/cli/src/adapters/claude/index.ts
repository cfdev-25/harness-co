import { homedir } from "node:os";
import { join } from "node:path";
import type { Adapter, RenderContext } from "@harness/compose/contracts";
import { importClaude } from "./import.js";
import { launch } from "./launch.js";
import { locate } from "./locate.js";
import { probe } from "./probe.js";
import { rehydrate } from "./rehydrate.js";
import { render } from "./render.js";

export { claudeOnPath, managedTier } from "./locate.js";

/** A static claim about Claude Code, per 07 §6. */
const capabilities = {
	skill: "emulated", // <configDir>/skills/<name> symlink; no external-skills setting exists (Spike 0a)
	prompt: "emulated", // <configDir>/commands/<name>.md, one slash command per prompt
	system_prompt: "native", // --append-system-prompt-file <agentDir>/system-prompt.md (D137, superseding D91)
	memory: "emulated", // CLAUDE.md after the system prompts
	tool_index: "emulated", // appended to CLAUDE.md
	tool_gating: "emulated", // permissions.deny is advisory; the read geometry is the control
	audit: "emulated", // PostToolUse + PostToolUseFailure hooks append to the spool
	state_isolation: "native", // CLAUDE_CONFIG_DIR + XDG_CONFIG_HOME
	project_suppression: "native", // --setting-sources user; claudeMdExcludes
	model_org: "native", // ANTHROPIC_BASE_URL → the proxy
	model_native: "native", // .credentials.json seeded from the stable store (§11)
} as const;

export const claudeAdapter: Adapter = {
	id: "claude",
	displayName: "Claude Code",
	speaks: ["anthropic-messages"],
	capabilities,
	// W7-D2. Claude Code's own sign-in is an Anthropic subscription and nothing
	// else (§11's `.credentials.json`). The mirror the server reads is
	// `modelNative` in the harness-providers preset.
	modelNative: ["anthropic"],
	locate,
	/** The directory Spike 4's `settings.json` and `settings.local.json` live
	    in. A directory, not a file, so neither can be created beside a denied
	    one (06 D81). This is one of A5's two halves. */
	// A5: the workspace tier it would discover, and the one file it loads — the
	// generated user tier `--setting-sources user` names —
	// so `update-config` or a shell redirect cannot add a hook mid-session.
	denyWrite: (ctx: RenderContext) => [join(ctx.workspace, ".claude"), join(ctx.agentDir, "settings.json")],
	/** Both stores the same binary reads. The macOS Keychain entry a login can
	    leave behind is Spike 3 (D11), closed by the fence at M4. */
	ambientStores: () => [join(homedir(), ".claude"), join(homedir(), ".config", "anthropic")],
	render,
	rehydrate,
	launch,
	import: importClaude,
	probe,
};
