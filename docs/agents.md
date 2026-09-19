# Agents

A **harness** is the job you sit down to do — a named selection of the team's
assets ([`harnesses.md`](harnesses.md) §0). An **agent** is the runtime that
does it: Pi today, Claude Code next, whatever ships after. The two are
independent on purpose. You pick a harness because of the *work*; you pick an
agent because of the *tool you like*. This document is how the second choice
becomes real.

§0–§13 are normative: if code and this document disagree, the code is wrong.
§14 lists the tasks in build order, in the format of
[`build-plan.md`](build-plan.md).

Related: [`enforcement-architecture.md`](enforcement-architecture.md) (the
boundary this must not weaken by accident), [`asset-sync.md`](asset-sync.md)
(the one work tree), [`enforcement-gaps.md`](enforcement-gaps.md) (what is
still open).

## 0. The one rule

> **One work tree, many renderers. The agent changes; what you own does not.**

`harness run --claude` and `harness run --pi` resolve the same manifest,
hydrate the same `~/.harness/assets`, and push back to the same place. Only
the *rendering* differs — which file the memories land in, which setting
points at the skills, which variable carries the model endpoint.

Two things follow, and they are the whole design:

1. **Behaviour will differ; infrastructure will not.** Pi and Claude Code do
   not have the same tools, the same prompt UI, or the same permission model.
   A session will feel different. What must not differ is which assets loaded,
   which boundary applied, and what got recorded.
2. **A difference must be declared, not discovered.** Every adapter states what
   it can honour. Anything it cannot honour is either dropped *loudly* or
   refuses to boot — never dropped silently. §3.

## 1. What this amends

| Document | Amendment |
| --- | --- |
| `enforcement-architecture.md` §6 | `Adapter` gains `capabilities`, `locate`, `denyWrite`, and `auth`. `render` is no longer assumed to be able to point at the work tree (§10). |
| `enforcement-architecture.md` §1, §2 | "The sandbox holds nothing" becomes conditional on the model mode (§5, §6). |
| `enforcement-architecture.md` §3 | Inject mode must **replace** inbound `Authorization`, not strip it (§5.2). |
| `enforcement-architecture.md` §4 | `SpawnPlan.filesystem` gains `denyWrite` (§7.3). |
| `build-plan.md` Phase 2 | "The Pi adapter" becomes "Adapters"; §14 here replaces 2.1. |
| `build-plan.md` v2 backlog | "Claude Code adapter (config-only tier)" moves into v1. |
| `prd.md`, `enforcement-philosophy.md` | Claims resting on a control §11 removes are struck with it. |
| `enforcement-gaps.md` G11 | Restated: the adapter locates and version-checks the binary (§8). |
| `asset-sync.md` §0 | "One copy on the machine" survives, but via symlinks for agents with no external-directory setting (§10, Spike 0). |

Nothing here changes `backend/app/`'s neutrality, resolution, the boundary
merge rule, or the work tree. Those are the parts that already work.

## 2. Choosing an agent

```
harness run pi                    # the agent is the word after `run`
harness run claude                # no dash: it is what you are booting, not a modifier
harness run pi --marketing        # boot straight into the "marketing" harness
harness run claude --team/support # qualified, when a bare name is ambiguous
harness run                       # the only agent you have
harness run pi -- --resume        # everything after `--` goes to the agent
```

**The agent is a positional; the harness is the flag.** This reads the way the
act does — you *run Pi*, and the flag says which job you sit down to. It also
keeps the two choices visibly different in shape, which is the point of §0:
one is the tool, the other is the work, and they vary independently.

The agent word must be a known adapter id. Anything else is an error naming
what is available — it is never passed through to an agent, because a typo'd
agent name silently launching the wrong agent is the one failure this command
must not have. With no agent word and exactly one adapter installed, that one
is used; with more than one, `run` asks rather than guesses.

**The harness flag is a per-run override.** It does not move the persisted
selection — that is `harness switch`'s job, and the two must not fight. With
no flag, the session boots the switched-to harness exactly as before, so
`harness run pi` is the old `harness run` with the agent said out loud.

Name resolution matches `harness switch` exactly, and must keep matching it:
case-insensitive against `name` or `org_unit_path/name`; no match lists what
you have; more than one match refuses and prints the qualified form for each.
Harness names do not shadow between org units, so two teams may both have a
`marketing` — `--marketing` cannot mean both, and guessing is worse than
asking.

Exactly one undashed word and at most one harness flag may appear before `--`.
Everything after `--` is the agent's, verbatim, and the CLI does not read it.

**`boundary.allowed_agents: string[]`** is the governance half, top-down and
tightening-only like every other boundary. Default: all agents the CLI knows.
An empty array means no agent may run — a policy that permits nothing, which
`merge_boundaries` already distinguishes from "not set". The supervisor
refuses to launch an adapter outside the list *before* Resolve completes.
Permission is server-side; rendering is client-side.

## 3. Capabilities, honouring, and dropping

The centre of agent-agnosticism is not the renderer. It is the honest account
of what the renderer could not do.

Each adapter declares, statically, what it can express:

```ts
type Concern =
  | "skill" | "prompt" | "system_prompt" | "memory" | "tool_index"
  | "tool_gating" | "audit" | "state_isolation" | "project_suppression"
  | "model_proxied" | "model_gateway" | "model_native";

type Support = "native" | "emulated" | "none";

interface Capabilities {
  readonly concerns: Record<Concern, Support>;
  /** Model wire formats this agent can speak against a `model-default`. */
  readonly wireFormats: Array<"anthropic-messages" | "openai-completions">;
  // Names taken from Pi's `Api` union (pi/packages/ai/src/types.ts:16-38),
  // which also has openai-responses, google and bedrock. v1 needs two.
}
```

- **`native`** — the agent has a first-class mechanism. Pi's `settings.json`
  `skills` list for skills.
- **`emulated`** — we get the effect by a mechanism that is ours, not the
  agent's. Symlinks into a generated config directory. Works; carries our
  maintenance.
- **`none`** — no mechanism exists. Say so.

**A declaration is a claim about the agent, not about this machine.** An
adapter can say `native` and still fail here, because the customer's own
managed configuration outranks ours (§5.4 is the live example: proxied mode is
native to Claude Code and impossible on a machine with `forceLoginOrgUUID`
deployed). `probe` (§9) is what turns the claim into this machine's truth, and
`harness doctor` prints the probed answer, never the static one. A concern that
probes false is a drop, and the §3 rules apply to it unchanged.

The planner computes, per session, a **disposition** for every concern the
manifest actually uses. A concern the manifest does not exercise (no prompts
in this harness) is not a drop.

**The policy dial.** `boundary.agent_requirements: Concern[]` — concerns that
must be `native` or `emulated` for a session to start. Default in v1:
`["audit"]` when `approvals.deploy` is `required`, otherwise empty. A concern
in the list that the chosen adapter reports as `none` is a **failed boot**,
named: *"Claude Code cannot load saved prompts, and your org requires it. Use
`--pi`, or ask an admin."* Everything not in the list is dropped with a
one-line notice at startup and a row in `harness doctor`.

