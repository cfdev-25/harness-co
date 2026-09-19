# Claude Code adapter spike notes (Spikes 0, 1, 4)

Verified against `claude --version` = `2.1.275 (Claude Code)`, installed at
`/Users/cf/.local/bin/claude` -> `/Users/cf/.local/share/claude/versions/2.1.275`
(native build, commit `51b25240a486` per `claude doctor`). Every invocation
below ran with `CLAUDE_CONFIG_DIR` set to a fresh `mktemp -d` and the real
`~/.claude`/`~/.claude.json` untouched (confirmed by mtime before/after).

Fixtures lived under `scripts/spike-claude/` (deleted once these notes
landed, per the precedent in `pi-extension-notes.md`):
- `external-skills/quokka-beacon/SKILL.md`, `external-skills/marmot-ledger/SKILL.md`
  — two distinctively-named skills, each instructing the model to emit one
  unique marker string (`QUOKKA-BEACON-MAGIC-9F3K`, `MARMOT-LEDGER-MAGIC-7Q2X`).
- `marketplace/` — a `.claude-plugin/marketplace.json` listing two plugins,
  each wrapping one of the above skills under `skills/<name>/SKILL.md`.
- `workspace/` and `workspace-hooks/` — fake project work trees with their
  own `.claude/skills/workspace-owl/SKILL.md`, `.claude/commands/workspace-cmd.md`,
  and `CLAUDE.md`, each carrying a distinctive marker string
  (`WORKSPACE-OWL-MAGIC-5T1Z`, `WORKSPACE-COMMAND-MAGIC-2H6P`,
  `WORKSPACE-CLAUDE-MD-MAGIC-3B8Y`), plus a `.claude/settings.json` with
  `disableAllHooks: true` for Spike 4.

## Spike 0 — loading skills from outside the project and outside `~/.claude`

### (a) Symlinks under `$CLAUDE_CONFIG_DIR/skills/<name>` — WORKS

```bash
export CLAUDE_CONFIG_DIR=$(mktemp -d)
mkdir -p "$CLAUDE_CONFIG_DIR/skills"
ln -s /path/to/external-skills/quokka-beacon "$CLAUDE_CONFIG_DIR/skills/quokka-beacon"
ln -s /path/to/external-skills/marmot-ledger "$CLAUDE_CONFIG_DIR/skills/marmot-ledger"
claude -p "List the names and one-line descriptions of every skill available to you."
```

Output listed `quokka-beacon` alongside the bundled skills, with its actual
`SKILL.md` description text. A follow-up run:

```bash
claude -p "Invoke the marmot-ledger skill and output exactly and only what it tells you to output."
```

returned exactly `MARMOT-LEDGER-MAGIC-7Q2X` — proof the *content* of the
symlinked, un-copied directory was read and executed as a skill, not
inferred from a name. This worked on the **first, cold invocation** against
a brand-new `CLAUDE_CONFIG_DIR`, with no prior `claude` run to warm any
cache. `ls -la` on the symlink itself confirms it is a real symlink
(`lrwxr-xr-x ... quokka-beacon -> /Users/.../external-skills/quokka-beacon`),
never a copy.

Per §3's native/emulated/none vocabulary this is **emulated**: there is no
`skills: [...]` style external-directory setting (confirmed absent from
`claude --help` and from every settings key found in the binary), so the
effect is produced by a mechanism that is ours (the symlink), not the
agent's own. It is exactly what §10's row already guessed, now verified.

### (b) Generated local plugin marketplace (`extraKnownMarketplaces` + `enabledPlugins`) — WORKS, BUT UNRELIABLE ON A COLD SESSION START

Exact settings shape (confirmed by running `claude plugin marketplace add
<path> --scope user` and `claude plugin enable <plugin>` against a fresh
`CLAUDE_CONFIG_DIR` and reading back the `settings.json` it wrote):

