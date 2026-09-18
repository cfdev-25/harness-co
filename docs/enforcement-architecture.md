# Enforcement Architecture

How the Harness wraps an agent. One process you already have, one proxy, one
plan, one way out — and a renderer per agent so the same team infrastructure
lands in Pi, Claude Code, or whatever comes next.

Reasoning: [`enforcement-philosophy.md`](enforcement-philosophy.md).
Data flow: [`asset-sync.md`](asset-sync.md).
Current defects: [`enforcement-gaps.md`](enforcement-gaps.md).
Tasks: [`build-plan.md`](build-plan.md).

## 0. The simplicity rule

> One document in. One plan out. One way out.

The supervisor reads one thing — the resolved manifest. It produces one thing —
a spawn plan. The jail has one exit — the proxy. Every proposed addition
answers one question: *does this create a second way out?* If yes, it is a
hole, not a feature.

## 1. `harness run` is the supervisor

No new process. `harness run` already resolves, materialises, spawns, and
waits. It stops waiting passively and becomes the only thing that holds
anything valuable.

```
harness run  (the supervisor)                          OUTSIDE THE JAIL
│
│  holds:  the user's credential, the real API keys, the assets git dir
│  runs:   the proxy — the jail's only exit
│  does:   hydrate, render, probe, heartbeat, audit forwarding, terminate
│
└── sandbox  (new netns on Linux / Seatbelt on macOS)  INSIDE
      the agent + everything it spawns
      holds:  nothing. no token, no key, no inherited environment.
      exit:   HTTP(S) to the proxy. That is all.
```

## 2. Boot

Every phase completes **before the agent process exists**. Any failure aborts.
No partial start, no degraded mode. The user manages no token, ever.

| Phase | What happens |
| --- | --- |
| **Resolve** | Read `~/.config/harness/credentials.json`. `GET /v1/resolve` → manifest. `POST /v1/sessions` → register. The credential is not used again until the next boot. |
| **Hydrate** | Bring the `~/.harness/assets/` work tree up to date per [`asset-sync.md`](asset-sync.md) §4–§5, using git. Never overwrites a user edit. Moves `refs/harness/remote`. |
| **Plan** | Run the enforcers over the manifest → one `SpawnPlan`. Pure. Fail closed on anything unsatisfiable or unknown. |
| **Prepare** | Start the proxy. Create `sessions/<id>/`. Call the adapter: point the agent at the canonical directories, generate the instructions file and provider config. Build the child environment. |
| **Probe** | Run a throwaway process under the exact profile the agent will get. Assert: a denied host fails, a denied path fails, an out-of-geometry write fails. Any failure aborts. |
| **Spawn** | Apply the profile. `exec` the agent via `adapter.launch()`. |
| **Supervise** | On an interval: child alive? session valid? manifest TTL unexpired? Tail `audit.jsonl` and forward. Heartbeat. Any check fails → terminate. |

A policy change during a session ends the session. The next `harness run`
receives the new policy at Resolve. There is no state in which a boundary is
half-applied.

### The child environment

A fixed core the adapter may **add to** but never remove from or override:

```
HOME                           copied verbatim — ~/.harness paths must resolve
PATH                           filtered to system directories
TERM LANG TZ                   copied if present
HARNESS_SESSION_ID             opaque
HARNESS_SESSION_DIR            ~/.harness/sessions/<id>
HTTP_PROXY / HTTPS_PROXY       http://:<session-secret>@127.0.0.1:<port>
NO_PROXY                       (empty)
```

