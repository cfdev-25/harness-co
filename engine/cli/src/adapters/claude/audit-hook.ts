/**
 * Runs as `node <this file> <audit.jsonl path>`, fed one hook event as JSON
 * on stdin. Registered under both `PostToolUse` and `PostToolUseFailure`
 * (never `PreToolUse`): a Pre payload carries no `duration_ms` and no
 * outcome, so a line written from it would either lie about both or
 * duplicate the line the matching Post event writes — and a failed tool call
 * (a Bash command that exits non-zero, verified against claude 2.1.275)
 * fires `PostToolUseFailure`, not `PostToolUse`, so that hook alone would
 * silently drop every failure from the trail (C8). Together these two give
 * exactly one line per finished call, success or failure, matching the one
 * `tool_result`-time line Pi's extension writes per call.
 *
 * Written as CommonJS regardless of the file extension node would otherwise
 * infer, so a stray `package.json` somewhere above the session directory can
 * never flip how this parses.
 */
export const AUDIT_HOOK_SCRIPT = `"use strict";
const { appendFileSync, readFileSync } = require("node:fs");

const auditPath = process.argv[2];
const event = JSON.parse(readFileSync(0, "utf8"));
const ok = event.hook_event_name !== "PostToolUseFailure";
const input = event.tool_input && typeof event.tool_input === "object" ? event.tool_input : {};
// Claude's own tool vocabulary (Bash, Write, Edit, Grep, ...) is not Pi's
// (bash, write, edit, grep, ...), so this does not attempt Pi's plainAction
// register (pi/packages/harness/src/core.ts) — one identifying input field,
// whichever the tool happened to send, is enough for an audit line to be
// legible without inventing a second tool-name mapping.
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