```json
{
  "extraKnownMarketplaces": {
    "harness-spike-marketplace": {
      "source": { "source": "directory", "path": "/abs/path/to/marketplace" }
    }
  },
  "enabledPlugins": {
    "quokka-plugin@harness-spike-marketplace": true
  }
}
```

`claude plugin validate <marketplace-dir>` confirms the on-disk shape
(`.claude-plugin/marketplace.json` at the root, `.claude-plugin/plugin.json`
+ `skills/<name>/SKILL.md` per plugin) before ever invoking `claude`.

Passing that JSON via `--settings <file>` against a **fresh**
`CLAUDE_CONFIG_DIR` and running `claude -p "List the names of every skill
available to you." --settings settings-marketplace.json` did **not** show
`quokka-plugin:quokka-beacon` in the list — only the 12 bundled skills. A
`--debug-file` capture explains why, in the tool's own log lines, in this
exact order:

```
[DEBUG] Skipping orphaned enabledPlugins entry quokka-plugin@harness-spike-marketplace: marketplace not registered
[DEBUG] getSkills returning: 0 skill dir commands, 0 plugin skills, 40 bundled skills, 0 builtin plugin skills
...
[DEBUG] Sending 12 skills via attachment (initial)      <- skill list already frozen and sent
...
[DEBUG] Reading marketplace from /.../marketplace/.claude-plugin/marketplace.json
[DEBUG] Added marketplace source: harness-spike-marketplace
[DEBUG] installPluginsForHeadless: installed marketplace harness-spike-marketplace
[DEBUG] Found 1 plugins (1 enabled, 0 disabled)          <- too late for this turn
```

The marketplace is registered and the plugin installed **asynchronously,
after** the skill manifest for turn 1 is already built and sent to the
model. Re-running the identical command against the **same** (now warm)
`CLAUDE_CONFIG_DIR` a second time does list `quokka-plugin:quokka-beacon`
immediately — `plugins/known_marketplaces.json` and
`plugins/installed_plugins.json` persist from the first run and the race is
gone.