This is the rule that lets the product be honest about §0's promise. Parity is
not claimed; it is measured, per agent, per machine, and shown.

## 4. The adapter interface

Replaces `enforcement-architecture.md` §6's interface.

```ts
interface Adapter {
  readonly id: string;                      // "pi" | "claude"
  readonly displayName: string;             // "Pi" | "Claude Code"
  readonly capabilities: Capabilities;

  /** Canonical tool name → this agent's name (§7.1). Missing key = no such tool. */
  readonly toolNames: Record<string, string>;

  /** Find the binary and its version. Throws if absent or below `minVersion`. */
  locate(): Promise<{ path: string; version: string }>;
  readonly minVersion: string;

  /** Paths inside the write geometry this agent must NOT be able to write —
      its own settings files, so a session cannot rewrite its own policy. */
  denyWrite(ctx: RenderContext): string[];

  /** Where this agent keeps credentials when the user logs in natively (§6). */
  readonly auth: {
    /** Stable per-user store the supervisor owns, relative to ~/.harness/agents/<id>/ */
    store: "config-dir" | "seed-and-harvest";
    /** Hosts a native login needs reachable. Informational — §6.3. */
    providerHosts: string[];
  } | null;

  render(ctx: RenderContext): Promise<RenderReport>;
  launch(ctx: RenderContext): { argv: string[]; env: Record<string, string> };

  /** Assert the agent actually came up under the plan. Throws = abort boot. */
  probe(ctx: RenderContext, run: ProbeRunner): Promise<void>;
}

interface RenderContext {
  manifest: Manifest;
  assetsRoot: string;                       // ~/.harness/assets
  sessionDir: string;                       // ~/.harness/sessions/<id>
  agentDir: string;                         // sessionDir/agent
  plan: SpawnPlan;
  model: ModelPlan;                         // §5
  tools: Array<{ name: string; description: string; run: string }>;
}

/** What actually happened, per concern. The planner turns this into the
    startup notice and the doctor rows. Rendering reports; it does not decide. */
interface RenderReport {
  honoured: Partial<Record<Concern, { how: string }>>;
  dropped: Partial<Record<Concern, { why: string }>>;
}
```

`render` writes **only generated files**, all under `ctx.agentDir`, all
read-only to the user. It may create symlinks into `ctx.assetsRoot`; it may
not copy assets. `launch` may add env keys; it may never remove or override
the core set (`enforcement-architecture.md` §2), which `childEnvironment`
already enforces (`pi/packages/harness-cli/src/env.ts:39`).

## 5. The model, in two axes

The current design has exactly one model story: the org's key, injected by the
proxy, the agent issued nothing (`enforcement-architecture.md` §3). That is a
good story and it is not the only one. Both Pi and Claude Code can authenticate
with a **subscription**, through a browser, with no API key anywhere — Pi has
OAuth flows for Anthropic, OpenAI Codex, GitHub Copilot, xAI, OpenRouter and
more (`pi/packages/ai/src/auth/oauth/`); Claude Code's default for Pro, Max,
Team and Enterprise users is exactly that.

An enterprise harness that cannot express "use your own Claude Max login" is
not agnostic. So the policy is two independent axes, both inheriting top-down
and tightening only.

### 5.1 The axes

**`boundary.model_policy.source`** — what the org provides:

| Value | Meaning |
| --- | --- |
| `proxied` | A `model-default` connection with a `key_ref`. Our proxy attaches the key. Metered, revocable, the agent holds nothing. Today's design. |
| `gateway` | The org runs its own gateway — LiteLLM, Bedrock, a Claude apps gateway. We point the agent at it and attach nothing; the gateway owns auth and metering. |
| `none` | The org provides no model. |

**`boundary.model_policy.user_credentials`** — what the user may bring:

| Value | Meaning |
| --- | --- |
| `forbidden` | The agent gets the org's model and nothing else. Native login refused; ambient provider variables stripped (they already are — `env.ts:24`). |
| `allowed` | The user may run `harness auth <agent>` and use their own subscription. The org's model stays the default. |
| `required` | There is no org model to fall back to. |

The user's three cases, exactly:

| The org… | `source` | `user_credentials` |
| --- | --- | --- |
| provides a model, and it is the only one | `proxied` or `gateway` | `forbidden` |
| provides a model, but you may use your own | `proxied` or `gateway` | `allowed` |
| provides nothing; bring your own login | `none` | `required` |

`source: none` + `user_credentials: forbidden` is a valid, deliberate
configuration: it means *no model*, and `harness run` refuses to start with
that sentence. It is the honest form of what
`pi/packages/harness-cli/src/core.ts:154` throws today.

**An absent model must not become an accidental one.** G13 records what
happens today: with no `model-default`, Pi refuses and Claude Code runs
anyway, on the developer's own `~/.config/anthropic` profile, because
`CLAUDE_CONFIG_DIR` does not relocate it and `HOME` is passed through. The
session works, nobody is told whose credential paid, and the org sees no
usage. Ambient provider credentials are therefore `user_credentials: allowed`
arrived at by accident — and under `forbidden` they are a hole. Each adapter
contributes its own ambient credential paths to the deny-read set, because
where an agent keeps a login is per-agent knowledge that moves with the agent.

**`manifest.model` becomes optional at the client too.** Today the CLI hard-
fails when the server sends `model: null`, even though `/v1/resolve` emits
that quite happily (`backend/app/domain/resolve.py:83`). After this work the
absence of a model is a policy question, answered by the table above, not a
crash in `materializeManifest`.

### 5.2 Proxied mode, per agent

The `model-default` connection asset gains a required **`wire_format`**:
`"anthropic-messages"` or `"openai-completions"`. Today the CLI hardcodes
`api: "openai-completions"` (`core.ts:184`), which silently makes the org's
model connector an OpenAI-shaped endpoint. Claude Code speaks the Anthropic
Messages API and cannot use it. The adapter declares `wireFormats`; the
planner fails closed on a mismatch, naming both sides.

| Agent | Proxied mode mechanism |
| --- | --- |
| Pi | `models.json` `providers.<id>.baseUrl` → `proxyUrl + "/connectors/model-default/"`, `apiKey: "unused"`, `api` from `wire_format`. |
| Claude Code | `ANTHROPIC_BASE_URL` → the same path, plus `ANTHROPIC_AUTH_TOKEN` = the session secret. Level 2 of Claude Code's seven-level auth precedence, above `ANTHROPIC_API_KEY` and `apiKeyHelper`. |

**Proxy amendment.** `enforcement-architecture.md` §3 says inject mode strips
inbound `Authorization`. Claude Code sends the session secret in exactly that
header, so inject mode must **replace** it: verify the inbound bearer against
the session secret, drop it, attach the connector credential. Stripping first
and asking questions later would make the header useless as the authentication
it is. `Cookie` and `X-HTTP-Method-Override` are still stripped outright.

`apiKeyHelper` is the interesting alternative for Claude Code and is **not**
v1: it re-runs every five minutes (`CLAUDE_CODE_API_KEY_HELPER_TTL_MS`), which
would give per-session credential revocation — G12 — without ending the
session. Recorded here so it is not rediscovered; it conflicts with §5.4 and
with `enforcement-architecture.md` §2's "a policy change ends the session".

