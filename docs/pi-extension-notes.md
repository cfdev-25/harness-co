# Pi extension gating spike notes

Verified against the vendored `@earendil-works/pi-coding-agent` 0.85.1 documentation, examples, types, and resource loader.

## Exact extension APIs

- `pi.on("tool_call", handler)` runs after `tool_execution_start` and before execution. The event has `type`, `toolCallId`, `toolName`, and mutable `input`. Mutating `event.input` changes execution without revalidation. Returning `{ block: true, reason?: string, terminate?: boolean }` blocks the call.
- `pi.on("tool_result", handler)` runs after execution and before `tool_execution_end` and final tool-result message emission. The event has `toolCallId`, `toolName`, `input`, `content`, `details`, `isError`, and optional `usage`. A handler may return a partial `{ content?, details?, isError?, usage? }`; handlers compose in extension load order.
- `pi.registerCommand(name, { description?, getArgumentCompletions?, handler })` registers `/name`. Duplicate names remain available with numeric suffixes in load order.
- `pi.getAllTools(): ToolInfo[]`, `pi.getActiveTools(): string[]`, and `pi.setActiveTools(names: string[]): void` inspect and change the active built-in, SDK, and extension tools. Unknown names passed to `setActiveTools` are ignored. Tools can be registered dynamically and are refreshed immediately.

The spike logs each `tool_call`, hard-blocks `bash`, applies `read,grep,find,ls` as the active allowlist at `session_start` and `before_agent_start`, and blocks any non-allowlisted call as a final pre-execution check. `/gating-status` re-applies and reports the policy.

## Confirmation primitive

The primitive is:

```typescript
ctx.ui.confirm(
  title: string,
  message: string,
  opts?: { signal?: AbortSignal; timeout?: number },
): Promise<boolean>
```

`ctx.hasUI` is `true` in TUI and RPC modes and `false` in print (`-p`) and JSON modes. A gate must check it and fail closed when confirmation is required but no UI exists. There is no built-in universal permission policy or confirmation layer; extensions implement the decision and return a blocked `tool_call`.

## Tool-result redaction interception

Redaction can replace text content before it becomes the final tool-result message:

```typescript
pi.on("tool_result", (event) => ({
  content: event.content.map((item) =>
    item.type === "text"
      ? { ...item, text: redact(item.text) }
      : item
  ),
  details: redactDetails(event.details),
}));
```

Both `content` and `details` need consideration. This hook is post-execution and does not erase side effects. It also does not cover partial `tool_execution_update` output, logs emitted by the tool or another extension, direct user `!`/`!!` shell commands (`user_bash` is a separate event), model-provider traffic, or data observed by an earlier-loaded extension. Image content requires a separate policy; a text replacement does not inspect pixels.

## Resource settings and load paths

Relevant settings files and exact keys:

- Global: `~/.pi/agent/settings.json`
- Project: `.pi/settings.json`
- `packages`: package source strings or objects; object filters include `source`, optional `autoload`, and optional `extensions`, `skills`, `prompts`, and `themes` arrays.
- `extensions`: local extension file/directory paths.
- `skills`, `prompts`, and `themes`: other resource paths.
- `defaultProjectTrust`: global-only fallback, `"ask"` (default), `"always"`, or `"never"`.
- `npmCommand`: argv array used for npm lookup/install operations.

Automatic extension discovery also includes `~/.pi/agent/extensions/*.ts`, `~/.pi/agent/extensions/*/index.ts`, `.pi/extensions/*.ts`, and `.pi/extensions/*/index.ts`. Pi packages execute with full system access.

There is no `--no-packages` flag. Emptying `packages` in both settings scopes prevents configured package sources, but is configuration, not an immutable policy. `--no-extensions` is the relevant runtime control: it excludes discovered/configured/package extensions while still allowing explicit `-e` paths.

## Best available hermetic launch

From the repository root:

```bash
cd /Users/cf/projects/harness-co
pi \
  --offline \
  --no-approve \
  --no-extensions \
  -e ./scripts/spike-gating/ext.ts \
  --no-skills \
  --no-prompt-templates \
  --no-themes \
  --no-context-files \
  --tools read,grep,find,ls
```

- `--no-extensions` disables discovery but deliberately permits the explicit local `-e`.
- `--no-approve` ignores project-local settings/resources for this run.
- `--offline` (equivalent startup behavior to `PI_OFFLINE=1`) disables startup network operations, including package update/install checks and telemetry; it does not sandbox runtime tool network access.
- `--tools` is a native allowlist covering built-in, extension, and custom tools. It is stronger initial filtering than extension-only `setActiveTools`, and the extension's `tool_call` check is a second best-effort layer.
- The other `--no-*` flags remove instruction/resource discovery that is unnecessary to this spike.

For a controlled deployment, also use a clean dedicated home/agent directory or pre-audited global settings, pin the Pi build and extension bytes, pass only a local `-e` path, and enforce filesystem/process/network boundaries outside Pi.

## Honest limits

This proves an experience-layer gate, not a security boundary:

1. The extension and Pi run with the user's privileges. A user or compromised process can edit/remove the extension, change flags/settings, invoke another Pi binary, or call tools outside Pi.
2. `setActiveTools` controls what is advertised/active, but another extension can register or reactivate tools later. Re-applying before each run and blocking at `tool_call` narrows that race; it does not make the client tamper-proof.
3. `tool_call` covers LLM tool execution routed through Pi's extension runner. Direct user shell (`!`/`!!`) uses `user_bash`, and arbitrary extension code can use Node APIs or `pi.exec` without creating a `tool_call`.
4. Tool calls from one assistant message are preflighted sequentially and may execute concurrently. The handler cannot rely on sibling results from that batch.
5. Client logs are attested telemetry: they can contain sensitive arguments, fail, be altered, or be suppressed. Production logging needs input redaction, durable delivery, and server-side authoritative events at credential/network choke points.
6. Confirmation is unavailable in print/JSON modes and depends on the RPC host in RPC mode. A missing UI must mean deny, not allow.
7. `--offline` governs Pi startup networking only. Real egress and filesystem enforcement require an OS/container sandbox; credential authorization must be enforced where credentials are issued or used.

## Headless and durable-session spike

The deterministic provider configuration is checked in at
`scripts/spike-headless/agent/models.json`. The verified provider shape uses:

- `api: "openai-completions"`
- `baseUrl: "http://127.0.0.1:8401/v1"`
- `apiKey: "$MOCK_API_KEY"` (the dollar prefix is required for environment lookup)
- `compat.supportsDeveloperRole: false`
- `compat.supportsReasoningEffort: false`

The vendored executable is `pi/packages/coding-agent/dist/bundle/cli.js`. The
verified hermetic headless invocation sets both `PI_CODING_AGENT_DIR` and
`PI_CODING_AGENT_SESSION_DIR`, then uses explicit provider/model selection and
all resource-discovery opt-outs. It returned `MOCK_PROVIDER_OK: say hello`.

Pi persisted a JSONL session under the isolated session directory. A subsequent
`-c -p "resume works"` invocation reopened that session and returned
`MOCK_PROVIDER_OK: resume works`. Because the mock responds synchronously in
milliseconds, the destructive mid-stream kill portion was not timing-stable;
durable persistence and explicit resume were verified without modifying Pi.