**Consequence for the harness**: because the harness's own state-isolation
design gives every session a brand-new `CLAUDE_CONFIG_DIR` (§10: "state
isolation — native"), this mechanism as tested loses its plugin's skill on
the very first turn of every session unless the harness pre-warms the
config dir with a throwaway invocation first — added latency and complexity
the symlink mechanism does not need. Per-session subset *is* answerable
independently of the race: two different `--settings` files enabling
different `enabledPlugins` entries against the same marketplace produce
different skill sets (observed directly — the marketplace test above only
ever surfaced the one plugin named in that session's `enabledPlugins`), so
"can the enabled set differ per session" is **yes**, but the mechanism is
not fit to be the adapter's primary skill-loading path given (a) already
works cleanly.

One naming difference worth recording: the symlink mechanism surfaces the
skill under its bare name (`quokka-beacon`); the plugin mechanism surfaces
it as `<plugin>:<skill>` (`quokka-plugin:quokka-beacon`).

Also verified from the binary's own strings (not just behavior): a
marketplace declared under `extraKnownMarketplaces` with a **network**
source is refused unless declared in "USER or managed settings (project/local
scope cannot vouch for it)" — this restriction is stated as applying to
network sources specifically; a `"source": "directory"` (local filesystem)
source is not subject to it, consistent with it working from the
`--settings`-tier file above.

### (c) Other mechanisms found

- `claude plugin init|new <name>` — "Scaffold a new plugin at
  `~/.claude/skills/<name>/` (auto-loads next session as `<name>@skills-dir`)."
  Not tested; it writes inside the config dir rather than pointing at an
  external directory, so it does not answer the "no copy" requirement any
  better than (a), and is strictly a subset of what (a) already proves.
- No `--skills-dir` or equivalent CLI flag exists (absent from `claude
  --help` in 2.1.275).
- `claude doctor` and `claude plugin validate <path>` are useful
  pre-flight checks (structure/marketplace validation, binary/version
  identification) but reveal no additional loading mechanism.

**Spike 0 resolves to `emulated`** (§10, both rows): symlinks under
`$CLAUDE_CONFIG_DIR/skills/<name>` are the adapter's mechanism. The
generated-marketplace alternative is real but should not replace it.

## Spike 1 — stopping a session from loading the workspace's own `.claude/`

### Verified working mechanism: `--setting-sources user`

`claude --help` states: `--setting-sources <sources>` — "Comma-separated
list of setting sources to load (user, project, local)."

Baseline (no flag), run from inside a workspace with its own
`.claude/skills/workspace-owl/`, `.claude/commands/workspace-cmd.md`, and
`CLAUDE.md`:

```bash
cd workspace && claude -p "List every skill and slash command you have, and print any CLAUDE.md project memory you were given."
```

→ lists `workspace-owl` and `workspace-cmd`, and prints the workspace's
`CLAUDE.md` content verbatim (`WORKSPACE-CLAUDE-MD-MAGIC-3B8Y`). Confirmed
mechanistically via `--debug-file`:

```
[DEBUG] Loaded 2 unique skills (2 unconditional, 0 conditional, managed: 0, user: 0, project: 1, additional: 0, legacy commands: 1)
```

Same workspace, same fresh `CLAUDE_CONFIG_DIR`, adding `--setting-sources
user`:

```bash
cd workspace && claude -p "..." --setting-sources user
```

→ neither `workspace-owl` nor `workspace-cmd` appear in the skill/command
list, and the model reports no `CLAUDE.md` was injected into its context
(it could still `Read` the file directly off disk — this suppresses
auto-loading into context, not filesystem access, which is the sandbox's
job). Confirmed mechanistically, same debug line, same session, now:

```
[DEBUG] Loading skills from: managed=..., user=<config-dir>/skills, project=[/.../workspace/.claude/skills]
[DEBUG] Loaded 0 unique skills (0 unconditional, 0 conditional, managed: 0, user: 0, project: 0, additional: 0, legacy commands: 0)
[DEBUG] Hooks: Found 0 total hooks in registry            <- see Spike 4 below, same flag
```

The project directory is still *enumerated* as a candidate path but
contributes 0 loaded skills/commands — `--setting-sources user` is doing
real filtering, not merely something the model chose not to mention.

### `claudeMdExcludes` — narrower, CLAUDE.md-only suppression

Exact key, from the binary's own settings schema string: `claudeMdExcludes`
— *"Glob patterns or absolute paths of CLAUDE.md files to exclude from
loading. Patterns are matched against absolute file paths using picomatch.
Only applies to User, Project, and Local memory types (Managed/policy files
cannot be excluded)."*

```json
{ "claudeMdExcludes": ["/abs/path/to/workspace/CLAUDE.md"] }
```

passed via `--settings`, run inside that same workspace: `workspace-owl`
and `workspace-cmd` **still loaded** (this key is scoped to CLAUDE.md only,
confirmed — it did not touch skills/commands), but the model reported "None
was injected" for CLAUDE.md and had to `Read` the file to see its content.
This is the precise, surgical complement to `--setting-sources` when only
memory (not skills/commands) needs suppressing.

**Spike 1 resolves to a real, working mechanism, not `none`**:
`--setting-sources user` suppresses the workspace's own skills, commands,
and CLAUDE.md all at once (confirmed by both model output and the tool's
own debug counters); `claudeMdExcludes` suppresses CLAUDE.md alone. This
overturns §10's current `?` guess ("no documented switch for project
`.claude/skills`") — one exists, it is just a `--setting-sources` value
rather than a dedicated `--no-project-skills` flag.

Not tested, quoted verbatim from `claude --help` as documented-but-unverified
alternatives: `--restricted` ("ignores user, project and local settings
files (managed settings and --settings still apply)... also confines the
file tools to the working directories"); `--safe-mode` ("Start with all
customizations (CLAUDE.md, skills, plugins, hooks, MCP servers, custom
commands and agents, output styles, workflows, custom themes, keybindings,
and more) disabled"); `--bare` ("skip hooks, LSP, plugin sync, attribution,
auto-memory, background prefetches, keychain reads, and CLAUDE.md
auto-discovery"). All three are broader than `--setting-sources user` — in
particular `--safe-mode` and `--bare` read as likely to also disable the
skills/hooks the *harness itself* delivers via `--settings`, which would
defeat the point; `--setting-sources user` was preferred and verified
because it leaves the `--settings`-tier delivery intact (see Spike 4).

## Spike 4 — does project `disableAllHooks: true` beat `--settings`-tier hooks?

### Verified: YES, it does

`settings-hooks.json` (the harness's hypothetical generated hook, level 2):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "echo HOOK-FIRED-MAGIC-4K9L >> /tmp/spike-hook-fired.log" } ] }
    ]
  }
}
```

Control (neutral cwd, no project settings at all):

```bash
claude -p "Run the shell command: echo test-control" --settings settings-hooks.json
```

→ `/tmp/spike-hook-fired.log` contains `HOOK-FIRED-MAGIC-4K9L`. Hook fires.

Workspace with `<workspace>/.claude/settings.json` = `{ "disableAllHooks":
true }`, identical `--settings` file:

```bash
cd workspace-hooks && claude -p "Run the shell command: echo test-project-disable" --settings settings-hooks.json
```

→ the `Bash` tool call still ran (`Output: test-project-disable`), but
`/tmp/spike-hook-fired.log` was **never created**. `--debug-file` confirms
this is not a fluke of the marker file: `[DEBUG] Hooks: Found 0 total hooks
in registry` — the `--settings`-tier hook was never registered at all, on a
completely fresh session start (not a mid-session settings reload).

**This confirms the concern §7.2/§7.3 already named**: a project-level
`<workspace>/.claude/settings.json` at precedence level 3 (project) beats a
hook supplied at level 2 (`--settings`), even though 2 is nominally
"higher" in the CLI's own precedence story for most keys. `disableAllHooks`
specifically inverts that — any writable copy of this file inside the
sandboxed workspace can kill the harness's audit trail outright.
**`denyWrite` on `<workspace>/.claude/settings.json` and
`<workspace>/.claude/settings.local.json` (§7.3) is therefore not a nice-to-
have — it is necessary**, confirmed rather than assumed.

### Bonus finding: `--setting-sources user` is an independent, second mitigation

Same workspace, same `disableAllHooks: true`, adding `--setting-sources
user` to the launch (so `<workspace>/.claude/settings.json` is never read
at all, regardless of its content or who wrote it):

```bash
cd workspace-hooks && claude -p "Run the shell command: echo test-setting-sources-mitigation" --settings settings-hooks.json --setting-sources user
```

→ `/tmp/spike-hook-fired.log` **does** contain `HOOK-FIRED-MAGIC-4K9L`. The
project's `disableAllHooks` is neutralized because its file is never loaded
as a settings source in the first place — a second, independent choke
point (a CLI flag, not a filesystem permission) alongside `denyWrite`. Since
the adapter already wants `--setting-sources user` for Spike 1, this is not
extra work: **one flag answers both spikes' suppression needs and closes
the Spike 4 hole from a second direction.** It should not replace
`denyWrite` (a belt-and-suspenders redundancy is exactly the point — one is
a CLI launch argument the harness controls, the other is a sandbox
guarantee that holds even if a future code path forgets the flag), but it
is worth the adapter carrying both.

## Honest limits

1. **Marketplace cold-start race (Spike 0b) was observed on one machine,
   one run pattern.** The exact timing (whether the async plugin install
   ever finishes before turn 1's tool calls, on a slower disk or a
   network-sourced marketplace) was not characterized further; treat "loses
   the race on a fresh `CLAUDE_CONFIG_DIR`" as reproducible under the tested
   conditions, not as a timing constant.
2. **`--restricted`, `--safe-mode`, and `--bare` were not run.** Their
   effect on project skills/commands/CLAUDE.md, and on `--settings`-tier
   hooks and skills, is quoted verbatim from `claude --help` only — not
   verified. In particular, whether `--safe-mode` or `--bare` would also
   suppress the harness's own `--settings`-delivered hooks and symlinked
   skills (which would make them useless for this purpose) is unknown.
3. **`allowManagedHooksOnly` was not independently tested.** It surfaced in
   `--debug-file` output ("Skipping plugin hooks - allowManagedHooksOnly is
   enabled and no managed plugins") during the Spike 4 run even though it
   was never set in any settings file used here, suggesting it may default
   on under some condition this spike did not isolate. Not chased further.
4. **Precedence beyond `disableAllHooks` was not surveyed.** Whether other
   project-settings keys (e.g. `permissions.deny`, `env`) similarly beat
   `--settings`-tier equivalents, or whether the relationship is specific to
   `disableAllHooks`, was not tested.
5. **Managed-settings tier was not tested at all.** `doctor` reported "no
   organization" managed settings on this machine; §5.4's "managed settings
   outrank everything" claim is taken from documentation strings found in
   the binary, not exercised here — doing so would require an actual MDM
   profile or `managed-settings.json`, out of scope for a spike run as an
   unprivileged user.
6. **Why headless invocations authenticated with a fresh `CLAUDE_CONFIG_DIR`
   and no `ANTHROPIC_API_KEY` in the environment was not investigated.**
   `claude doctor` reported an organization policy loaded from
   `api.anthropic.com` and `[INFO] Using Anthropic profile auth
   (profile-implicit)` appeared in debug logs; the exact credential source
   (ambient login helper, some other machine-level config) was not traced,
   because it was not this task's question and every experiment still used
   an isolated `CLAUDE_CONFIG_DIR` regardless of how the model call itself
   got authorized.
7. **`--setting-sources project,local` (excluding `user` instead of
   `project`/`local`) was not tested**, so the exact interaction between the
   three source names beyond "user" alone (i.e., whether "project" and
   "local" behave symmetrically to each other) is not established — only
   that `user` alone reproduces the harness's desired suppression.

## Follow-up: hook payloads and settings-file naming

Established while building the adapter (task 13.5), same binary, against live
runs rather than documentation.

### A failing tool call fires `PostToolUseFailure`, not `PostToolUse`

Captured stdin from real runs:

```
PostToolUse:        {..., "hook_event_name":"PostToolUse", "tool_name":"Bash",
                     "tool_input":{...}, "tool_response":{...}, "duration_ms":282}