### 5.3 Gateway mode

The harness writes the base URL and gets out of the way. For Claude Code this
is first-class and already exists: `forceLoginMethod: "gateway"` +
`forceLoginGatewayUrl`, where the gateway-issued token becomes the session's
only credential and outranks every other source. For Pi it is a provider entry
with the gateway's `baseUrl` and whatever auth the gateway expects.

We attach nothing, meter nothing, and say so. The org already has both.

### 5.4 The customer's own managed settings come first

Claude Code has a **managed settings** tier — `managed-settings.json` in a
system directory, an MDM profile, or server-managed settings from the claude.ai
console — that outranks everything the harness can write. This is not a
problem to route around. It is a customer's existing policy and it wins.

The consequence that bites: a machine with **`forceLoginOrgUUID`** set blocks
any session whose credential comes from `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, or `apiKeyHelper` — *at startup*. Proxied mode on
Claude Code is therefore impossible on such a machine, and no amount of
`--settings` fixes it.

**The rule: harness policy sits below the customer's managed tier, never
fights it.** The Probe phase (§9) asserts the agent actually came up under the
plan and aborts with the real reason if it did not. A failed boot naming
`forceLoginOrgUUID` is a good outcome; a session that silently used the wrong
credential is not.

## 6. Native login

### 6.1 It happens outside the jail

An OAuth browser login needs three things the sandbox exists to deny: a
browser on the host, a loopback listener for the callback (Pi binds
`127.0.0.1:53692`; `allowLocalBinding` is pinned closed by G9), and credential
storage that survives the session. All three belong to the supervisor.

```
harness auth claude        # runs the agent's own login flow, outside the jail
harness auth --list        # which agents you are signed in to
harness auth --logout pi
```

The supervisor owns a stable store per `(user, agent)` at
`~/.harness/agents/<id>/`. It is outside `~/.harness/assets`, so the work tree
stays the agent-writable part and this does not.

| Agent | Store mechanism |
| --- | --- |
| Claude Code | `CLAUDE_CONFIG_DIR=~/.harness/agents/claude`. Documented to relocate `.credentials.json` *and* key the macOS Keychain entry to that directory, so a harness login and the user's personal `claude` login do not collide. `store: "config-dir"`. |
| Pi | `auth.json` is bound to `getAgentDir()` (`config.ts:548`); `AuthStorage` takes an `authPath` but the CLI does not expose one (`main.ts:179`). Per-session `PI_CODING_AGENT_DIR` would therefore throw the login away every session. `store: "seed-and-harvest"`: link or copy the stable `auth.json` into the session agent dir before spawn, write back after exit. Spike 2. |

### 6.2 What it costs, stated plainly

**Native mode puts a credential in the jail.** OAuth refresh rotates it, so
the agent writes it too. `enforcement-architecture.md` §1's "holds nothing. no
token, no key" becomes, in native mode, *"holds one provider credential, which
can only exit to the provider's own hosts."* That is a real weakening and it
is the price of the feature. It is why `user_credentials` is a boundary an org
can set to `forbidden`.

Two further consequences, recorded rather than resolved:

- §4's mandatory deny-read includes **login keychains**. On macOS, Claude
  Code's native credential lives in the Keychain. Native mode on macOS
  collides with the deny set. Open question; Spike 3.
- Metering. PRD §1.10 meters consumption per node. In native mode model
  traffic is a `CONNECT` tunnel we do not inspect, so **there are no token
  counts**. Sessions, tool calls and durations are still recorded; spend is
  not. The console must show this as "not metered", not as zero.

### 6.3 Provider hosts are policy, not an adapter addition

A native login needs `claude.ai`, `platform.claude.com` and
`api.anthropic.com` reachable. Enforcers compose by **intersection**
(`enforcement-architecture.md` §5) — an adapter cannot add a host, and must
not be able to, or the monotonic rule that makes the whole boundary model
work would have an exception in it.

So: setting `user_credentials` to `allowed` or `required` **implies** the
org has allowed that agent's provider hosts. The `network` enforcer reads
`model_policy` and unions them into the allowlist at *plan* time, from
server-side policy. `Adapter.auth.providerHosts` is informational — it is what
`harness doctor` prints to tell an admin which hosts the choice implies. It
never reaches `plan.hosts` on its own.

## 7. Enforcement, per agent

### 7.1 Police effects, not tool names

Three different things have been sharing the word *tool*, and the distinction
decides which of them we can actually enforce.

| | What it is | Choke point | Verdict |
| --- | --- | --- | --- |
| **A tool asset** | a team executable: a directory with a `run`, in the work tree (`enforcement-architecture.md` §7) | — | **portable by construction.** Any agent with a shell runs it. Only the *index* — the paragraph saying it exists and where — is per-agent |
| **Gating a tool asset** | may this session run `deploy`? | **sandbox** — the binary is at a path we chose | **enforced.** §7.1.1 |
| **Gating a built-in** | may the agent call `Bash`, `Edit`, `WebFetch`? | none at the call | **advisory by name, enforced by effect.** §7.1.2 |

The first row is the design's best idea and it needs no adapter work. A tool
is a shell script; a shell is the one thing every agent in scope has. Porting
team tools between Pi and Claude Code is already free.

#### 7.1.1 Team tools are gated by the read geometry

A tool asset lives at a path the supervisor materialised:
`~/.harness/assets/tool/<name>/run`. A tool the selected harness does not
contain, or that the boundary does not permit, is denied at that path and
stops existing for that session — on Linux by never being bound into the
namespace, on macOS by a Seatbelt rule.

> **Correction — the earlier mechanism here was wrong.** This section used to
> claim "a binary that cannot be read cannot be executed", and deny only
> `file-read*`. That is false for a compiled binary, and a tool's `run` may be
> any executable. Measured on Darwin 24.3.0, reproduced independently:
>
> | Profile | `cat` a script | exec a script | exec a **compiled binary** |
> | --- | --- | --- | --- |
> | `deny file-read*` alone | blocked | blocked | **runs** |
> | `+ deny process-exec` | blocked | blocked | blocked |
>
> Reading and executing are separate Seatbelt operations. The deny set names
> **both**, and the probe asserts a compiled binary specifically — a script is
> not a sufficient test case, because it fails for the wrong reason and would
> have passed a profile that leaves the hole open. Recorded in
> [`sandbox-notes.md`](sandbox-notes.md) under Spike 5.

This is real enforcement at a choke point we own, it is per-harness, and it is
completely agent-agnostic: it does not care what the agent calls its shell, or
whether the agent has a concept of a tool at all. It is also the first thing
that makes a harness a boundary rather than only a context selector — with one
important limit, stated in `harnesses.md` §0 terms: **the harness still only
takes away.** Nothing here lets a harness reach something the tree did not
already resolve for that user.

Today this is not done. Hydration materialises the whole resolved set
(`asset-sync.md`, and the comment at `index.ts:89`), so every tool the user
resolves is on disk and reachable through `bash` whatever harness is selected.
Closing that is 13.1.

> **Probed, and the assumption failed.** See the correction above. The value
> of a spike is precisely this: the mechanism that reads as obvious was wrong,
> and only running it found out.

#### 7.1.2 Built-ins: the name is the agent's, the effect is ours

We do not sit between the model and the agent's tool dispatcher, so
`allowed_tools` naming `Bash` cannot be *enforced*. What can be enforced is
everything that tool would need:

| Intent | Enforced by | Where |
| --- | --- | --- |
| may not write outside the workspace | `plan.filesystem.allowWrite` | sandbox |
| may not read the credential, `~/.ssh`, `~/.aws` | `denyRead` | sandbox |
| may not reach an unlisted host | `plan.hosts` | proxy |
| may not use a connector it was not granted | inject-mode rule lookup | proxy |
| may not run a tool this harness excludes | `denyRead` | sandbox (§7.1.1) |

This is why the canonical vocabulary (§11.3) should be **capabilities, not
tool names**:

```
filesystem.read  filesystem.write  process.exec  network.fetch
connector.<name>  tool.<name>
```

A capability is the same on every agent because it describes an effect on the
world. A tool name is the agent's private vocabulary and differs — `find` on
Pi, `Glob` on Claude Code. Storing capabilities means an admin's policy
survives an agent swap unchanged, which is the whole point of §0.

`Adapter.toolNames` still exists, but demoted: it renders the capability set
into whatever advisory allowlist the agent offers (`--tools` and the extension
for Pi, `permissions.deny`/`ask` for Claude Code) so the agent's own UI agrees
with the boundary. That layer is best-effort and labelled so. The boundary
does not depend on it.

### 7.2 Audit is not UX

`enforcement-architecture.md` §6 item 6 calls the hook API "*Optional:* hook
or extension API — UX only". Tool-call notices are UX. **The audit trail PRD
§1.10 requires is not**, and it currently exists only through Pi's extension
API (`pi/packages/harness/src/index.ts`).

| Agent | Producer |
| --- | --- |
| Pi | The existing extension: `pi.on("tool_call")` / `("tool_result")` → `audit.jsonl`. |
| Claude Code | `PostToolUse` **and** `PostToolUseFailure` hooks, writing the same `audit.jsonl` lines. Both are required: a failed tool call fires only the second, so hooking one drops every failure silently. `PreToolUse` is a gate, not a record — it carries neither outcome nor duration. |

Both are **best-effort telemetry, not the authoritative record** — the proxy
log is (`enforcement-architecture.md` §3). Claude Code's hooks are only
tamper-resistant at the *managed* tier, which is the customer's MDM and not
ours to write. At the tier we can write (`--settings`, level 2), a session
could plausibly disable them by writing `<workspace>/.claude/settings.json`,
which Claude Code reloads mid-session. That is the same trust level Pi's
extension has, and it is why §7.3 exists.

`audit` is a declared concern (§3), so an org that needs it can require it and
get a refused boot rather than a quiet gap.

### 7.3 An agent must not rewrite its own policy

New field, amending `enforcement-architecture.md` §4:

```ts
filesystem: { allowWrite: string[]; denyRead: string[]; denyWrite: string[] }
```

`denyWrite` is a deny *inside* the write geometry, unioned from every
adapter's `denyWrite(ctx)`. For Claude Code: `<workspace>/.claude/settings.json`,
`<workspace>/.claude/settings.local.json`, `$CLAUDE_CONFIG_DIR/settings.json`.
For Pi: `<workspace>/.pi/settings.json`, and the generated `settings.json` and
`models.json` in the session agent dir. The workspace stays writable; the
files that decide what the agent may do do not.

This generalises the existing exclusions of `assets.git` and `policy.json`,
and it is what makes §7.2's hooks worth configuring.

**This is demonstrated, not prudent.** A `PreToolUse` hook delivered through
`--settings` fires normally; the identical run inside a workspace whose
`.claude/settings.json` contains `{"disableAllHooks": true}` executes the tool
and never fires the hook — `Found 0 total hooks in registry`. Any session able
to write its own workspace can therefore switch off its own audit trail, in
one line, silently. Reproduced independently on Claude Code 2.1.275.

Two independent chokepoints close it and the adapter uses **both**:
`--setting-sources user` means the file is never read, and `denyWrite` means
it cannot be written. Neither alone is sufficient — a flag is part of the
argv the plan chose, while `denyWrite` is enforced by the sandbox, and §0's
test for any control is whether it survives the other one failing.

## 8. Which binary, and which version

Pi is vendored; Claude Code will not be. `locate()` makes that explicit:
resolve the binary the adapter is responsible for, read its version, refuse
below `minVersion`. G11's "document that a `pi` on the user's `PATH` is not
what we run" becomes the stronger, true statement: **the adapter chose the
binary and checked its version, and `doctor` prints both.**

Generated settings disable self-update where the agent supports it
(`autoUpdatesChannel`, `minimumVersion` for Claude Code; `--offline` for Pi),
so a session cannot silently become a version the plan was not probed against.

## 9. Probing

`enforcement-architecture.md` §2's Probe phase asserts the *boundary*: a
denied host fails, a denied path fails, an out-of-geometry write fails.
`Adapter.probe` adds the *rendering*: the agent came up, it is the version we
located, it resolved the model source the plan chose, and it is not silently
using a credential we did not give it.

For Claude Code this is a headless `-p` run under the exact generated settings
asserting the active credential source; for Pi, a headless invocation that
reports its resolved provider. Any mismatch aborts boot with the real reason —
including "your organisation's managed settings require a claude.ai login"
(§5.4). No partial start, no degraded mode.

## 10. The parity matrix

What each adapter can express today. `?` is an open spike (§13). This table is
the thing `harness doctor --agent <id>` renders, per machine, with the
machine's real answers substituted for the guesses.

| Concern | Pi | Claude Code |
| --- | --- | --- |
| skills | **native** — `settings.json` `skills: [assetsRoot + "/skill/<name>"]`, per harness | **emulated** — symlinks at `$CLAUDE_CONFIG_DIR/skills/<name>` → the work tree. Verified: loaded from a cold config dir, content read through the link, no copy made. Not the plugin marketplace — §14.5 |
| prompts (`/name`) | **native** — `--prompt-template <dir>`, one file per name | **emulated** — `$CLAUDE_CONFIG_DIR/commands/<name>.md`, symlinked |
| system_prompt | **emulated** — concatenated ahead of memories into `AGENTS.md` | **native** — `--append-system-prompt`, which is the distinction Pi cannot express |
| memory | **native** — `AGENTS.md` | **native** — `CLAUDE.md` in the generated config dir |
| tool index | **emulated** — appended to `AGENTS.md`, absolute `run` paths | **emulated** — appended to `CLAUDE.md`, same format |
| tool gating | **emulated, advisory** — extension `tool_call` + `--tools` allowlist | **emulated, advisory** — `permissions.deny` / `permissions.ask`, `PreToolUse` returning `permissionDecision: "deny"` |
| audit | **emulated** — extension events → `audit.jsonl` | **emulated** — `PostToolUse` hook → `audit.jsonl` |
| state isolation | **native** — `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR` | **native** — `CLAUDE_CONFIG_DIR` (settings, history, credentials, keychain key) |
| project suppression | **native** — `--no-approve`, `--no-extensions`, `--no-prompt-templates`, `--no-skills` | **native** — `--setting-sources user` drops the workspace's skills, commands and `CLAUDE.md` together. `claudeMdExcludes` is the narrower complement |
| model: proxied | **native** — `models.json` `baseUrl` | **native** — `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`, unless `forceLoginOrgUUID` is deployed (§5.4) |
| model: gateway | **native** — provider `baseUrl` | **native** — `forceLoginMethod: "gateway"` + `forceLoginGatewayUrl` |
| model: native login | **native** — seven OAuth providers; `auth.json` bound to the agent dir (Spike 2) | **native** — `/login`; `CLAUDE_CONFIG_DIR` keys the store |
| wire formats | `openai-completions`, `anthropic-messages` | `anthropic-messages` |

The two `?` rows are why Spikes 0 and 1 come first: they decide the render
shape of the entire Claude Code adapter, and one of them may turn "point, do
not copy" into "symlink, do not copy" for that agent.

## 11. Subtraction: only ship what we can control

A boundary the product cannot enforce is worse than no boundary, because an
admin who set it believes it holds. The same is true of a number we cannot
measure and a policy we can only ask an agent to respect. Going agent-agnostic
makes this urgent rather than academic: a control that quietly depended on Pi
would, the first time somebody ran `--claude`, become a switch in the console
that does nothing at all.

### 11.1 The test

> **A control ships only if it has a choke point we own.**

We own exactly three:

| Choke point | Owns | Enforces |
| --- | --- | --- |
| **Control plane** | assets, versions, membership, sessions | who may see, publish, promote, or start anything |
| **Proxy** | every byte leaving the jail | destinations, connector credentials, request counts |
| **Sandbox** | the process tree and the filesystem | what may be read, written, and executed |

A control at none of these is the *agent's* behaviour. We may render it as a
preference and tell the agent about it; we may not present it as a boundary.

Three outcomes, and every control gets exactly one:

- **Enforced** — a choke point we own refuses it. Ships as a boundary.
- **Advisory** — rendered into the agent's configuration, honoured at the
  agent's discretion, recorded when violated. Ships, labelled *advisory*, in
  different type and a different colour from an enforced control. Never in the
  same list as enforced ones.
- **Removed** — neither. Comes out of the console, out of `merge_boundaries`,
  out of the manifest.

### 11.2 Mode-dependent controls are per-mode, never global

§5 makes the model source a choice, and some controls only survive some
choices. A spend cap is real in `proxied` mode, where the proxy sees every
request. It is unmeasurable in `gateway` mode (the gateway meters, not us) and
in native mode (§6.2 — a tunnel we do not inspect). The same control is
therefore enforced, delegated, and impossible depending on one policy field.

The rule is the same as §3's: **the claim is per-configuration, and `doctor`
prints the probed answer.** A cap that cannot bind in the mode this org runs
says so, on the row, in the console — not in a footnote.

### 11.3 The audit, as of today

Every control now in the console, judged by §11.1. This is the input to 14.9,
not its output; a `?` is a decision to take, not a decision taken.

| Control | Choke point | Verdict |
| --- | --- | --- |
| `egress_allowlist` | proxy | **enforced** once Phase 3 lands |
| `connector_allowlist` | proxy (inject mode refuses an unknown name) | **enforced** once Phase 3 lands |
| `build_policy.push_review` | control plane — `provenance ? 'pending_review'` already filters resolution (`resolve.py:38`) | **enforced today**, and mislabelled: `doctor.ts:31` lists it as advisory |
| `approvals.deploy` | **two controls sharing one name.** The promotion gate is control-plane and enforced; the client-side confirmation before a `deploy_tools` call is agent-side and advisory | **split them.** One name, two verdicts, is how a real control lends its credibility to one that has none |
| `budget.requests_per_minute` | proxy, counting | **enforced in `proxied` mode**; degraded to counting tunnels in native mode; not ours in `gateway` mode (§11.2) |
| `budget.monthly_usd_cap` | proxy, counting — but tokens→dollars needs per-model pricing we would have to maintain, and it is unobservable outside `proxied` mode | **?** — scope to `proxied` and own the pricing table, or remove |
| `load_policy.default` | none. Whether a skill loads eagerly or on demand is the agent's context strategy; Pi and Claude Code each have their own and neither takes direction | **remove**, or restate as the one thing we do control — *which* assets a harness contains, which is what a harness already is |
| `allowed_tools`, where it names a **team tool** | sandbox — `denyRead` on the tool's path (§7.1.1) | **enforced** once 14.1 lands. Not advisory; an earlier draft of this document had this wrong |
| `allowed_tools`, where it names a **built-in** | none by name; the effect is enforced by the filesystem and the proxy (§7.1.2) | **restate as capabilities**, which are enforced, and keep the name-level allowlist as the agent-facing rendering of them |
| `deploy_tools` + per-call confirmation | none — we do not see the call | **advisory**. Which tools exist is ours; when the user is asked about one is the agent's |
| `HARNESS_REDACTIONS` | none — post-hoc, and `pi-extension-notes.md` lists what it misses | **remove at 3.2**, as already planned: once the proxy holds the keys there is nothing in the jail to redact |

`doctor.ts` already tells this truth per field (`ENFORCED`, `ADVISORY`,
`"not enforced yet"`). The console does not. That asymmetry is the bug:
the person who needs the distinction most is the admin setting the control,
and they are the one who never sees it.

### 11.4 What subtraction is not

It is not a reason to remove a control that is merely *unbuilt*. Egress and
connector allowlists have a choke point and a phase; they stay. The test is
"is there a place we own that could refuse this", not "does it work yet".

## 12. Preferences

§5 says what the model policy *is*. This section is the surface an admin uses
to author it, and it covers agent choice too, because the two questions arrive
together: *which model, and in which tool.*

### 12.1 One flag, two directions

PRD §1.3 splits the world in two: capabilities resolve **bottom-up**,
most-specific-wins, so a user can change how work gets done; boundaries
inherit **top-down** and tighten only, so a user can never widen what a level
above them fenced off.

A preference is the same field on either side of that line, and one flag says
which:

| Mode | Direction | Meaning |
| --- | --- | --- |
| **suggested** | bottom-up, like a capability | a default. Anyone below may override it for themselves. |
| **absolute** | top-down, like a boundary | a constraint. Nobody below may widen it, and the level below may still tighten. |

This is not a new mechanism. `load_policy` already works exactly this way —
`merge_boundaries` walks for the last `prescribed: true` in the chain
(`org_tree.py:87-94`), `validate_tightening` refuses to widen past it
(`:164`), and the console already renders a `prescribed` badge
(`admin.tsx:483`). One field has had this for a while. **Preferences is that
pattern generalised, not a parallel system**, and `prescribed` is renamed to
`mode: "suggested" | "absolute"` so the same word appears in the console, the
API, and this document.

### 12.2 The v1 fields

| Field | What it sets |
| --- | --- |
| `model.default` | the model a session starts on |
| `model.allowlist` | which models may be used at all |
| `agent.default` | `pi` or `claude` — which agent `harness run` picks with no agent word |
| `agent.allowlist` | which agents may run (this is §2's `allowed_agents`, arriving here rather than alone) |

Each carries its own `mode`. An org may make the model allowlist absolute
while leaving the default merely suggested — that is the common case, and the
combination is the point: *use what you like, from this list.*

### 12.3 What each one can actually enforce — §11 applied

The subtraction rule is not suspended for a feature we like. Every row here
gets the §11.1 test, and the answers differ per field and per model mode.

| Field | Choke point | Verdict |
| --- | --- | --- |
| `model.allowlist`, **proxied** | proxy — it sees the model on every request and refuses one off the list | **enforced** |
| `model.allowlist`, **gateway** | the gateway's own controls | **delegated** — real, but the org's, not ours. §12.4 |
| `model.allowlist`, **native** | none — a tunnel we do not inspect (§6.2) | **advisory** |
| `agent.allowlist` | proxy — a session registers which agent it is, so the credential can be refused to an agent off the list | **enforced in proxied mode.** The supervisor's refusal to launch is the *courtesy*; refusing the org's model credential is the control |
| `model.default` | none — both agents let a user switch models mid-session (`/model`) | **suggested-class only** |
| `agent.default` | none, and none wanted | **suggested-class only** |

**`model.default` must not be offered as absolute.** A default is what we
write into the generated config; both Pi and Claude Code let the user change
it afterwards. An "absolute default" with no allowlist behind it is a switch
that appears to bind and does not — exactly the thing §11 exists to keep out
of the console. Making a *default* stick is what the *allowlist* is for, and
the console should say so at the point of choosing.

### 12.4 Required things need a visible empty slot

`model-default` is not an optional asset. Without it every session refuses
(Pi) or silently falls back to a personal credential (Claude Code, G13). Yet
in the console today it is invisible until it exists: the Connections tab
lists what is there, so the one connection a workspace *must* have looks
exactly like a workspace that simply has no connections.

**The Connections tab always renders a `model-default` row — filled or
empty.** Empty, it names what it is (the default model provider), what it
needs (a provider, a model id, a base URL, and a key reference), and links to
the key that would satisfy it. This is the same honesty rule as §11: a control
that does nothing must not look like one that does, and a requirement that is
missing must not look like a choice that was made.

Two adjacent traps the row should close, both hit in practice:

- **A secret is not a connection.** Adding an `api_keys` row — a name, an
  `env_var`, a `secret://` reference — creates the *credential*. The
  connection asset that points at it is a separate object, and nothing in the
  console says so. The empty row is where that gets said.