Adapter additions are agent-specific state pointers and opt-outs — for Pi,
`PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `PI_TELEMETRY=0`.

Absent on purpose: the user's credential, any control-plane URL or token, any
provider key, `HARNESS_REDACTIONS`, and every variable inherited from the
parent shell.

The proxy secret rides in the `HTTP_PROXY` URL as standard proxy
authentication. On macOS loopback is shared with every process on the machine
and a credential-attaching proxy must not answer to strangers; inside a Linux
network namespace loopback is private and the secret is belt-and-braces.

### Why the agent holds no token

The extension used to call the control plane twice: audit and heartbeat.
Neither needs to originate inside the jail. Heartbeat is the supervisor's — it
is the parent process. Audit goes to `sessions/<id>/audit.jsonl`; the
supervisor tails and forwards. The events were already attested telemetry; a
file changes nothing about their trust level and removes the last credential
from the jail. The control plane is not an allowed destination at all.

### The extension is optional

`pi/packages/harness` provides plain-sentence notifications, an advisory tool
allowlist, and local audit. All UX. **The boundary holds with
`--no-extensions`.** If any enforcement ever depends on the extension having
loaded, that is a bug.

## 3. The proxy

One process, ours. The runtime is told its port (`network.httpProxyPort`) and
starts no HTTP proxy of its own. It would still start its own SOCKS proxy, so
it is also handed a `socksProxyPort` on which we close every connection —
the only SOCKS listener is a refuse-all one. Two modes; every request is in
exactly one:

| Mode | Trigger | Behaviour |
| --- | --- | --- |
| **Tunnel** | `CONNECT host:443` | Host in allowlist → open a TCP tunnel. Never inspect, never inject. Port 443 only. |
| **Inject** | Plaintext `GET/POST/… /connectors/<name>/<path>` | Rewrite to the connector's upstream, attach its credential, forward over TLS we originate. Refuse if `<name>` has no rule. |

The agent's provider config points at `/connectors/model-default/`. It is
issued no key. Every other connector works with no agent configuration at all:
`git`, `curl`, a Python script — anything honouring `HTTP_PROXY` — reaches an
allowlisted host through the tunnel, and a `/connectors/…` URL gets a
credential attached.

Both modes: require the session secret via `Proxy-Authorization`; resolve DNS
proxy-side; refuse IP-literal targets; log every request as the authoritative
record. Refuse `CONNECT` to any port but 443. No SOCKS, no raw TCP in v1.

Inject only: strip inbound `Authorization`, `Cookie`, `X-HTTP-Method-Override`;
refuse absolute-form targets; refuse when the key version is `retired` or the
session is closed, re-checked on the supervise interval.

## 4. The plan and the geometry

```ts
interface SpawnPlan {
  hosts: string[];                       // tunnel allowlist, :443 only
  connectors: Record<string, { upstream: string; keyRef: string; header: string }>;
  filesystem: { allowWrite: string[]; denyRead: string[] };
  env: Record<string, string>;           // core + adapter additions
}
```

Request-shape capabilities are a v2 field on `connectors[name]`. The three
runtime keys `allowLocalBinding`, `allowUnixSockets`, `allowAllUnixSockets`
are pinned closed and never appear in the plan. Each is a second way out.

### Write geometry (`allowWrite`)

```
<workspace>                              the repo the user is working in
~/.harness/assets                        canonical working copies
~/.harness/sessions/<id>/agent           agent state
~/.harness/sessions/<id>/audit.jsonl     the audit spool — pre-created empty
                                         (0600) by the supervisor; the jail
                                         may append, not create
<private tmp>
```

Not writable, deliberately: `~/.harness/assets.git` (the git directory —
refs, objects, config; an agent that could write it could forge the base that
asset-sync §0 depends on, or plant a hook the supervisor would run outside the
jail) and `sessions/<id>/policy.json`.

### Mandatory deny-read

Reads are allow-by-default in the runtime, so this is an obligation:

```
~/.config/harness                the user's credential
~/.ssh  ~/.aws  ~/.gnupg  ~/.kube  ~/.docker
~/.config/gh  ~/.npmrc  ~/.netrc  ~/.git-credentials
login keychains
```

## 5. Enforcers

An enforcer turns part of the manifest into part of the plan. Adding a control
is adding one to the list.

```ts
interface Enforcer {
  readonly name: string;
  plan(manifest: Manifest, plan: SpawnPlan): SpawnPlan;          // pure; throw = abort boot
  probe?(plan: SpawnPlan, run: ProbeRunner): Promise<void>;      // throw = abort boot
}
const ENFORCERS = [network, credentials, filesystem, environment];
```

`plan` composes by tightening only — allowlists intersect, denylists union —
the same monotonic rule `merge_boundaries` applies down the org tree.

| v1 enforcer | Reads | Writes |
| --- | --- | --- |
| `network` | `boundary.egress_allowlist` | `plan.hosts` |
| `credentials` | connections with a `key_ref`, the model | `plan.connectors` |
| `filesystem` | workspace path, `HARNESS_HOME`, session id | `plan.filesystem` |
| `environment` | adapter's `launch().env` | `plan.env` |

Future: request shapes, budget, provider downscoping, remote gateway (a
different proxy target — nothing else moves), approval. There is no
`reconcile`; a changed policy ends the session.

## 6. Adapters

The server stores team infrastructure in no agent's language. `backend/app/`
contains zero references to Pi. An **adapter** is the renderer that turns the
neutral manifest into one agent's expected layout, and knows how to launch it.
Everything in §1–§5 is agent-agnostic; only this section is per-agent.

### The integration contract

What an agent must support to be wrapped. Six items, all about rendering. **The
boundary asks nothing of the agent.**

| # | Requirement | Why |
| --- | --- | --- |
| 1 | State-directory override | isolate its config and transcripts per session |
| 2 | Model endpoint override (base URL) | credential non-possession |
| 3 | Configurable skill directory, or a documented one; a documented instructions file | so the agent can be pointed at the canonical copy, or we generate into a known place |
| 4 | Invokes tools via shell | v1 tools are executables (§7) |
| 5 | Pinnable version; auto-update can be disabled | supply chain |
| 6 | *Optional:* hook or extension API | UX only — tool-call notices, confirmations |

### Integration tiers, cheapest first

| Tier | When | Example |
| --- | --- | --- |
| **Config-only** | the agent satisfies the contract via env, config, or hooks | Claude Code |
| **Bridge** | one gap, closed by a small plugin we ship | Pi, if MCP is ever required (v2) |
| **Managed install** | we pin a version, disable updates, write config: `harness install <agent>` | every agent, cheaply |
| **Fork** | the agent needs source changes | last resort; nothing in this design requires it |

### The interface

```ts
type AssetKind = "skill" | "memory" | "tool" | "connection";

