import { accessSync, constants } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { safeName } from "../core.js";
import { assetContents, assetsByKind, layoutSections, writeAssetFiles } from "./layout.js";
import type { Adapter, RenderContext } from "./types.js";

/**
 * Runs as `node <this file> <audit.jsonl path>`, fed one hook event as JSON
 * on stdin. Registered under both `PostToolUse` and `PostToolUseFailure`
 * (never `PreToolUse`): a Pre payload carries no `duration_ms` and no
 * outcome, so a line written from it would either lie about both or
 * duplicate the line the matching Post event writes — and a failed tool call
 * (a Bash command that exits non-zero, verified against claude 2.1.275)
 * fires `PostToolUseFailure`, not `PostToolUse`, so that hook alone would
 * silently drop every failure from the trail. Together these two give
 * exactly one line per finished call, success or failure, matching the one
 * `tool_result`-time line Pi's extension writes per call
 * (pi/packages/harness/src/index.ts).
 *
 * Written as CommonJS regardless of the file extension node would otherwise
 * infer, so a stray `package.json` somewhere above the session directory can
 * never flip how this parses.
 */
const AUDIT_HOOK_SCRIPT = `"use strict";
const { appendFileSync, readFileSync } = require("node:fs");

const auditPath = process.argv[2];
const event = JSON.parse(readFileSync(0, "utf8"));
const ok = event.hook_event_name !== "PostToolUseFailure";
const input = event.tool_input && typeof event.tool_input === "object" ? event.tool_input : {};
// Claude's own tool vocabulary (Bash, Write, Edit, Grep, ...) is not Pi's
// (bash, write, edit, grep, ...), so this does not attempt Pi's plainAction
// register (pi/packages/harness/src/core.ts) — one identifying input field,
// whichever the tool happened to send, is enough for an audit line to be
// legible without inventing a second tool-name mapping (agents.md §7.1.2).
const detail = String(
  input.command ?? input.file_path ?? input.pattern ?? input.path ?? input.url ?? JSON.stringify(input),
);
const line = {
  action: "tool.call",
  payload: {
    tool: event.tool_name,
    plain_sentence: \`\${event.tool_name}: \${detail}\`.slice(0, 240),
    duration_ms: typeof event.duration_ms === "number" ? event.duration_ms : 0,
    ok,
  },
  occurred_at: new Date().toISOString(),
};
appendFileSync(auditPath, \`\${JSON.stringify(line)}\\n\`);
`;

async function render(ctx: RenderContext): Promise<void> {
	const { manifest, sessionDir: root, agentDir: agent } = ctx;
	await mkdir(join(agent, "skills"), { recursive: true, mode: 0o700 });
	await mkdir(join(agent, "commands"), { recursive: true, mode: 0o700 });

	const byKind = assetsByKind(manifest);
	for (const skill of byKind("skill")) await writeAssetFiles(join(agent, "skills", safeName(skill.name)), skill);

	// Same ordering as Pi's AGENTS.md (layout.ts): system prompts are the
	// preamble, memories are standing context after it, broadest scope first
	// within each so a user's own prompt extends the team's rather than
	// preceding it. Both land in CLAUDE.md, which Claude Code loads into the
	// system prompt on every turn the same way Pi loads AGENTS.md.
	const instructions = [...layoutSections(byKind("system_prompt")), ...layoutSections(byKind("memory"))].join("\n\n");
	await writeFile(join(agent, "CLAUDE.md"), `${instructions}\n`);

	// A saved prompt is Claude Code's slash command: one file per name, same
	// rule as Pi's `--prompt-template` directory, nothing reaches the model
	// until the user picks it.
	for (const saved of byKind("prompt")) {
		await writeFile(join(agent, "commands", `${safeName(saved.name)}.md`), assetContents(saved), { mode: 0o600 });
	}

	const hookScript = join(agent, "audit-hook.cjs");
	await writeFile(hookScript, AUDIT_HOOK_SCRIPT, { mode: 0o700 });
	const auditPath = join(root, "audit.jsonl");
	// Quoted: the hook command runs through a shell, and both paths live
	// under $HOME which can contain spaces.
	const hookCommand = `"${process.execPath}" "${hookScript}" "${auditPath}"`;
	const settings = {
		hooks: {
			PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand }] }],
			PostToolUseFailure: [{ matcher: "*", hooks: [{ type: "command", command: hookCommand }] }],
		},
	};
	// Not named settings.json: `--setting-sources user` (launch, below) makes
	// Claude Code load `$CLAUDE_CONFIG_DIR/settings.json` a second time as the
	// "user" tier. A file that is both that auto-loaded tier and the
	// `--settings` file registers its hooks twice — one audit line becomes
	// two, confirmed against claude 2.1.275 by running one Bash call through
	// exactly that arrangement and counting appended lines.
	await writeFile(join(agent, "claude-settings.json"), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });

	await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function locateClaudeBinary(): string {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, "claude");
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Not here; keep looking.
		}
	}
	throw new Error(
		"Claude Code is not installed: no `claude` binary on your PATH. " +
			"Install it from https://claude.com/claude-code, or run `harness run pi` instead.",
	);
}

function launch(ctx: RenderContext): { argv: string[]; env: Record<string, string> } {
	const claudeBinary = locateClaudeBinary();
	const settingsPath = join(ctx.agentDir, "claude-settings.json");
	const env: Record<string, string> = {
		CLAUDE_CONFIG_DIR: ctx.agentDir,
		// Verified present in the 2.1.275 binary: the harness chose this
		// binary off PATH, and a session should not silently become a
		// different one, or phone home while it runs (docs/claude-code-notes.md
		// does not cover these; confirmed directly against the binary's
		// strings instead — agents.md §8's "disable self-update" for Claude
		// Code, short of the version pin `locate()` will add).
		DISABLE_AUTOUPDATER: "1",
		DISABLE_TELEMETRY: "1",
		DISABLE_ERROR_REPORTING: "1",
		CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
	};
	if (ctx.manifest.model) {
		env.ANTHROPIC_BASE_URL = ctx.manifest.model.base_url;
		env.ANTHROPIC_MODEL = ctx.manifest.model.model_id;
		// Claude Code's own credential precedence only reads ANTHROPIC_API_KEY,
		// ANTHROPIC_AUTH_TOKEN, or apiKeyHelper — never an arbitrary variable
		// name. `index.ts` delivers the provider key under the org's own
		// `model.env_var` (core.ts), so proxied auth only lands here today when
		// an org happens to have named its key one of those two. 13.6 adds
		// `wire_format` and a real per-agent credential mapping; inventing one
		// now would guess at a shape that task, not this one, is meant to define.
	}
	return {
		argv: [claudeBinary, "--settings", settingsPath, "--setting-sources", "user"],
		env,
	};
}

export const claude: Adapter = { id: "claude", render, launch };