- **The name is `model-default`, with a hyphen.** The upper-snake-case rule
  in the key form (`admin.tsx:1410`) governs the **environment variable**
  (`MODEL_DEFAULT`), which is correct for an env var and wrong for an asset
  name. Two adjacent fields, two different conventions, no label saying so.
  `resolve.py:86` matches the hyphenated name exactly and silently finds
  nothing otherwise.

### 12.5 Why the console should recommend OpenRouter

Not as a vendor preference — because of a structural problem the user hit
before this section existed.

**The problem.** A `model-default` pointing at Anthropic works under
`harness run claude`, which speaks the Anthropic Messages API natively, and
fails under `harness run pi`, whose `models.json` is hardcoded to
`api: "openai-completions"` (`adapters/pi.ts:40`). One org model connector,
two agents, one of them broken. That is the `wire_format` gap §5.2 predicted,
met in practice.

**What OpenRouter supplies, verified 2026-09-19:**

- **An Anthropic-compatible endpoint** ("the Anthropic Skin") at
  `https://openrouter.ai/api`, alongside the OpenAI-shaped
  `/api/v1/chat/completions`. Extended thinking blocks and native tool use
  pass through, which is what an agent actually depends on. So **one account,
  one key and one allowlist serve both agents** — Claude Code points
  `ANTHROPIC_BASE_URL` at `/api`, Pi points `baseUrl` at `/api/v1`. This is
  the reason to recommend it; billing is secondary.

  **Correction, found while building the console form.** An earlier draft of
  this section said one *connector* serves both agents. It does not, and the
  distinction is the whole of §12.6. The key and the allowlist are shared; the
  two agents need two different URLs, and a `model-default` carries exactly one
  `base_url` (`resolve.py`, `core.ts` `Manifest["model"]`). Whichever address
  is stored works for one agent and breaks the other.