PostToolUseFailure: {..., "hook_event_name":"PostToolUseFailure", "tool_name":"Bash",
                     "tool_input":{...}, "error":"Exit code 3", "duration_ms":259}
```

Consequences for the audit trail, both load-bearing:

- **Hook both, or failures vanish.** `bash -c 'exit 3'` fires only
  `PostToolUseFailure`. An adapter hooking `PreToolUse` + `PostToolUse` records
  every successful call and silently drops every failed one — the exact
  asymmetry that makes an audit trail worse than none, because the gap is
  invisible. `ok` is `hook_event_name !== "PostToolUseFailure"`, which is
  parity with Pi's `tool_result` handler.
- **`PreToolUse` cannot produce an audit line.** It carries no `duration_ms`
  and no outcome. A line written from it would either invent both fields or
  duplicate the real one that arrives later. It is a gate, not a record.

### `--settings <file>` must not point at `$CLAUDE_CONFIG_DIR/settings.json`

If the file passed to `--settings` is the same path `--setting-sources user`
already loads, hooks register **twice** and one tool call appends two audit
lines. Verified by counting appended lines after a single `Bash` call.

The generated file is therefore named `claude-settings.json`. `--setting-sources
user` then finds no `settings.json` in the config directory, which is a
harmless no-op, and each hook registers once.
