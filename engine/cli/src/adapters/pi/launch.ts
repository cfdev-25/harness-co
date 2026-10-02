import { join, resolve } from "node:path";
import type { Located, RenderContext } from "@harness/compose/contracts";
import { repoRoot } from "../../paths.js";

/**
 * `argv[0]` is the interpreter, because Pi ships as a bundle rather than an
 * executable. `env` holds only Pi's own keys: `childEnvironment` (08 §7)
 * throws on a collision with a core one (A4), and the credential the child
 * presents is the proxy's session secret it reads from
 * `$HARNESS_SESSION_SECRET` — never a provider key (A7).
 */
export function launch(ctx: RenderContext, located: Located): { argv: string[]; env: Record<string, string> } {
	// The extension and the theme stay beside Pi (00 §2); only the CLI moved.
	const extension = resolve(repoRoot(), "pi/packages/harness/dist/index.js");
	const theme = resolve(repoRoot(), "pi/packages/harness/themes/harness-dark.json");
	return {
		argv: [
			process.execPath,
			located.path,
			// Catalogue refresh and update checks only; never the OAuth refresh
			// a native-mode session needs, which `--offline` does not gate.
			"--offline",
			"--no-approve",
			"--no-extensions",
			"-e",
			extension,
			"--theme",
			theme,
			"--use-theme",
			"harness-dark",
			// Discovery off, then the one directory we delivered, named.
			"--no-prompt-templates",
			"--prompt-template",
			join(ctx.agentDir, "prompts"),
		],
		env: {
			PI_CODING_AGENT_DIR: ctx.agentDir,
			PI_CODING_AGENT_SESSION_DIR: join(ctx.agentDir, "sessions"),
			PI_TELEMETRY: "0",
		},
	};
}