- **Guardrails** — an org-level object carrying a model **and** provider
  allowlist, spend limits, and data-privacy policy, assignable either to a
  member (covering all their keys) or to a single key as an extra layer.
  Enforced by OpenRouter. This is `model.allowlist` in `gateway` mode being
  genuinely enforced by somebody, which is worth more than us enforcing it
  badly.
- **Provisioning API** — programmatic key creation, rotation and disabling.

**What it does not supply, and the console must not imply it does:** a
provisioned key carries only `name`, `limit`, `limit_reset`, `disabled` and
`include_byok_in_limit`. **There is no model allowlist on the key itself.**
Scoping a key means creating a key *and* attaching a Guardrail — two objects,
one of which the provisioning API does not manage. Any copy we write saying
"create a scoped key" is wrong; "create a key, then attach a guardrail" is
right.

The honest framing for the page: *we can enforce this for you at the proxy, or
you can have your provider enforce it and we will show you what it decided.
The second is less code and one fewer place for the boundary to be wrong.*

### 12.6 One connection, two wire formats

`model-default` has a single `base_url`. `adapters/claude.ts` puts it straight
into `ANTHROPIC_BASE_URL`; `adapters/pi.ts` puts it straight into `baseUrl`
beside a hardcoded `api: "openai-completions"`. Those are two different
protocols at two different paths, and one string cannot be both. Today the
console can only warn about whichever choice the admin makes.

