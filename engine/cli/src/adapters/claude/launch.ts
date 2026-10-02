import { join } from "node:path";
import type { Located, RenderContext } from "@harness/compose/contracts";
import { SYSTEM_PROMPT_FILE } from "./render.js";

/**
 * `--setting-sources user` drops the workspace's skills, commands and
 * `CLAUDE.md` together, and is A5's second half against `disableAllHooks` in
 * a project settings file (Spike 4: a project file at precedence 3 beats a
 * `--settings` hook at level 2 for that key).
 */
export function launch(ctx: RenderContext, located: Located): { argv: string[]; env: Record<string, string> } {
	const proxy = new URL(ctx.proxyUrl);
	const env: Record<string, string> = {
		CLAUDE_CONFIG_DIR: ctx.agentDir,
		// Its Bash tool and hooks scratch under `/tmp/claude-<uid>` by default,
		// which the jail denies (06 §7.1) — every shell call failed EPERM before
		// this. TMPDIR is not consulted for it; this variable is (2.1.283).
		CLAUDE_CODE_TMPDIR: join(ctx.sessionDir, "tmp"),
		// CLAUDE_CONFIG_DIR does not relocate ~/.config/anthropic, a second
		// profile store the same binary reads; a fresh XDG_CONFIG_HOME flips
		// `claude auth status` from loggedIn:true to false (verified 2.1.278).
		XDG_CONFIG_HOME: ctx.agentDir,
		DISABLE_AUTOUPDATER: "1",
		DISABLE_TELEMETRY: "1",
		DISABLE_ERROR_REPORTING: "1",
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
		// The origin: a URL carrying credentials cannot be fetched, and the secret
		// belongs in the header, not in the child's environment twice (07 §7).
		ANTHROPIC_BASE_URL: `${new URL(ctx.proxyUrl).origin}/connectors/model`,
		ANTHROPIC_MODEL: ctx.choices.model.model,
		// The proxy's per-session secret, not a provider key: Claude Code will
		// not send a request without a token in `Authorization`, and the proxy
		// verifies this one and replaces it on the way out (C23, A7). It
		// authorises nothing but this session's loopback proxy.
		ANTHROPIC_AUTH_TOKEN: decodeURIComponent(proxy.password),
	};
	return {
		// The generated `settings.json` is the user tier itself; `--settings` is not
		// used — 2.1.283 applied nothing from it inside a session (07 §8, C9).
		// W5-D11 (D137): `--append-system-prompt-file` is the native seam for the
		// `system_prompt` assets, proved to take effect in an interactive session
		// on 2.1.283 and not only under `-p`. `render` always writes the file, so
		// this argv does not depend on the load set.
		argv: [located.path, "--setting-sources", "user", "--append-system-prompt-file", join(ctx.agentDir, SYSTEM_PROMPT_FILE)],
		env,
	};
}
