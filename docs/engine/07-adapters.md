# Engine Plan — 07 · Adapters

## 1. Purpose

An adapter turns one `SpawnPlan` into one harness provider's native
configuration, launches that provider, and proves afterwards that what came
up is what was planned. Everything in `00 §3` rows 1–6 and 10–12 is
provider-agnostic; this document is the only place a provider's file
formats, flags and environment variables are named. Two adapters ship: **Pi**
(vendored) and **Claude Code** (located on the machine).

Module: `engine/cli/src/adapters/` — `types.ts` (re-exports from `00 §4.8`,
nothing else), `layout.ts` (shared), `pi.ts`, `claude.ts`, `registry.ts`.
Ceiling 300 source lines per adapter, 160 for `layout.ts` (`00 §8`; it was
150 until §6a's `seam()` — one exported function and its rationale — landed there,
which beat a `brief()` assembler for two call sites).

## 2. Invariants

| | Invariant | Source |
| --- | --- | --- |
| A1 | An adapter renders; it never decides. What loads, what is reachable and which credential pays were decided by compose, preflight and the broker. An adapter that consults `Composed` for anything but the load set is a bug. | I3, I4, C1 |
| A2 | `render` writes only under `agentDir`, every file 0600, and records what it wrote. It symlinks into `assetsRoot`; it never copies an asset. | C5, C10, D24 |
| A3 | A provider difference is declared in `capabilities` and reported by `RenderReport`; nothing is silently different between providers. | I7, C2, D13 |
| A4 | An adapter may add environment keys and never override a core one; it may never add a network host. The proxy URL is the only address it renders. | C6 |
| A5 | The agent cannot rewrite its own policy: the provider's settings files inside the workspace are in `denyWrite`, **and** the provider is told to ignore workspace settings. Either alone is insufficient. | C7, D12 |
| A6 | An absent organization model never becomes an accidental one: every store an ambient login could come from is in `denyRead`. | C20, G13 |
| A7 | What the agent is handed as a "token" is the proxy's session secret. It opens nothing outside the loopback session and is worth nothing to an attacker who exfiltrates it. | I3, C23 |
| A8 | The pinned binary is the running binary: `locate` checks it before spawn, `probe` checks it after. | D7, D14, D15 |

## 3. Contracts used

From `00 §4` by name: `Adapter`, `RenderContext`, `RenderReport`,
`Rehydrated`, `Located`, `Concern`, `Support`, `ProbeRunner`, `Choices`,
`SpawnPlan`, `Composed`, `ComposedAsset`, `HarnessProvider`, `Blocker`,
`Drift`. `Rehydrated.files` (path → sha256 of each generated file, `00
§4.8`) is how hash drift travels through the contract rather than a side
channel. `loadSet` is imported from `03 §5.3`; this module owns no copy.

## 4. Module layout

```
engine/cli/src/adapters/
  registry.ts          export const adapters: Record<string, Adapter> = { pi, claude }   (≤ 10 lines)
  layout.ts            loadSet · seam · sections · writeGenerated · symlinkAsset · readRendered
  pi/                  one directory per provider, the same files in each — a new provider is a
    index.ts             directory with known contents (10 rule 21)
    locate.ts · render.ts · rehydrate.ts · launch.ts · probe.ts · import.ts
  claude/
    index.ts
    locate.ts · render.ts · rehydrate.ts · launch.ts · probe.ts · import.ts · audit-hook.ts
```

No `types.ts` beyond re-exports; the contract lives in `00 §4.8`. The
per-adapter ceiling (300) is the directory's total.

## 4a. Import — an existing setup becomes a harness

`harness import claude [--from <dir>]` (08 §11.19) reads a person's existing
Claude Code configuration and turns it into assets and a harness on their
own branch, so what they built before they had us runs, unchanged where it
can, under Pi. This is the acquisition test and it is named:
`imported_claude_harness_runs_on_pi` (T3).