The fix belongs with `wire_format` in 14.6: a connection carries an endpoint
**per wire format**, and the adapter picks the one it speaks.

```json
{
  "provider": "openrouter",
  "model_id": "anthropic/claude-opus-4.5",
  "key_ref": "secret://acme/openrouter",
  "endpoints": {
    "anthropic-messages": "https://openrouter.ai/api",
    "openai-completions":  "https://openrouter.ai/api/v1"
  }
}
```

`base_url` stays valid and means "this provider speaks one format, at this
address" — which is every direct provider. An adapter whose `wireFormats`
match no key in `endpoints` fails closed at plan time, naming both sides, per
§5.2. That is what turns §12.5's recommendation from "pick the agent you
want" into one connection that genuinely serves both.

**Adjacent backend gap, found at the same time.** `GET
/v1/org-units/{id}/api-keys` filters on `k.org_unit_id = $1` with no ancestor
walk (`routes_api_keys.py:94`), so a team configuring its own `model-default`
cannot select a key held at the org. Keys resolve up the tree everywhere else;
this endpoint is the exception. It belongs in the same task.

## 13. Open spikes

| # | Question | Blocks |
| --- | --- | --- |
| 0 | ~~Symlinks, or a local marketplace?~~ **Answered:** symlinks work; the marketplace loses a cold-start race (`docs/claude-code-notes.md`) | done |
| 1 | ~~Can the workspace's own `.claude/` be suppressed?~~ **Answered:** `--setting-sources user`, all three at once | done |
| 2 | Can Pi's `auth.json` be pointed outside `PI_CODING_AGENT_DIR` from the CLI, or must the supervisor seed-and-harvest? Does its lockfile behave over a symlink? | 14.6 |
| 3 | macOS: native mode needs the login keychain that §4's deny-read set denies. Reconcilable, or is native mode file-store-only on macOS? | 14.6 |
| 4 | ~~Does project `disableAllHooks` beat `--settings` hooks?~~ **Answered: yes.** Reproduced twice, independently. §7.3 is load-bearing | done |
| 5 | Does `deny file-read*` on a binary actually prevent executing it under the generated macOS profile, given `allow process*`? Linux bind-mount exclusion is not in doubt. | 14.1 |