interface Adapter {
  readonly id: string;                                    // "pi"; others are v2

  /** Canonical tool name → this agent's name, for the advisory allowlist.
      A missing key means the agent has no such tool. */
  readonly toolNames: Record<string, string>;

  /** Write generated files only: the agent's settings pointing its skill
      discovery at ctx.assetsRoot + "/skill"; the instructions file (memories +
      tool index); provider config pointing at ctx.proxyUrl +
      "/connectors/model-default/". Nothing is linked or copied — the agent
      reads the canonical work tree directly. Generated files are read-only to
      the user. Pure file I/O. */
  render(ctx: RenderContext): Promise<void>;

  /** Command and env additions. May add keys; may not remove or override core. */
  launch(ctx: RenderContext): { argv: string[]; env: Record<string, string> };
}

interface RenderContext {
  manifest: Manifest;
  assetsRoot: string;      // ~/.harness/assets
  sessionDir: string;      // ~/.harness/sessions/<id>
  agentDir: string;        // sessionDir/agent
  proxyUrl: string;        // http://:secret@127.0.0.1:port
  tools: Array<{ name: string; description: string; run: string }>;  // absolute run paths
}
```

| Manifest | Pi adapter (v1) | Claude Code adapter (v2, for illustration) |
| --- | --- | --- |
| skills | `settings.json` `skills: ["~/.harness/assets/skill"]` — Pi discovers them there | its equivalent setting, or a generated pointer |
| memories | generate `AGENTS.md` | generate `CLAUDE.md` |
| tools | tool index appended to `AGENTS.md`, absolute paths | tool index appended to `CLAUDE.md` |
| model | `models.json` `baseUrl` → proxy | base-URL env var → proxy |
| state dir | `PI_CODING_AGENT_DIR` | its config-dir variable |

Push has no adapter half: the agent reads the canonical work tree, the user
edits the canonical work tree, and `harness push` reads the canonical work
tree. There is one copy of every asset on the machine. Agent knowledge stays
in the CLI, not the server — agent formats change when the *agent* ships, and
the adapter version moves with the CLI version.

**Policy hook.** `boundary.allowed_agents: string[]` (default: all known). The
supervisor refuses to launch an adapter not in the list. Permission is
server-side; formatting is client-side.

## 7. Tools

A tool is an asset of kind `tool`: a directory containing an executable named
`run`, optional `TOOL.md` with frontmatter (`name`, `description`), and
whatever else it needs — including its dependencies, vendored. The jail has no
route to a package index, and v1 never installs anything.

Tools run **inside the jail**, at agent privilege, invoked via the agent's
shell. That is not a restriction on tool authors; it is the team's policy. A
tool that calls `https://api.stripe.com/…` goes through the proxy like any
other request and has the credential attached — no key in the script, no
configuration. What a tool cannot do is exactly what the agent cannot do, and
the team's admin controls that dial in the console.

Tools, like everything else, live only in the canonical work tree. The
adapter appends a **tool index** to the generated instructions file, and each
entry carries the tool's absolute path:

```
## Team tools
- `deploy` — Deploy the current branch to staging. Run: /Users/me/.harness/assets/tool/deploy/run
```

That is the entire v1 tool mechanism. It satisfies "people can write their own
tools" with a shell script and a paragraph.

**Reserved for v2, not built:** `provenance.trusted_by` on a version, set by an
admin via a `/trust` endpoint mirroring `/approve`, marking a tool to run
*outside* the jail as a capability the agent can invoke but not modify. Trust
is per version and resets on every new version. Also v2: an MCP interchange
layer if an agent requires it (a bridge for Pi via `registerTool()`).

## 8. Build order

See [`build-plan.md`](build-plan.md). In one line: close the two live holes,
then asset-sync, then adapters, then the proxy, then the sandbox, then probes
— with the layman web docs written in parallel from phase 1 onward.