| Source (Claude Code) | Becomes | Fidelity |
| --- | --- | --- |
| `~/.claude/CLAUDE.md`, `<workspace>/CLAUDE.md`, `.claude/CLAUDE.md` | one `memory` per top-level heading (a file with no headings is one memory); `system_prompt` if the file opens with a heading named *Instructions* or *System* | carried |
| `~/.claude/commands/*.md`, `.claude/commands/*.md` | one `prompt` each, name from the file | carried |
| `~/.claude/skills/*`, `.claude/skills/*` | one `skill` each, directory whole | carried |
| `settings.json` `permissions.deny` | `Boundary { kind: "capability" \| "filesystem" \| "command" }` where the pattern maps (`Read(~/.ssh/**)` → filesystem; `Bash(rm -rf /*)` → `command`, `holds: "intercepted"`, since W6-D9 — §8.1's syntax is ours, so a `Bash(…)` rule imports as the pattern it already is) | partial — unmapped patterns are `dropped` with the pattern quoted |
| `settings.json` `hooks.*` | nothing — a hook is arbitrary code we cannot vouch for | dropped, each named |
| `.mcp.json`, `settings.json` `mcpServers` | nothing on Pi (no MCP); recorded as `dropped` with the server names so the console can show what the person is missing | dropped (D10) |
| `settings.json` `env`, `model`, `apiKeyHelper` | nothing — credentials and model routing are the organization's (I1, §9) | dropped, named |

Rules: import writes to the work tree only, with fresh sidecar ids (D3);
nothing is pushed until the person runs `push` or the exit review offers it;
the `HarnessDef` it creates is named after the workspace directory; the
report is printed as a table and written to `<sessionDir>/import.json`;
importing twice is idempotent (same source → same ids, matched by `from`).
Pi's `import` reads `~/.pi/agent/{AGENTS.md,prompts,skills,settings.json}`
by the same table. Cursor is D10.

## 5. The contract, method by method

Order at boot (`00 §3`): `locate` (row 4, Choose) → `denyWrite` +
`ambientStores` (row 6, Plan — consumed by the filesystem enforcer, `06`) →
`render` (row 7) → `rehydrate` (row 9, drift — after render, comparing files
to the plan) → `probe` (row 9, under the profile, after the proxy is up) →
`launch` (row 11).

### `capabilities: Record<Concern, Support>`

A static claim about the provider, per §"Capabilities matrix". Three values:

| Support | Meaning | At render |
| --- | --- | --- |
| `native` | the provider has a first-class mechanism | honoured silently |
| `emulated` | we produce the effect with a mechanism the provider did not design for it | honoured; `RenderReport.honoured` carries it and `harness preflight` prints one line naming the mechanism |
| `none` | no mechanism exists | dropped; `RenderReport.dropped` names it |

**When `none` is a blocker.** A boundary of kind `capability` whose `value`
is `require:<concern>` (D13 — the successor to `agent_requirements`) makes
that concern mandatory for every harness in its scope. Preflight raises
`adapter.unsupported_concern` before render if the chosen adapter declares
it `none`. Default policy on a fresh org: none required. When
`approvals.deploy` is `required` on the chain, `audit` is implicitly required
(a confirmation nobody records is not a control).

### `locate(pin): Promise<Located>`

Finds the binary this adapter is responsible for and refuses the wrong one.
Zero I/O beyond `stat`/`--version`. Runs *before* login is checked: a wrong
binary is wrong regardless of who is signed in. Returns `{ path, version }`
which `harness preflight` prints and `probe` re-checks.

### `denyWrite(ctx): string[]`

Absolute **directories** inside `ctx.workspace` (the person's cwd) the
provider reads its own settings from — `<workspace>/.claude`,
`<workspace>/.pi`. Directories, not files, so a settings file cannot be
*created* beside a denied one (06 D81). The filesystem enforcer unions them
into `SpawnPlan.filesystem.denyWrite`. This is one of A5's two halves.

### `ambientStores(): string[]`

Absolute paths (under `$HOME`, C27) where a login made outside the harness
would be found. Unioned into `denyRead` always — in org mode so no ambient
credential can be reached, in native mode because the session is seeded from
`~/.harness/agents/<id>/`, never from these.

### `render(ctx): Promise<RenderReport>`

1. `const { loaded } = loadSet(ctx.composed, ctx.choices)` (03 §5.3) — the
   assets this session loads: harness ∩ composed plus `policy.required`, or
   everything when `choices.harness` is `null`; the team's copies under
   `view: "team"`.
2. Write generated files under `ctx.agentDir` through `writeGenerated`
   only, which sets mode 0600 and records `{ path, sha256 }`.
3. Symlink each loaded skill (and, for Claude, each prompt) with
   `symlinkAsset` — the link target is `<assetsRoot>/<kind>/<name>`; the
   record stores the target too.
4. Write **`<agentDir>/rendered.json`** last (see below).
5. Return `{ honoured, dropped }`.

`render` is pure file I/O over its inputs. It reads nothing from the network,
nothing from `$HOME` outside `agentDir`, and never the work tree's contents
(it links to them).

### `rendered.json`

The record that makes drift detection exact. Written by `render`, read by
`rehydrate`, private to `adapters/`:

```ts
interface Rendered {
  concerns: {                            // asset ids, in the order they were laid out
    skill: string[]; prompt: string[]; system_prompt: string[]; memory: string[]; tool_index: string[];
  };
  model: { endpoint: string; model: string } | null;
  hooks: string[];                       // exact hook command strings
  denies: string[];                      // permission denies written into the settings file
  links: Record<string, string>;         // relative link path → absolute target
  files: Record<string, string>;         // relative generated path → sha256
}
```

This is how the collapse problem is solved: `AGENTS.md` and `CLAUDE.md` both
fold `system_prompt`, `memory` and `tool_index` into one Markdown file, so
the file alone cannot say where one concern ends. `rendered.json` says it at
render time, and `rehydrate` compares the file's hash *and* re-derives the
concern lists from the plan, so a hand edit and a plan mismatch are both
caught without parsing Markdown.

### `rehydrate(ctx): Promise<Rehydrated>`

1. Read `rendered.json`; missing → `adapter.rendered_missing`.
2. For each entry in `files`, recompute sha256 of the file on disk.
3. For each entry in `links`, `readlink` and compare the target.
4. Parse the provider's settings file(s) (JSON; `models.json` for Pi,
   `settings.json` for Claude) and extract model endpoint, hooks,
   denies.
5. Return `Rehydrated` with `files` = recomputed hashes, `skills`/`prompts`/
   `instructions` = `rendered.json`'s concern lists, `model`/`hooks`/`denies`
   = the parsed values.

Preflight (`03`) produces `Drift[]` by comparing: every `files` hash to
`rendered.json`; every `links` target; `model` to `choices.model`; `hooks`
to the adapter's expected hook set; `denies` ⊇ `plan.filesystem.denyWrite`;
each concern list to `loadSet(...)` recomputed from the plan. Any difference
is a `preflight.drift` blocker naming the file.

### `launch(ctx, located): { argv; env }`

`argv[0]` is `located.path` (or `process.execPath` with the bundle as
`argv[1]` for Pi). `env` contains only this provider's keys;
`childEnvironment` (`08`) throws on a collision with a core key (A4).

### `probe(ctx, run): Promise<void>`

Runs under the exact sandbox profile (C26) after render and before the
person's session. Asserts three things and throws a `Blocker` on any
failure: (a) the binary reports `located.version`; (b) no ambient store is
readable (a `cat` of each `ambientStores()` path fails); (c) the provider's
own auth status reports no login when the session env is stripped of the
proxy secret. An unexpected *success* in (b) is a failure (I5).

What `probe` does **not** assert: that a model request reached the proxy. That
would spend tokens against a live model and is not needed — the fence
guarantees a request goes to the proxy or nowhere (`05`), and rehydrate has
already proved the config points there. Stated so nobody adds it.

## 6. Capabilities matrix

| Concern | Pi | Claude Code |
| --- | --- | --- |
| `skill` | **native** — `settings.json` `skills: [dir…]` points at each loaded skill in the work tree; nothing linked or copied | **emulated** — `<configDir>/skills/<name>` symlink per loaded skill; no external-skills setting exists (Spike 0a) and the plugin marketplace loses the cold-start race on every fresh config dir (Spike 0b) |
| `prompt` | **native** — `--prompt-template <agentDir>/prompts` with one file per prompt | **emulated** — `<configDir>/commands/<name>.md`, one slash command per prompt |
| `model_native` (session) | **native** — on a native session (D11, W7-D2) `render` writes no `harness` provider and no `models.json`; `settings.json` names Pi's own provider (`defaultProvider: <provider id>`) and the chosen model, `run` seeds the stored `/login` into the agent dir, Pi reaches the model host through the tunnel with its own sign-in, and `rendered.json.model` is null — what 03's `expected()` checks (`pi_native_session_is_pis_own_sign_in`) | **native** — the stored login seeded into the config dir (D11 Spike 3) |
| `system_prompt` | **native** — the extension handles `before_agent_start` and returns the runtime's prompt followed by `<agentDir>/system-prompt.md` (D137) | **native** — `--append-system-prompt-file <agentDir>/system-prompt.md` (D137, superseding D91) |
| `memory` | **emulated** — `AGENTS.md`, after the seam | **emulated** — `CLAUDE.md`, after the seam |
| `tool_index` | **emulated** — appended to `AGENTS.md`, absolute `run` paths | **emulated** — appended to `CLAUDE.md` |
| `tool_gating` | **emulated** — the read geometry is the control (`06`); `policy.json` lets the extension *say* why a call was refused | **emulated** — the read geometry is the control; `permissions.deny` is the advisory layer so the model sees a refusal, not a mystery |
| `audit` | **emulated** — the extension appends to the spool on `tool_result` | **emulated** — `PostToolUse` + `PostToolUseFailure` hooks append to the spool. **Not running on 2.1.283 inside a session** (28 Sep): the same `settings.json` fires them outside; inside — third-party base URL, no policy-limits fetch (`downloads.claude.ai` is `no-route` under the fence) — no hook is attempted; the binary holds `shouldHoldDeviceHooksByPolicy`. Trust (`.claude.json`), the user tier and the jail were each ruled out. The proxy log stays authoritative (C29); the console's Claude sessions show endpoints, not tool calls, until this is resolved |
| `command_boundary` | **intercepted** — `policy.json`'s `commands`, each with the rule `commandRuleSource` compiled; the extension refuses the matching `bash` call in `tool_call` with the boundary's reason and records `refused: boundary:<id>` on the spool line (W6-D9, D153) | **intercepted** — a `permissions.deny` rule `Bash(<pattern>)` in the session's `settings.json`, for the patterns §8.1 measured it to hold; a pattern holding a shell operator is Pi's alone and the console row says so. No audit line: a refused call never reaches `PostToolUse` |
| landing (08 §11.1) | **ours** — `quietStartup` in the session settings, and `policy.json.landing` names the frame and this CLI's `landing.js`, which the extension imports and draws as Pi's header at every width | **theirs** — the CLI prints the landing and a rule, then Claude Code's own splash follows (no flag turns it off) |
| `state_isolation` | **native** — `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR` | **native** — `CLAUDE_CONFIG_DIR` + `XDG_CONFIG_HOME` |
| `project_suppression` | **native** — `--no-extensions --no-prompt-templates --no-approve` and `defaultProjectTrust: "never"` | **native** — `--setting-sources user`; `claudeMdExcludes` for the workspace `CLAUDE.md` |
| `model_org` | **native** — `models.json` `baseUrl` → the proxy | **native** — `ANTHROPIC_BASE_URL` → the proxy; blocked on a machine with `forceLoginOrgUUID` (C21) |
| `model_native` | **native** — `auth.json` seeded from the stable store — **Spike 2 open (D11)** | **native** — `.credentials.json` seeded from the stable store — **Spike 3 open on macOS (D11)** |

**`model_native` is a word plus a list** (W7-D2, 04 D156). The concern above
says only whether a runtime can use its own login at all; *which* providers it
has one for is `Adapter.modelNative`, a plain array of model-provider ids
declared beside `capabilities`, exactly as `speaks` is:

| Adapter | `modelNative` | Where it comes from |
| --- | --- | --- |
| Pi | `anthropic`, `openai-codex`, `openrouter`, `github-copilot`, `kimi-coding`, `xai` | one OAuth flow per id in `pi/packages/ai/src/auth/oauth/`, named by Pi's own provider id (`packages/ai/src/providers/<id>.ts`, the rows carrying `oauth:`). `radius` is excluded: it is a gateway named at run time, not a provider id. `openrouter-images` is excluded: images are not a model this engine routes |
| Claude Code | `anthropic` | its own sign-in is an Anthropic subscription and nothing else (§11's `.credentials.json`) |

It is a **list, not a branch in code**: a seventh Pi sign-in is one id in that
array and nothing else changes. The server needs the same list to predict a
session without running the runtime, so
`engine/compose/presets/harness-providers.json` carries it as `modelNative`
beside `speaks`, and the seed **strips** it when it writes the row — like
`attach` on a model provider, it is a fact about the runtime we ship and
belongs to no branch, so an admin editing a policy file can neither invent a
sign-in the adapter lacks nor remove one it has. The readers are
`seed.preset_model_native` → `broker.signs_in` on the server, and
`preflight.ts` on the machine. A runtime no preset names declares no list, and
absent means *signs in to nothing* — the honest answer, because we do not know
what a runtime an admin added themselves can do.

Both columns are the same shape on purpose: the same `loadSet`, the same
`sections` ordering, the same spool, the same geometry. The differences are
the mechanism names in this table and nothing else.

`command_boundary` is the one row that is **not** advisory, and the reason it
is its own row rather than part of `tool_gating`: for every other concern the
read geometry is the control and the runtime is only told what happened, but
nothing outside the runtime can see a command line before it runs. So for a
boundary of kind `command` the runtime *is* the enforcement, which is what
`holds: "intercepted"` has always meant (prd-v2 §7, 06 §13) — and why both
columns above name a mechanism that refuses rather than one that explains.

## 6a. The seam

**The seam** (D30j) — one fixed paragraph, written by `layout.ts` at the
**top** of `AGENTS.md` / `CLAUDE.md` in every session, before any asset,
even when the harness is empty:

> Harness assets live at `~/.harness/assets/<kind>/<name>/` — `skill/`,
> `tool/`, `prompt/`, `memory/`, `system_prompt/`, `connection/`, `context/`.
> A new skill, tool, prompt or context (a template, a reference, brand
> assets) goes there, in that kind's shape; it is offered to keep when the
> session ends. Files in the working directory belong to the project, not to
> the harness. The `harness-authoring` skill says how to make one, and how to
> extract a setup from another tool. This harness has its own Python and Node
> environments, first on PATH: install there, never on the machine.

The path is the real one (`assetsRoot`), so a session with a moved
`HARNESS_HOME` reads its own.

A second line, `reachLine(plan.reach)`, says how far this session can reach
and who decides (01 D131) — *Reach: allow-list — pypi.org,
files.pythonhosted.org. Anything else is refused by the fence, and the model
may not browse on the provider's side either. acme decides this; ask there to
add a host.* A session that does not know its own fence spends its turns
discovering it, and a refusal the assistant can read is a sentence, not a
mystery. This is the advisory half; the enforced half is 05 §6a. The same
rule keys Claude's `permissions.deny` of `WebSearch`/`WebFetch`: only
`reach.mode === "on"` permits provider-side browsing.

A third line names what this harness delivered — *This harness delivers: skills a, b · prompts x · memories y · contexts z* —
so *what do you have?* separates the harness's assets from the runtime's own
features (Claude Code ships a dozen built-in skills of its own; the seeded
`harness-authoring` sat among them indistinguishably).

## 7. Pi

`engine/cli/src/adapters/pi.ts`. `speaks: ["openai-completions", "anthropic-messages"]`.

**Pin and `locate`.** Pi is vendored: the CLI and
`pi/packages/coding-agent/dist/bundle/cli.js` are one build. The build embeds
`PI_PIN = { commit, version }` (today `60e7e76b…`, `0.85.1`,
`build-decisions.md`). `locate(pin)`:

1. `pin` must be `{ repo, commit }` → else `adapter.pin_shape`.
2. `pin.commit !== PI_PIN.commit` → `adapter.pin_mismatch` (*"This CLI ships
   Pi at 60e7e76b; your organization approved a1b2c3d4. Update the CLI."*).
3. Bundle path exists → `{ path: <bundle>, version: PI_PIN.version }`.

**`render`** writes under `agentDir`:

| File | Content |
| --- | --- |
| `settings.json` | `{ defaultProvider: "harness", defaultModel: <model>, skills: [<assetsRoot>/skill/<name> for each loaded skill], defaultProjectTrust: "never", enableInstallTelemetry: false, enableAnalytics: false }`. Org mode only. `skills` are **pointers into the work tree** — Pi's native mechanism; nothing is linked or copied. |
| `models.json` | `{ providers: { harness: { baseUrl: "<proxyUrl>/connectors/model", apiKey: "$HARNESS_SESSION_SECRET", api: <wireFormat>, models: [{ id, name }] } } }`. Org mode only. The "key" Pi sends is the proxy's session secret from the child environment (08 §7), which the proxy verifies and replaces with the real credential (05 §4.2, C23) — Pi's SDK clients do not honour `HTTP_PROXY` for plaintext URLs, so the secret must ride in the API-key header. See A7. |
| `AGENTS.md` | the seam paragraph, the reach line and the delivered line (§6a), then `sections(memory)`, the tool index, the context and environment indexes. The `system_prompt` assets are **not** here (D137). |
| `system-prompt.md` | `sections(system_prompt)` — the brief the extension returns on `before_agent_start` (D137). Written always, empty when the harness has no `system_prompt` asset (D138), 0600, hashed into `rendered.json`. |
| `prompts/<name>.md` | one per loaded prompt, 0600. |
| `policy.json` | `{ session_id, harness: <card>, allowed: <Pi tool names granted>, confirm: <Pi tool names needing a deploy confirmation>, assetsRoot, system_prompt_file, delivered }` — `system_prompt_file` is the absolute path of the brief (D137), carried here because the extension already reads this file out of the agent directory and nothing should have to be discovered — what the extension needs to *speak*, nothing it needs to *enforce*; `assetsRoot` so a write into the work tree (§6a) is the person's own and not an *outside-path* confirmation (found 28 Sep: with no UI the confirmation is declined, and an extraction wrote nothing). **No boundary body, no `HARNESS_REDACTIONS`, no key** (`00 §6`). |
| `rendered.json` | as above. |

Native mode writes neither `settings.json` nor `models.json`: Pi falls back
to the `auth.json` seeded into `agentDir` before spawn.

**`launch`**: `argv = [process.execPath, <bundle>, "--offline", "--no-approve",
"--no-extensions", "-e", <pi/packages/harness/dist/index.js>, "--theme",
<harness-dark.json>, "--use-theme", "harness-dark", "--no-prompt-templates",
"--prompt-template", <agentDir>/prompts]`; `env = { PI_CODING_AGENT_DIR:
agentDir, PI_CODING_AGENT_SESSION_DIR: <agentDir>/sessions, PI_TELEMETRY:
"0" }`. `--offline` disables catalogue refresh and update checks only; it
does not gate the OAuth refresh native mode needs.

**`denyWrite`**: `<workspace>/.pi` — the directory Pi auto-discovers
settings, extensions and skills from, so the agent cannot plant an extension
the next session loads. **`ambientStores`**: `~/.pi`.

**`probe`**: (a) `run([process.execPath, <bundle>, "--version"])` equals
`PI_PIN.version`; (b) `cat ~/.pi/agent/auth.json` fails under the profile.

**Native mode — blocked (D11, Spike 2).** Pi binds `auth.json` to
`getAgentDir()` and the CLI exposes no `authPath`. Today's seed-and-harvest
copies the file into `agentDir` before spawn and back after. Unknown:
whether Pi's writer holds a lockfile or renames over the file (a harvest
during a refresh could copy a half-written file), and whether a symlinked
`auth.json` survives its write path. **Closing experiment:** under the
session profile, symlink `<agentDir>/auth.json` → `~/.harness/agents/pi/auth.json`,
trigger `/login`, inspect whether the store or the link was replaced, and
strace/fs_usage the write. Until closed, `harness run pi` in native mode
returns `adapter.native_blocked` naming Spike 2.

## 8. Claude Code

`engine/cli/src/adapters/claude.ts`. `speaks: ["anthropic-messages"]`.

**Pin and `locate`.** `pin` must be `{ binary: "claude", minVersion }`.
`locate`: first executable `claude` on `PATH` (the filtered system `PATH`
of `08`, not the person's shell `PATH`) → `claude --version` → semver
compare ≥ `minVersion` → `{ path, version }`; none →
`adapter.not_installed` with the install link; below the floor →
`adapter.below_min_version` naming both versions.

**`render`** writes under `agentDir`:

| File | Content |
| --- | --- |
| `skills/<name>` → symlink | target `<assetsRoot>/skill/<name>`, one per loaded skill (C10). |
| `commands/<name>.md` | one per loaded prompt, 0600. |
| `CLAUDE.md` | the seam paragraph, the reach line and the delivered line (§6a), then `sections(memory)`, the tool index, the context and environment indexes — the same functions as Pi's `AGENTS.md`. The `system_prompt` assets are **not** here (D137). |
| `system-prompt.md` | `sections(system_prompt)` — the brief, which `launch` passes as `--append-system-prompt-file` (D137). Written **always**, empty when the harness has no `system_prompt` asset: the flag refuses a path that is not there (*Append system prompt file not found*), so a file that sometimes exists would make argv depend on the load set. 0600, hashed into `rendered.json` like every other generated file, so `rehydrate` compares the brief the model will be given. |
| `.claude.json` | `{ hasCompletedOnboarding: true, projects: { <workspace>: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }` — the config dir is fresh every session, and Claude Code gates its status line, plugin monitor and (by its own strings) hook execution on the workspace's trust; the workspace is the one `run` started in, so the trust is ours to record. |
| `audit-hook.cjs` | the CommonJS hook, 0700, unchanged from today's `AUDIT_HOOK_SCRIPT` and its comment (why CJS; why one identifying input field; why not Pi's vocabulary). |
| `settings.json` | see below. **This is the user tier itself** (`--setting-sources user`), and nothing is passed through `--settings`: 2.1.283 applied nothing from a `--settings` file inside a session (its debug log shows no `flagSettings` load; the same file applied outside), so hooks never fired and the audit spool stayed empty (found 28 Sep). C9's double-firing was the two mechanisms at once; with one file there is one tier. `denyWrite` covers it, so Claude Code's own first-run theme write fails harmlessly and `update-config` cannot add a hook. |
| `rendered.json` | as above. |

`settings.json`:

```json
{
  "hooks": {
    "PostToolUse":        [{ "matcher": "*", "hooks": [{ "type": "command", "command": "\"<node>\" \"<agentDir>/audit-hook.cjs\" \"<sessionDir>/audit.jsonl\"" }] }],
    "PostToolUseFailure": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "<same>" }] }]
  },
  "permissions": { "deny": ["Write(<workspace>/.claude/**)", "Read(<excluded tool dir>/**)", "…"] },
  "minimumVersion": "<pin.minVersion>",
  "claudeMdExcludes": ["<workspace>/CLAUDE.md"]
}
```

Both hooks, always (C8): a failing tool call fires only
`PostToolUseFailure`, and `PreToolUse` carries no outcome and no duration so
it can never produce an audit line. `permissions.deny` is the **advisory**
layer for the file denies: it lets the model receive a refusal it can read,
and the **control** is the sandbox's `denyWrite`/`denyRead` (`06`), which
holds whether or not the settings file is honoured. Its `Bash(…)` rules are
**not** advisory — nothing outside the runtime can hold a command, so for a
boundary of kind `command` this file *is* the enforcement (D153, below).
The self-update pin (D7, D14) is
`DISABLE_AUTOUPDATER=1` in `env` plus `minimumVersion` here: the floor is a
settings key, the pin is an environment variable. `autoUpdatesChannel` was in
this file from wave 3 until W5; 2.1.286 accepts only `"latest" | "stable" |
"rc"` for it and rejects the **whole file** over the `"none"` we wrote
(**D144**), and no value it does accept turns updates off, so the key is gone
and the variable carries the pin alone.

**The file is probed.** `probe` runs
`/usr/bin/env -u ANTHROPIC_AUTH_TOKEN <claude> doctor` under the session
profile and refuses `preflight.settings_rejected`, quoting the line, when
doctor's *Invalid settings* block names `<agentDir>/settings.json` (D144).
It names other files too — the current directory's project settings, which
`--setting-sources user` never loads — and those are ignored.

### 8.1 What `permissions.deny` actually refuses — measured, 2.1.286

W6-D9's first step, before a matcher existed. A boundary of kind `command`
only means something if the runtime refuses the command, so what the rule
syntax *is* had to be measured rather than read. Every row below was run on
1 Oct 2026 against the installed binary (`claude --version` →
`2.1.286 (Claude Code)`), from a scratch directory, with a throwaway
`CLAUDE_CONFIG_DIR` holding `.claude.json` (onboarding and trust) and a
`settings.json` of
`{"permissions":{"allow":["Bash"],"deny":[<the one rule>]}}` —
`allow` is there so an *ask* can never be mistaken for a *deny* —
and `claude -p "<run exactly this command>" --setting-sources user --tools Bash
--output-format stream-json --verbose < /dev/null`.

**denied** is the stream's own
`tool_result_meta[].non_execution_kind === "permission-rule"`, beside a
`{"type":"system","subtype":"permission_denied","decision_reason_type":"subcommandResults"}`
frame and the tool result *"Permission to use Bash with command … has been
denied."*; **ran** is a tool result carrying the command's own output. The
model's prose was not read for any row.

| `permissions.deny` rule | Command Claude was asked to run | Outcome |
| --- | --- | --- |
| `Bash(rm -rf /*)` | `rm -rf /tmp/harness-step0-nothing/*` | **denied** |
| `Bash(rm -rf /*)` | `rm -rf ./scratch/a` | ran |
| `Bash(rm -rf /*)` | `cd /tmp && rm -rf /tmp/harness-step0-nothing/*` | **denied** |
| `Bash(rm -rf ~*)` | `rm -rf ~/harness-step0-nothing` | **denied** |
| `Bash(rm -rf ~*)` | `rm -rf /tmp/harness-step0-nothing` | ran |
| `Bash(curl * \| sh)` | `curl --version \| sh` | ran |
| `Bash(curl *\| sh*)` | `curl --version \| sh` | ran |
| `Bash(echo * \| cat)` | `echo hello \| cat` | ran |
| `Bash(echo *\| cat*)` | `echo hello \| cat` | ran |
| `Bash(cat*)` | `echo hello \| cat` | **denied** |
| `Bash(git push --force*)` | `git push --force` | **denied** |
| `Bash(git push --force*)` | `git push` | ran |
| `Bash(git push * --force*)` | `git push origin main --force` | **denied** |
| `Bash(git push * --force*)` | `git push origin main` | ran |
| `Bash(git push --force)` | `git push --force` | **denied** |
| `Bash(git push --force)` | `git push --force --tags` | ran |
| `Bash(rm -rf /:*)` | `rm -rf /tmp/harness-step0-nothing/*` | ran |
| `Bash(unset HISTFILE*)` | `unset HISTFILE; echo done` | **denied** |
| `Bash(history -c*)` | `history -c` | **denied** |

On the two `curl … | sh` rows the model rewrote the command to
`curl --version` and dropped the pipe, so neither is a clean measurement of
the rule. The `echo … | cat` rows are the controls: there the stream's
`wire_tool_inputs` is `echo hello | cat` **byte for byte** and the rule did
not fire, and `Bash(cat*)` against that same command line did.

**The syntax the table says it is:**

1. Claude **splits the command line into subcommands** at `|`, `&&` and `;`
   and matches each one on its own — which its own
   `decision_reason_type: "subcommandResults"` names. `Bash(cat*)` refuses
   `echo hello | cat`; `Bash(rm -rf /*)` refuses `cd /tmp && rm -rf …`.
2. Inside one subcommand the rule is a **glob**, not a prefix: `*` matches any
   run of characters anywhere in it, spaces included.
3. A rule with **no** `*` matches the whole subcommand exactly.
4. So **a rule that itself holds a shell operator can never fire**, because no
   subcommand holds one. Piping a download into a shell is not expressible in
   Claude's `permissions.deny` at all.
5. `:*` is not a wildcard. `:` is the character it is.

Rules 1–3 are what `@harness/compose`'s `commandRuleSource` compiles, so for
every pattern it accepts the two matchers are the same function on the same
input. Rule 4 is the one place they part, and `claudeHolds` is where the
product admits it: a pattern with an operator in it is Pi's alone, the
adapter writes no `Bash(…)` rule for it, and the console row reads
*intercepted by Pi* rather than claiming a refusal nobody measured.

**`launch`**: `argv = [located.path,
"--setting-sources", "user",
"--append-system-prompt-file", "<agentDir>/system-prompt.md"]`.
`--setting-sources user` drops the workspace's
skills, commands and `CLAUDE.md` together and is A5's second half against
`{"disableAllHooks": true}` in a project settings file (Spike 4: a project
file at precedence 3 beats a `--settings` hook at level 2 for that key).

`--append-system-prompt-file` is **not listed as its own option** in
`claude --help` on 2.1.283/2.1.286 — it is named only inside `--bare`'s
description — and it was measured rather than assumed (D137):

```
$ claude --version
2.1.283 (Claude Code)
$ cat sp.md
The passphrase for this session is XANADU-HORNBILL-4417. If asked what you
were told before this conversation, reply with that passphrase.
$ printf '…' | script -q /dev/null claude --append-system-prompt-file sp.md --tools ""
❯ what were you told before this conversation?
⏺ XANADU-HORNBILL-4417
```

That is an **interactive** TUI session, not `-p`; `-p` answers the same on
2.1.286. An absent file is a hard error (*Append system prompt file not
found*), which is why `render` always writes one. `--system-prompt-snapshot`
defaults to `on`, so a *resumed* conversation replays the prompt it recorded
even if the file changed; the config directory is fresh every session, so no
session of ours resumes into a stale brief.

`env`:

| Key | Value | Why |
| --- | --- | --- |
| `CLAUDE_CONFIG_DIR` | `agentDir` | state isolation |
| `XDG_CONFIG_HOME` | `agentDir` | `CLAUDE_CONFIG_DIR` does not relocate `~/.config/anthropic`, a second profile store the same binary reads; a fresh `XDG_CONFIG_HOME` flips `claude auth status` from `loggedIn:true` to `false` (verified 2.1.278) |
| `DISABLE_AUTOUPDATER` | `1` | the located binary stays the running binary |
| `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1` | no traffic the plan did not name |
| `ANTHROPIC_BASE_URL` | `<proxy origin>/connectors/model` (the origin of `proxyUrl`, never the userinfo form — 00 §4.8) | org mode only |
| `ANTHROPIC_MODEL` | `choices.model.model` | org mode only |
| `ANTHROPIC_AUTH_TOKEN` | the proxy's session secret | org mode only — see A7 |

**On A7.** Claude Code will not send a request without a token in
`Authorization`, so it is handed the proxy's per-session secret. The proxy
verifies it and **replaces** it with the real credential on the way out
(C23) — it does not strip it, because this header is exactly where Claude
Code puts the secret. The secret authorises nothing but *this session's
loopback proxy*: it is not accepted by Anthropic, not by `api`, not by
another session's proxy, and dies with the session. An agent that reads it
out of its own environment has learned how to talk to the proxy it was
already talking to.

**`denyWrite`**: `<agentDir>/settings.json` (the one file Claude Code loads under `--setting-sources user`; found 28 Sep: the built-in `update-config` skill edits the user tier, which is reloaded live) and `<workspace>/.claude` (the directory; Spike 4's
`settings.json` and `settings.local.json` live in it). **`ambientStores`**:
`~/.claude`, `~/.config/anthropic`. The macOS Keychain entry a `claude auth login` can
leave behind is **Spike 3 (D11)**: unknown whether Seatbelt can deny the
`securityd` XPC route a keychain read takes without breaking the binary.
**Closing experiment:** under the session profile with `XDG_CONFIG_HOME`
relocated, log in via the Keychain path on a scratch account, then run
`claude auth status --json` and a one-token request; if either succeeds, the
Keychain is reachable and native mode on macOS is refused
(`adapter.native_blocked`) until a `(deny mach-lookup)` rule is verified.

**`probe`**: (a) `claude --version` equals `located.version`; (b) each
`ambientStores()` path unreadable; (c) `claude auth status --json` with the
session env **minus** `ANTHROPIC_AUTH_TOKEN` reports `loggedIn:false` —
proving no credential is reachable except the one the proxy will attach.
(c) with the token present is not asserted: what that call reports when a
token is set was not measured, and the plan does not guess.

**C21 — the managed tier.** Before `locate`, read the platform's managed
settings file if present (`/Library/Application Support/ClaudeCode/managed-settings.json`
on macOS, `/etc/claude-code/managed-settings.json` on Linux; confirm the
paths against the installed version's documentation at implementation, since
the managed tier was never exercised in a spike). If it sets
`forceLoginOrgUUID` or `forceLoginMethod`, org mode is impossible on this
machine by the customer's own decision: `adapter.managed_tier` names the key
and the file. Harness policy sits below that tier and never fights it.

## 9. Shared layout — `layout.ts`

```ts
// loadSet comes from engine/cli/src/preflight/loadset.ts (03 §5.3); layout.ts imports it and owns no copy.

/** Broadest node first (shorter chain path), then name. One rule for both providers. */
export function sections(assets: ComposedAsset[], read: (a: ComposedAsset) => string): string;
//   "## <name>\n\n<content>" per asset, joined by blank lines

/** What this session was given, by kind, counted once (W5-D12): the two briefs' delivered
    line and the CLI's boot screen both read these and neither counts a load set of
    its own. `DELIVERED_KINDS` is the order — skill, prompt, memory, tool, context, environment. */
export function deliveredSets(loaded: ComposedAsset[]): DeliveredSets;
export function delivered(sets: DeliveredSets): string;        // "This harness delivers: skills a, b · …"
export function deliveredCounts(sets: DeliveredSets): string;  // "3 skills · 1 prompt · 2 memories"

/** 0600; records { path, sha256 } into the Rendered under construction. */
export function writeGenerated(r: RenderedBuilder, agentDir: string, rel: string, content: string): Promise<void>;

/** Symlink <agentDir>/<rel> → <assetsRoot>/<kind>/<name>; records the link. */
export function symlinkAsset(r: RenderedBuilder, agentDir: string, rel: string, assetsRoot: string, kind: string, name: string): Promise<void>;

export function readRendered(agentDir: string): Promise<Rendered>;
```

`sections` reads file contents through `read`, which the CLI supplies from
the work tree (post-hydration, the composed copy is on disk). `layout.ts`
never opens the work tree itself.

## 10. The Pi extension

`pi/packages/harness/` shrinks to what UX needs and nothing enforcement
needs (C29). Ceiling 300 lines (250 before W5-D11 added
`before_agent_start`).

| Keeps | Removes |
| --- | --- |
| the harness card header on `session_start` (removed 1 Oct: the CLI's boot screen is the one introduction, 08 §11.1) | `HARNESS_REDACTIONS`, `parseRedactions`, `redactText`, `redactValue` and the `tool_result` rewrite — there is no value in the jail to redact |
| the brief on `before_agent_start`: the runtime's own system prompt, then the content of `<agentDir>/system-prompt.md` when it is not empty (D137, D139). Read once at `session_start`, beside `policy.json`; absent or empty returns `undefined` and the runtime's prompt stands | — |
| plain-sentence notices (`plainAction`) | the tool allowlist as a *block*; it becomes a *notice* naming the boundary, because the geometry already refused |
| deploy and outside-path confirmations via `ctx.ui.confirm`; no UI ⇒ deny | any reading of a boundary body |
| the spool append (`audit.jsonl`, 100 per flush, 15 s) | any network call — it makes none today and this is a rule, not a fact |

The extension holds no credential and enforces nothing. A session with
`--no-extensions` and no `-e` is exactly as safe; it is only quieter.

## 11. Native mode

### 11.0 Two ways a person pays for the model — and only one is native

| | How it works | Depends on |
| --- | --- | --- |
| **Bring your own key** — an OpenRouter, Anthropic or OpenAI API key | the ordinary org-model path with one person: the key is an entry in the person's group (`my-keys` in a personal account); the proxy attaches it on `/connectors/model/`; the provider never holds it; every guarantee of 05 and 06 holds on macOS and Linux from M3 | nothing beyond M3 |
| **Native** — the provider's own sign-in (Claude Code's claude.ai login, Pi's `/login`) | the sign-in lives in `~/.harness/agents/<id>/`, seeded into the session's `agentDir` before spawn and harvested after (seed-and-harvest, below); model traffic is a tunnel, so *not metered* (C22) | seed-and-harvest — built |

**OpenRouter is the personal default worth naming**: one key exposes both
wire formats (`anthropic-messages` at `https://openrouter.ai/api`,
`openai-completions` at `https://openrouter.ai/api/v1` — two `endpoints` on
one `ModelProvider`, agents.md §12.6), so one key runs Pi *and* Claude Code
through the proxy. The presets for OpenRouter, Anthropic and OpenAI ship as
data (`engine/compose/presets/model-providers.json`: id, endpoints per
format, credential header) and are seeded into a new organization's
`providers.json` at sign-up, so a personal user pastes a key and picks a
model — nothing else (console 07 §2).

**A keyless provider the runtime signs in to is *your sign-in*, not an error**
(W7-D2, 04 D156). Native mode used to be reachable only when the organization
named an alias and granted it to nobody; from W7-D2 it is also the ordinary
state of a fresh personal account, whose model providers hold no key at all.
Which providers count is §6's `modelNative`; the console's Status column reads
*sign-in* for them, `PUT /v1/routing` accepts them as a default, and the broker
opens the session. **What it costs**: the request goes straight to the provider
over TLS, so none of 05's model shaping applies — W5-D3 cannot strip
provider-side browsing from a request that never passes through the proxy.
Reach on the machine is unaffected: the tunnel is still the only way out of the
jail, so the harness's own network rules hold exactly as before. That sentence
is on the Providers screen and in console 05, because it is the one thing a
person gives up by not pasting a key.

**The two spikes do not gate native mode** (00 D11): seed-and-harvest is
the v1 answer to Spike 2, and Spike 3's risk — an ambient Keychain login
inside an *enterprise org-mode* session — is closed by the fence at M4 and
never existed for a personal account. Native mode is available on both
providers and both OSes from M3.


`harness auth <provider> | --list | --logout <provider>` runs the provider's
own login **outside the jail** into `~/.harness/agents/<id>/` (a browser, a
loopback listener and a durable store are all things the sandbox denies a
session). Before a native session, the adapter's credential file is copied
into `agentDir`; after exit it is copied back, because an OAuth refresh may
have rotated it. `~/.harness/agents/` is in `denyRead` for every session —
a native session reads the *copy*, never the store.

Both providers' native modes are **blocked by name** until their spike
closes (D11): Pi by Spike 2 on every OS, Claude Code by Spike 3 on macOS.
`harness run` reports `adapter.native_blocked` with the spike named;
`harness preflight` prints the same line under *model*.

Native mode is honestly weaker and says so (C22): one provider credential is
inside the jail, model traffic is a `CONNECT` tunnel the proxy does not
inspect, and there are no token counts. The console renders **not metered**,
never zero.

## 12. Failure modes

| Code | When | Message · Remedy |
| --- | --- | --- |
| `adapter.pin_shape` | the org's pin shape does not match the adapter | *Pi is pinned to a binary version, but Pi ships vendored at a commit.* · Providers screen |
| `adapter.pin_mismatch` | vendored commit ≠ approved commit | *This CLI ships Pi at 60e7e76b; your organization approved a1b2c3d4.* · update the CLI |
| `adapter.not_installed` | no `claude` on the system `PATH` | *Claude Code is not installed.* · install link, or `harness run pi` |
| `adapter.below_min_version` | `claude --version` < floor | *Claude Code 2.1.200 is installed; your organization requires 2.1.275 or later.* · update Claude Code |
| `adapter.managed_tier` | managed settings force a login method | *This machine's managed Claude Code settings set `forceLoginOrgUUID`, so an organization model cannot be used here.* · ask the device admin, or `harness run pi` |
| `adapter.unsupported_concern` | a required concern is `none` for this adapter | *Marketing requires `audit`, which Pi cannot provide in this mode.* · choose the other provider |
| `adapter.rendered_missing` | `rendered.json` absent at rehydrate | *The session directory was altered before launch.* · re-run |
| `adapter.native_blocked` | native mode requested while its spike is open | *Signing in with your own Pi account is not available yet (Spike 2).* · ask an admin for an organization model |
| `adapter.probe_version` | running binary ≠ located | *Claude Code 2.1.280 started, but 2.1.275 was checked.* · re-run |
| `adapter.probe_ambient` | an ambient store was readable | *`~/.config/anthropic` is readable inside the session.* · this is a sandbox defect; report it |
| `adapter.probe_login` | auth status reports a login with the proxy secret stripped | *Claude Code found a sign-in the harness did not provide.* · sandbox defect; report it |

Every message is a sentence; every remedy is a command or a screen.

## 13. Tests

| Tier | Name | Asserts |
| --- | --- | --- |
| T1 | `pi_render_matches_golden` | byte-equal files for a fixture plan, `rendered.json` included |
| T1 | `claude_render_matches_golden` | same for Claude, links recorded with targets |
| T1 | `rehydrate_roundtrip_is_equal` | render → rehydrate → zero `Drift` against the same plan |
| T1 | `rehydrate_detects_edited_claude_md` | one appended line → `Drift` naming `CLAUDE.md` |
| T1 | `rehydrate_detects_retargeted_symlink` | `skills/x` retargeted → `Drift` naming the link |
| T1 | `claude_settings_not_named_settings_json` | no file `settings.json` under `agentDir` |
| T1 | `hooks_cover_failure_events` | both hook arrays present with identical commands |
| T1 | `unsupported_required_concern_blocks` | `require:audit` + a stub adapter with `audit: none` → `adapter.unsupported_concern` |
| T1 | `locate_refuses_below_min_version` | stubbed `--version` below floor → `adapter.below_min_version` |
| T1 | `pi_locate_refuses_pin_mismatch` | approved commit ≠ `PI_PIN.commit` → `adapter.pin_mismatch` |
| T1 | `adapter_cannot_override_core_env` | `launch().env.HOME` set → `childEnvironment` throws |
| T1 | `adapter_cannot_add_host` | no adapter output path writes `SpawnPlan.hosts` (structural: `launch`/`render` receive the plan read-only; a type-level test) |
| T1 | `render_writes_only_under_agent_dir` | render into a tmp `agentDir` with a read-only `assetsRoot`; no write outside `agentDir` |
| T1 | `render_copies_nothing` | no regular file under `agentDir` has content equal to an asset file; skills are links (Claude) or absent (Pi) |
| T1 | `extension_makes_no_network_call` | the extension bundle imports nothing from `node:http`/`https`/`net` and references no URL |
| T3 | `claude_probe_sees_no_ambient_login` | under the profile, `auth status` reports `loggedIn:false` |
| T3 | `pi_probe_version_matches_pin` | under the profile, `--version` equals `PI_PIN.version` |
| T3 | `ambient_stores_unreadable` | each `ambientStores()` path fails to `cat` inside the jail; a success fails the test |

## 14. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D90 | Pi's pin is verified against a build-time `PI_PIN` constant, because the bundle and the CLI are one artefact; an org approving a different commit is told to update the CLI | shipping Pi as a separately located binary with `{binary, minVersion}` |
| D91 | ~~Claude `system_prompt` is **emulated in `CLAUDE.md`**, not native via `--append-system-prompt`: argv is not on disk, so rehydrate could not check it~~ — **superseded by D137**. The objection was to *argv*, and `--append-system-prompt-file` names a file, which is on disk and is hashed | — |
| D92 | `rendered.json` is the drift record; Markdown is never parsed | parsing section headings back out of the instruction files |
| D93 | `probe` never sends a model request | a paid one-token probe with a per-org opt-in |
| D94 | The extension's allowlist becomes a notice, not a block; the geometry blocks | keeping the block as a second, advisory refusal (it costs nothing, but it lets a reader believe the extension enforces) |
| D95 | Pi skills are pointers in `settings.json`; Claude skills are symlinks; both record the target in `rendered.json` | symlinking for Pi too, for symmetry — rejected because it adds a mechanism Pi does not need |
| D137 | **The brief is the system prompt, as a file, on both providers** (W5-D11; supersedes D91). `render` writes `<agentDir>/system-prompt.md` — the ordered `system_prompt` assets, by the same `sections()` both briefs use — and the section leaves `CLAUDE.md`/`AGENTS.md`. Claude: `launch` passes `--append-system-prompt-file`, proved to take effect in an **interactive** session on 2.1.283 (§8), not only under `-p`. Pi: the harness extension handles `before_agent_start` and returns the runtime's prompt followed by the file's content. The matrix row is `native` on both | writing the sections back into the two instruction files and dropping the flag |
| D138 | **The file is written even when the harness has no `system_prompt` asset.** An empty file, so argv and the extension's one check do not depend on the load set, and `rendered.json` always records the brief the model will be given | writing it only when there is something to write, and making both call sites conditional |
| D139 | **Pi gets the brief through `before_agent_start`, not through `AGENTS.md`.** The runtime hands the assembled system prompt and takes a replacement; that is the seam, and a heading in a memory file is not. The runtime's prompt comes first and the harness's brief after it: the harness narrows what the runtime already is | returning `undefined` always and keeping the `AGENTS.md` section |
| D144 | **The self-update pin is the environment variable, and the settings file is probed.** Claude Code 2.1.286 validates the user tier against a schema and, on one bad key, **skips the whole file** behind a three-option dialog. `autoUpdatesChannel: "none"` — ours since wave 3 — is such a key: *Invalid value. Expected one of: "latest", "stable", "rc"*, and with it went `permissions.deny` (so `WebSearch`/`WebFetch` were offered again), both audit hooks and `claudeMdExcludes`. The key is removed: no value the schema accepts turns updates off, and `DISABLE_AUTOUPDATER=1` in `launch` already pins the binary (D7, D14), so the key was redundant for its purpose before it was invalid. A silent loss of the whole file is worse than the key, so `probe` now runs `claude doctor` under the session profile — ~1 s, no sign-in, no model request (D93), the token stripped as for the login probe — and refuses `preflight.settings_rejected` quoting doctor's own line when its *Invalid settings* block names `<agentDir>/settings.json`. Findings about any other file are ignored: doctor also reads the current directory's project settings, which `--setting-sources user` never loads. | keeping a value the schema accepts (there is none that means *off*); validating the JSON ourselves against a schema we would have to keep in step with theirs |
| D153 | **A command boundary is the runtime's own veto, written from one matcher, to a syntax that was measured** (W6-D9, §8.1, 06 §13, 03 §5.7 row 4). Nothing outside the runtime can see a command line before it runs — it exists for an instant inside the agent's tool call — so `holds` for a boundary of kind `command` is `intercepted` and `api` refuses `enforced` on the kind. One function, `commandMatches(pattern, line)` in `@harness/compose`, is read by four places and copied into none: the `commands` enforcer puts the covering boundaries on `SpawnPlan.commands` the way `network` puts endpoint denies on `deny`; the Claude adapter emits `Bash(<pattern>)` into the session's `settings.json`; the Pi adapter writes the **compiled rule** into `policy.json` and the extension applies it with `new RegExp(match).test(line)` (it is in the vendored Pi tree and cannot import the package, so it is handed the rule rather than a second copy); and the console's add form validates the shape with the same two sentences `api` refuses with. The rule itself is not ours — it is what 2.1.286 was measured to do in §8.1, down to splitting the line at `\|`, `&&` and `;` — because a boundary that means two things in two runtimes means nothing. Its one asymmetry is admitted rather than papered over: a pattern holding a shell operator cannot fire in Claude Code at all, so `claudeHolds` keeps it out of `settings.json` and the console row reads *intercepted by Pi*. | writing a matcher of our own and configuring each runtime to approximate it — then `rm -rf /*` denies two different sets of commands depending on which runtime you launched, and the console can only lie about one of them |

## 15. Out of scope

Cursor, MCP definitions, `harness provider add`, managed installs (D10).
Brokered OAuth for provider logins (`prd-v2.md` §22). A third render target
(`prd-v2.md` §20). Any change to Pi upstream: `docs/pi-patches.md` stays at
zero patched files.

## 16. Definition of done

- Both adapters at or under 300 lines; `layout.ts` under 150; the extension under 250.
- Every named test exists and passes on macOS; T3 tests also pass on Linux under `06`'s profile.
- `harness preflight claude provider` prints the capabilities matrix with this machine's probed answers, `located.version`, and the managed-tier finding (08 §11.13).
- `grep -r HARNESS_REDACTIONS` over the repo returns nothing.
- `00 §4.8` carries `Rehydrated.files`.
- A fresh checkout renders, rehydrates with zero drift, and launches Pi in org mode against the proxy from `05`, with no provider key anywhere in the child environment (`env | grep -i key` inside the jail is empty — this is a test, `no_key_in_child_env`, T3).


> **Amendments from construction (25 Sep):** provider base URLs are the proxy *origin* (00 §4.8); prompts are symlinks into the work tree like skills (C5 `render_copies_nothing`), not 0600 copies; `locate` walks the person's full `PATH` (it runs outside the jail; the filtered `PATH` is the child's); `import-common.ts` is shared code at `adapters/` top level; `expected().denies` is the `Write(<dir>/**)` form; native mode is chosen via `Choices.native` (00 D11), never refused by name.

> **Import pushes (25 Sep):** `harness import` pushes the imported assets and the harness definition to the person's own branch as part of the command — `run --<name>` composes only what is on a ref, so an un-pushed import cannot be run. Push to one's own branch is *keep as mine*, never a review, so nothing is decided by anyone else. 08 §11.19's "nothing is pushed" is superseded by this note; the exit review still offers later edits.