Each spike is a note appended to [`pi-extension-notes.md`](pi-extension-notes.md)
or a sibling, in the format that file already uses: exact APIs, verified
behaviour, honest limits. A spike that cannot be answered is answered as
`none` in the capability declaration, which is a supported outcome.

---

## 14. Tasks

Ordering: the interface and the Pi adapter first, because that is a pure move
of working code; then the spikes that decide Claude Code's shape; then the
Claude Code adapter; then the model axes; then extraction. The model-policy
work touches Phases 3 and 4 of `build-plan.md` and is marked as amendments
there rather than duplicated.

### 14.1 Capability vocabulary and team-tool gating — §7.1

**Files.** new `backend/supabase/migrations/0018_capabilities.sql`;
`pi/packages/harness-cli/src/core.ts`; new
`pi/packages/harness-cli/src/enforcers/filesystem.ts` (or the Phase 4 file if
it already exists); `doctor.ts`.

**Behaviour.** Two halves.

*Vocabulary.* A `capabilities` table seeded with the §7.1.2 set, in the shape
of `0013_asset_kinds.sql`. A migration rewriting existing `allowed_tools` /
`deploy_tools` entries: the seven Pi built-in names become the capabilities
they imply; anything else is a team-tool name and becomes `tool.<name>`
unchanged. `core.ts`'s hardcoded `builtins` list (`core.ts:221`) leaves the
shared core — the agent-facing allowlist is rendered by the adapter from the
capability set, never stored.

*Gating.* The filesystem enforcer adds to `plan.filesystem.denyRead` every
`tool/<name>` directory in the work tree that the selected harness does not
contain, or that `tool.<name>` does not permit. Fail closed: a tool the
boundary cannot classify is denied.

**Acceptance.** A boundary that said `bash` says `process.exec`; one naming a
tool asset is unchanged apart from the prefix. With a harness that excludes
`deploy`, a session cannot `cat` or run `~/.harness/assets/tool/deploy/run`,
and the same session with `--pi` and `--claude` both fail the same way. Spike 5
is answered in `docs/sandbox-notes.md` before this is claimed on macOS.

**Out of scope.** Per-call approval, which is advisory (§11.3). Denying a
built-in by name.

### 14.2 Adapter interface and the Pi adapter — §3, §4

**Files.** new `pi/packages/harness-cli/src/adapters/{types,registry,pi}.ts`;
`core.ts` (`materializeManifest` moves out); `index.ts`; tests move to
`test/adapters/pi.test.ts`.

**Behaviour.** `Adapter`, `Capabilities`, `RenderContext`, `RenderReport`
exactly as §4. The Pi adapter is today's `materializeManifest` plus the argv
and `PI_*` env currently inline at `index.ts:117-159`, plus `locate`,
`denyWrite`, `probe`, and a `capabilities` declaration matching §10's Pi
column. `run` selects through the registry; with no selection and one known
adapter, Pi. `RenderReport` is produced but not yet acted on.

**Acceptance.** Existing CLI tests pass against `adapters/pi.ts` with
`materializeManifest` deleted from `core.ts`. `harness run` is byte-identical
in what it writes to `sessions/<id>/`. `grep -rn "PI_" src/ --exclude-dir=adapters`
returns nothing.

**Out of scope.** Any second adapter. Capability enforcement (14.3).

### 14.3 Selection, `allowed_agents`, and the honoured/dropped rule — §2, §3

**Files.** `pi/packages/harness-cli/src/adapters/registry.ts`, `index.ts`,
new `src/agent.ts`, `doctor.ts`; `backend/app/domain/org_tree.py` (boundary
key registration only).

**Behaviour.** `--agent`/`--claude`/`--pi`, `harness agent [--none]`,
`~/.harness/agent.json`, the five-step resolution order in §2.
`boundary.allowed_agents` refuses before Resolve; empty array permits nothing.
`boundary.agent_requirements` turns a `none` concern into a failed boot with
the §3 sentence; everything else prints one line at startup. `doctor` gains an
`agent` section rendering §10 for the selected adapter with this machine's
real answers, and `--agent <id>` to inspect another.

**Acceptance.** `harness run --agent nope` lists what is allowed. An org unit
with `allowed_agents: []` refuses every agent, naming the unit. `harness doctor
--agent pi` prints a row per concern with `native`/`emulated`/`none` and the
mechanism.

**Out of scope.** Rendering the matrix in the web console.

### 14.4 Spikes 0 and 1 — §13

**Files.** new `docs/claude-code-notes.md`; throwaway scripts under
`scripts/spike-claude/`, removed when the notes land.

**Behaviour.** Answer, against a pinned Claude Code version, with exact
settings keys and observed behaviour: skills via symlink; skills via generated
marketplace, and whether the set can differ per harness; suppression of the
workspace's own `.claude/` skills, commands and `CLAUDE.md`; and Spike 4's
`disableAllHooks` precedence question while the harness is set up.

**Acceptance.** `docs/claude-code-notes.md` exists in the format of
`pi-extension-notes.md`, ending in an honest-limits section. Every §10 `?` is
resolved to `native`, `emulated`, or `none`.

**Out of scope.** Writing the adapter.

### 14.5 The Claude Code adapter — §4, §7, §10

**Files.** new `pi/packages/harness-cli/src/adapters/claude.ts`,
`test/adapters/claude.test.ts`.

**Behaviour.** Two findings from 13.4 are binding. Skills are delivered by
**symlink** at `$CLAUDE_CONFIG_DIR/skills/<name>`, never by the plugin
marketplace: plugins install asynchronously, after the first turn's skill
manifest is already frozen, so a session with a fresh config dir — which is
every session — loses the race. And `launch` passes **`--setting-sources user`**
*in addition to* the §7.3 `denyWrite` set, not instead of it.

`render` writes, all under `ctx.agentDir`: a settings file
(`claude-settings.json`, passed with `--settings`; it must not be named
`settings.json`, or `--setting-sources user` loads it a second time and every
tool call is audited twice) carrying `permissions.deny`/`ask` from the canonical vocabulary
via `toolNames`, the `PreToolUse`/`PostToolUse` hooks that append to
`audit.jsonl`, `permissions.additionalDirectories` for the work tree, and the
update pins from §8; `CLAUDE.md` with memories then the tool index; the
skills/commands layout Spike 0 chose; system prompts via
`--append-system-prompt`. `launch` sets `CLAUDE_CONFIG_DIR` to the session
agent dir and the model variables §5.2 chose. `denyWrite` per §7.3. `probe`
per §9.

**Acceptance.** `harness run --claude -p 'list your skills'` names a hydrated
skill, loaded by whichever mechanism Spike 0 chose, with no copy of that skill
under `sessions/<id>/`. `--pi` and `--claude` on the
same harness load the same asset names. A session that writes
`<workspace>/.claude/settings.json` is denied. `audit.jsonl` lines from
`--claude` and `--pi` validate against one schema.

**Out of scope.** Native login (14.6). MCP.

### 14.6 Model policy and `harness auth` — §5, §6

**Files.** `backend/app/domain/org_tree.py`, `backend/app/api/routes_resolve.py`;
new `pi/packages/harness-cli/src/model.ts`, `src/auth.ts`; both adapters;
`doctor.ts`; new `backend/supabase/migrations/0019_model_wire_format.sql`.

**Behaviour.** `model_policy.{source,user_credentials}` as boundary keys with
the §5.1 semantics and `merge_boundaries` tightening. `wire_format` required on
`model-default`; `/v1/resolve` carries it; the planner fails closed against
`Adapter.capabilities.wireFormats`, naming both sides. `materializeManifest`'s
throw is replaced by the §5.1 table, including the refusal sentence for
`none` + `forbidden`. `harness auth <agent> | --list | --logout <agent>` runs
the agent's own flow outside the jail into `~/.harness/agents/<id>/`, per the
adapter's `store`. The `network` enforcer unions provider hosts from
`model_policy`, never from the adapter. `doctor` shows the mode, the source,
whether it is metered, and which hosts the policy implies.

**Acceptance.** An org with `source: none, user_credentials: required` and a
signed-in user starts a session with no key anywhere in the child environment.
The same org with `forbidden` refuses, naming the policy. A `model-default`
with `wire_format: openai-completions` refuses under `--claude` and runs under
`--pi`. `harness auth claude` then `harness run --claude` in a fresh terminal
reuses the login.

**Out of scope.** `apiKeyHelper` (§5.2). Metering native-mode spend — it is
not observable (§6.2).

### 14.7 Extract the CLI from the Pi tree — §8

**Files.** move `pi/packages/harness-cli/` → `cli/`; root `package.json`;
`pi/package.json`; `docs/build-decisions.md`.

**Behaviour.** Mechanical. `cli/` becomes its own package with its own
tsconfig, vitest and biome config, depending on no Pi package. The Pi adapter
locates the vendored `pi/packages/coding-agent/dist/bundle/cli.js` through
`locate()` rather than a relative path from its own `dist`. Root `npm run dev`
and the test scripts follow.

**Acceptance.** `cli/` builds and tests with `pi/node_modules` absent.
`harness run --claude` works in that state. `git subtree pull` on `pi/` touches
nothing under `cli/`.

**Out of scope.** Publishing. Managed installs (`harness install <agent>`).

### 14.8 Amendments to Phases 3 and 4 — §5.2, §7.3

**Files.** `docs/enforcement-architecture.md`, `docs/build-plan.md`,
`docs/enforcement-gaps.md`.

**Behaviour.** Fold into the existing phases rather than re-planning them:
inject mode **replaces** `Authorization` after verifying the session secret
(3.2); `SpawnPlan.filesystem.denyWrite` is unioned from adapters and applied
by the filesystem enforcer (4.x); G11 restated per §8; `allowed_agents`,
`agent_requirements` and `model_policy` added to the boundary key list.

**Acceptance.** The three documents no longer contradict this one. §1's
amendment table has a corresponding edit in each row's target.

**Out of scope.** Everything the proxy and sandbox phases already own.

### 14.9 The subtraction pass — §11

**Files.** `web/app/admin.tsx`; `backend/app/domain/org_tree.py`;
`pi/packages/harness-cli/src/{core.ts,doctor.ts}`; new
`backend/supabase/migrations/0020_drop_unenforceable_policy.sql`;
`docs/prd.md`, `docs/enforcement-philosophy.md`.

**Behaviour.** Take a verdict on every row of §11.3 and apply it. Each removed
control leaves `merge_boundaries`, the console, and the manifest in the same
change, and the migration strips the key from existing
`org_unit_boundaries.policy` rows — a dead key left in the data is a control
that comes back the next time somebody greps for it. `approvals.deploy` splits
into the control-plane gate and the agent-side confirmation, under two names.
Every surviving control carries its verdict — enforced, advisory, or enforced
only in a named model mode — in `merge_boundaries`' output, so the console
renders it from the same source `doctor` reads rather than a second hardcoded
list. Advisory controls render visibly apart from enforced ones. PRD claims
that depended on a removed control are struck in the same commit.

**Acceptance.** Every control in the console shows its verdict without
hovering. `harness doctor` and the console agree field for field, because both
read `merge_boundaries`. A boundary row for a removed key is gone from the
database, not just hidden. No PRD sentence promises a control that no longer
exists.

**Out of scope.** Building any enforcement — this task only removes, splits,
and labels. Deciding the `budget.monthly_usd_cap` verdict is part of the task;
implementing a pricing table, if that is the verdict, is not.

### 14.10 Preferences — §12

**Files.** `web/app/admin.tsx`; `backend/app/domain/org_tree.py`; new
`backend/supabase/migrations/0021_preferences.sql`;
`backend/app/api/routes_resolve.py`; `pi/packages/harness-cli/src/index.ts`,
`src/doctor.ts`.

**Behaviour.** `prescribed: bool` on `load_policy` becomes
`mode: "suggested" | "absolute"`, migrated in place, and the same shape is
added for `model.default`, `model.allowlist`, `agent.default` and
`agent.allowlist`. `merge_boundaries` resolves each by §12.1 — an absolute
field wins from the widest level that set one and cannot be widened below;
a suggested field is nearest-wins. `validate_tightening` extends to the new
absolute fields. The manifest carries the resolved values; `run` uses
`agent.default` in §2's resolution order and refuses an agent outside
`agent.allowlist`. The console gains a Preferences panel with a
suggested/absolute control per field, and **does not offer `absolute` for
`model.default` or `agent.default`** (§12.3) — it explains at that point that
the allowlist is what makes a default stick.

**Acceptance.** A team setting an absolute model allowlist cannot have it
widened by a user below, and `validate_tightening` says so by name. A
suggested default set at the org is overridden by a user's own and the console
shows both. `model.default` has no absolute control anywhere in the UI.
`harness run` with no agent word picks `agent.default`. `doctor` shows each
preference, its mode, the level that set it, and its §12.3 verdict.

**Also in 14.6.** `endpoints` per wire format on the connection (§12.6), and
an ancestor walk in `GET /v1/org-units/{id}/api-keys` so a team can select a
key its org holds.

**Out of scope.** Proxy-side enforcement of `model.allowlist`, which is Phase
3 and needs the proxy to exist. Calling OpenRouter's provisioning API — §12.4
is guidance in the console, not an integration.

