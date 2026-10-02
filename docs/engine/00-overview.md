# Engine Plan — 00 · Overview, contracts, and the rules of the plan

The **engine** is everything that runs between a person typing `harness run`
and a harness provider (Pi, Claude Code) executing with exactly the assets,
credentials and reach the organization decided — and the server pieces that
make that decision enforceable. This folder is its build plan. It is written
for engineers who did not design it: every document names its invariants,
its contracts, its algorithms as numbered steps, its file paths, its error
strings, its tests, and its definition of done.

**Authority.** This plan implements [`../prd-v2.md`](../prd-v2.md) Part I.
Where an older document disagrees with this folder, this folder wins — §9
lists each one and what supersedes it. Where this folder disagrees with
`prd-v2.md`, `prd-v2.md` wins and this folder has a bug.

**How to read.** Read this document fully. Then read the document for the
part you are building, plus `10-code-standards.md`. `09-sequencing.md` says
what order things land in and what "done" means for each milestone.

| Doc | Owns |
| --- | --- |
| **00** overview (this) | invariants, topology, all shared contracts, constraints, decisions, budgets |
| **01** repository | the definition plane on disk: branch layout, the sidecar id, policy files, composition, sparse materialisation |
| **02** definitions service | the git server: smart-HTTP, per-ref authorisation, pre-receive validation, the derived index, migration off Postgres |
| **03** preflight | compose → choose → plan → probe → report; evidence; `resolved from`; drift by rehydrate |
| **04** broker | resolvers, security groups, sources allowed, session-scoped mints, enforcement at mint, revocation |
| **05** proxy | the fence: tunnel and inject modes, derived reach, deny list, outside endpoints, the authoritative endpoint log |
| **06** sandbox | process confinement per OS, geometry, deny sets, probes, fail closed |
| **07** adapters | the provider contract, render, rehydrate, locate/pin, Pi and Claude Code specifics |
| **08** supervisor and CLI | the process that owns the session: environment, spawn, supervise loop, exit; every command |
| **09** sequencing | milestones, dependencies, cut lines, definition of done |
| **10** code standards | how the code is written so that it stays small |
| **11** vault integrations | each key manager against its documentation: auth without a stored secret, list/read, probe, attribution, rotation signal, customer checklist; and `api` as an OpenID issuer |

---

## 1. Seven invariants

Every design choice below descends from one of these. If a proposed change
cannot be traced to one, it does not belong in the engine.

| # | Invariant | Consequence for the engine |
| --- | --- | --- |
| I1 | **Definitions are git; credentials are not.** | The engine fetches definitions with `git`; it never fetches a secret value from anywhere but the broker, and never writes one to disk. |
| I2 | **The effective harness is composed from a chain of refs by precedence. Nothing merges.** | One `compose()` function, one implementation, used by the CLI and by the server's indexer. Hydration consumes its output as `incoming`. |
| I3 | **The agent holds nothing.** No token, no key, no inherited environment, no route but the proxy. | Credentials live in the supervisor and are attached by the proxy. The child environment is built from an allowlist. The jail's only exit is the proxy. |
| I4 | **Enforcement is the broker and the fence. Preflight is a detector.** | Everything preflight decides, the broker re-decides at mint and the proxy re-decides per request. A preflight bypass gains nothing. |
| I5 | **Fail closed, with no flag, fallback or degraded mode.** | A sandbox that cannot initialise, a probe that unexpectedly succeeds, a vault that does not resolve a vault-only group: the session does not start. There is no `--unsafe`. |
| I6 | **Every fact is declared, observed or derived, and says which.** | Every slot carries an evidence level; every credential slot carries `resolved from`; a console cell never rounds up. |
| I7 | **A difference between providers is declared, not discovered.** | An adapter declares what it supports; unsupported concerns are dropped loudly or refuse the boot. Nothing is silently different under Claude Code than under Pi. |

---

## 2. Topology

Three processes we write, one we run, one we vendor.

```
┌─ person's machine ───────────────────────────────────────────────────────┐
│  harness  (CLI = supervisor)                              OUTSIDE JAIL   │
│    compose · hydrate · preflight · proxy · sandbox · spawn · supervise    │
│    holds: login token, session credentials, the assets git dir          │
│    └── jail ──────────────────────────────────────────────────────────┐  │
│        provider binary (pi | claude) + everything it spawns           │  │
│        holds: nothing.  exit: HTTP(S) → proxy.                        │  │
│        └───────────────────────────────────────────────────────────────┘  │
└───────────┬───────────────────────────────┬──────────────────────────────┘
            │ git smart-HTTP                │ HTTPS
            ▼                               ▼
  definitions  (Node)                 api  (FastAPI)
   bare repos, one per org             sessions · broker · resolvers
   per-ref auth · pre-receive          console API · logs · people
   post-receive → index                reads the index, never git
            │                               │
            └──────────► Postgres ◄─────────┘
                index (derived, rebuildable) · records (authoritative)
```

| Process | Language | Deps | Owns |
| --- | --- | --- | --- |
| `harness` CLI | TypeScript, Node ≥ 22 | **zero runtime dependencies** (`node:*` only; the proxy is `node:http` + `node:tls`) | everything on the person's machine |
| `definitions` | TypeScript, Node | zero runtime dependencies; shells out to `git` | the repos, authorisation, validation, the index |
| `api` | Python, FastAPI | as today | records, sessions, the broker and its resolvers, the console API |
| Postgres | — | — | the index (derived) and records (authoritative) |
| Pi | vendored at a pinned commit in `pi/` | — | one provider binary |

**Packages.** The engine leaves `pi/packages/` (v3 A7, never done):

```
engine/
  compose/      @harness/compose   — compose(), covers() (the Scoping primitive), types in §4, no I/O. Used by cli and definitions; covers() is conformance-tested against the Python copy in api (04).
                @harness/compose/contracts — a types-only subpath export of the same package (`compose/src/contracts.ts`, §4 transcribed, no runtime), so the console imports the engine's types without importing git-facing code (console 00 D3). "@harness/contracts" in prose means this subpath.
  cli/          @harness/cli       — the supervisor and every command.
  definitions/  @harness/definitions
pi/packages/harness/               — the Pi extension stays beside Pi; it is UX only (I3, I4).
backend/                           — api, as today.
```

One rule for what goes where: **if it needs `git` or the person's disk, it
is the CLI; if it needs a repo on the server, it is `definitions`; if it
needs a secret value or a Postgres record, it is `api`.**

---

## 3. A session, end to end

The boot sequence. Each phase completes before the next begins; any failure
ends the boot with one message naming the blocker (§4.7). Owner in brackets.

| # | Phase | Does | Doc |
| --- | --- | --- | --- |
| 1 | **Fetch** [CLI] | `git fetch` from `definitions`. The server advertises exactly the refs in the person's chain (org, ancestor teams, own user ref). | 01, 02 |
| 2 | **Compose** [CLI] | `compose(chain)` → `Composed`: effective assets by id, conflicts, effective policy, groups and grants, harnesses. Pure. | 01 |
| 3 | **Hydrate** [CLI] | `asset-sync.md` §4 unchanged: `incoming` := the composed tree; sparse materialisation to the subscription (01 §8); never overwrite a dirty path. | 01, 08 |
| 4 | **Choose** [CLI] | provider (from argv, checked against approval, **located** on this machine at or above its pin — 07), harness (selection file or flag), model (routing precedence), groups covering this harness. | 03, 07 |
| 5 | **Mint** [CLI → api] | `POST /v1/sessions` with the aliases the needs walk found. The broker re-derives grants, checks approval and sources, mints per slot, returns credentials **to the supervisor** with `resolvedFrom` and evidence. Refuses → boot ends. | 04 |
| 6 | **Plan** [CLI] | enforcers turn `Composed` + choices + the minted set into one `SpawnPlan`: hosts, deny, connectors, filesystem geometry, env, argv. Pure; tighten-only. | 03, 05, 06 |
| 7 | **Render** [CLI] | adapter writes generated files under `agentDir`; symlinks into the work tree; nothing copied; `rendered.json` recorded. | 07 |
| 8 | **Fence** [CLI] | proxy starts on loopback (macOS) or a bound-in socket (Linux) with the session secret; connectors loaded. Started here so the probes can reach it. | 05 |
| 9 | **Probe** [CLI] | local probes: ambient logins (`gh auth status`…), rendered config rehydrates to the plan (drift), sandbox self-test under the exact profile, adapter probe. | 03, 06, 07 |
| 10 | **Report** [CLI] | `PreflightReport`: passing or failing with named blockers. Written to the session dir before any spawn. Failing → proxy closed, boot ends. | 03 |
| 11 | **Spawn** [CLI] | sandbox profile applied; `exec` the provider with the plan's argv and env. | 06, 08 |
| 12 | **Supervise** [CLI] | heartbeat; forward the attested spool; re-check session validity; a revoked session or retired credential → proxy refuses injection, child terminated. | 08 |
| 13 | **Exit** [CLI] | **exit review**: diff the work tree against the tree preflight recorded at boot, list the changed assets, offer *push all · none · pick*; then close the session, record the endpoint log's tally, stop the proxy. (Exit *reconciliation* — growing needs from observed use — is Later, `prd-v2.md` §22.) | 08 |

Phases 1–3 are also `harness pull`. Phases 1–10 with no spawn are
`harness preflight` (`doctor` is an alias for one release — 08 D101): the
proxy is started for the probes and closed again. There is one code path;
the commands stop at different rows.

---

## 4. Contracts

**Every cross-document type is defined here and only here.** A document
refers to these by name. A document that needs a type not in this section
must add it here first, in the same change, so a reader never finds two
definitions. Field comments are normative.

### 4.1 Chain and nodes

```ts
type NodeKind = "org" | "team" | "user";

interface ChainNode {
  kind: NodeKind;
  /** Dotted path, root first: "acme", "acme.marketing", "acme.marketing.interns". */
  path: string;
  /** The ref: refs/heads/org, refs/heads/teams/<path>, refs/heads/users/<user-id>. */
  ref: string;
  /** Commit the ref pointed at when fetched. */
  commit: string;
}

/** Root first, narrowest last. The person's own user node is always last. */
type Chain = ChainNode[];
```

### 4.2 Assets and the sidecar

```ts
/** `kind` is data. The allowed set is `policy/kinds.json` on the org branch (01 §4.2). */
type AssetKind = string;

/** The sidecar, `asset.json`, one per asset directory (01 §5). */
interface Sidecar {
  id: string;            // uuid; the durable identity (prd-v2 §4.1)
  kind: AssetKind;
  /** Optional declarations. Absent means "none". */
  needs?: Need[];
  /** A wire format this asset requires from the model, if any (prd-v2 §9.3). */
  format?: WireFormat;
  /** Shown on the organization assets row; written by `PATCH /v1/assets/{id}` (01 §5, WS3a). */
  description?: string;
}

type Need =
  | { kind: "credential"; alias: string }         // resolves through a security group entry
  | { kind: "asset"; id: string }                 // another asset must be subscribed
  | { kind: "environment"; name: string }         // the environment a tool runs in, by name (W5-D15); inert at compose
  | { kind: "login"; tool: "gh" | "aws" | "gcloud" | "az" | "supabase" | string }; // an ambient login

interface ComposedAsset {
  id: string;
  kind: AssetKind;
  /** Directory name under <kind>/. The path is not identity; it may differ between branches. */
  name: string;
  /** The node whose copy won. */
  from: ChainNode;
  /** git tree id of the asset directory on that node. */
  tree: string;
  sidecar: Sidecar;
  /** Present when a wider node also holds this id: the copy this one overrides. */
  shadows?: { from: ChainNode; tree: string };
}

type Conflict =
  | { kind: "same-path-different-id"; path: string; a: { id: string; from: ChainNode }; b: { id: string; from: ChainNode } }
  | { kind: "duplicate-id-on-one-branch"; id: string; from: ChainNode; paths: string[] }
  | { kind: "unknown-kind"; assetKind: string; path: string; from: ChainNode }
  | { kind: "malformed"; path: string; from: ChainNode; why: string }                 // a policy, sidecar or harness file that fails to parse or validate
  | { kind: "invalid-grant"; grant: string; from: ChainNode; clause: "none" | "a" | "b" | "c" | "d" | "e"; why: string }   // which of 01 §6 step 8/9's clauses failed ("none" = step 8: no narrowedFrom at all), so 02 can name the remedy
  | { kind: "reach-widened"; at: string; from: ChainNode; why: string }      // a node, or a `harness:<id>`, whose reach gives more than it inherits (01 D131); the parent stands
  | { kind: "reach-grant-retired"; grant: string; from: ChainNode };         // a branch still carrying `Grant.reach` (01 D132); it grants nothing
```

### 4.3 Policy objects

```ts
/** The one scoping primitive (prd-v2 §13). */
interface Scope {
  /** Team paths, or every team. A user path is never a scope target. */
  teams: string[] | "all";
  /** Narrow to these harness ids. Absent = every harness the teams own. */
  harnesses?: string[];
}

interface SecurityGroup {
  name: string;                                   // unique on the org branch
  /** An alias is a secret *used at an upstream, attached one way*. The proxy needs all three (05). */
  entries: Array<{
    alias: string;
    secret: SecretRef;
    upstream: string;                             // https://api.stripe.com — origin only, no path
    attach: { header: string; prefix: string };   // { "Authorization", "Bearer " } · { "x-api-key", "" }
  }>;
  /** How far down the credential chain this group permits (prd-v2 §6.5). */
  sources: "vault" | "vault-or-local";
  /** Provider-specific mint parameters, opaque to the CLI (04 §3). */
  mint?: Record<string, unknown>;
}

interface SecretRef { vault: string; ref: string }  // vault = the id of a key vault `api` has connected (04 §7); not validated at push, refused at mint if unknown

/** A grant is a scoped instance of a security group. Differently scoped = a different grant.
    01 D132 retired `reach: "outside-endpoints"`: reach is `policy/reach.json`, not a grant. */
interface Grant {
  id: string;
  scope: Scope;
  group?: string;                                  // a SecurityGroup name
  /** Set on a grant a team admin narrowed: the grant it came from, and the aliases kept. */
  narrowedFrom?: { grant: string; aliases: string[] };
  by: string;                                      // author (the commit's author is the record; this is a copy for readers)
}

interface Boundary {
  id: string;
  scope: Scope;
  kind: "endpoint" | "command" | "filesystem" | "capability";
  value: string;                                   // host[:port] pattern · resolved command pattern · path glob · capability name
  holds: "enforced" | "intercepted";               // prd-v2 §7
  reason: string;
}

/** How far a session may connect, and what a model request may ask the provider to do (01 D131, 05 §6a).
    `policy/reach.json` on the org node and on team nodes, and an optional `reach` on a `HarnessDef`.
    `allow`: `hosts` is the allow-list. `on`: `hosts` is the deny-list. `off`: `hosts` is ignored.
    Absent everywhere is `off`. A host is an exact name or `*.suffix` (subdomains, not the apex). */
interface Reach { mode: "off" | "allow" | "on"; hosts: string[] }

/** The composed reach, with the last node that narrowed it: a node path, or `harness:<id>`.
    `setBy` is the node a person must ask, and the node the console's **Allow** action writes to. */
interface EffectiveReach extends Reach { setBy: string }

/** The shapes a model endpoint speaks. Two are implemented at M3; the rest are known values so an adapter's
    `speaks` and a provider's `endpoints` can name them the day they are needed. Matching is by intersection. */
type WireFormat =
  | "anthropic-messages" | "openai-completions"                      // implemented
  | "openai-responses" | "google-generative" | "bedrock-converse";   // known, Later

/** Presets for OpenRouter, Anthropic and OpenAI ship as data — `engine/compose/presets/model-providers.json`, each
    row a `ModelProvider` without `credential` plus the `attach: { header, prefix }` its key is sent with — and are
    seeded, with `presets/harness-providers.json`, into every new organization's org branch (D30h). The presets are the
    only copy: the exporter, `api`'s seed and the CLI read the files; none holds a list of its own. */
interface ModelProvider {
  id: string;
  endpoints: Partial<Record<WireFormat, string>>; // base URL per wire format
  models: string[];
  /** The credential for this provider is an entry alias, resolved through covering grants with the same
      precedence as any other alias (03 §5.4). The entry's `upstream` is ignored for the model: the endpoint
      comes from `endpoints[wireFormat]`. Optional on the wire because a preset is a row before anyone has
      connected a key — but a provider whose alias no security group entry holds *needs a key* (W6-D6,
      04 D152): it is refused a session, left out of `canRun`, and cannot be made a default or an approval.
      The keyless gateway row this field once allowed is retired. */
  credential?: { alias: string };
}

interface HarnessProvider {
  id: "pi" | "claude" | string;
  /** W6-D3/D148. What the runtime calls itself — *Pi*, *Claude Code* — for every screen and
      every launch button. Optional, because an organization seeded before this change holds
      rows without one and a reader falls back to the id; required of every row in
      `engine/compose/presets/harness-providers.json`, which is where ours come from. */
  name?: string;
  approval: "approved" | "beta" | "not-approved";
  scope: Scope;                                    // approval scope: who may run it
  /** Vendored/forked: a repo + commit. Located: a binary and a version floor. Exactly one. */
  pin: { repo: string; commit: string } | { binary: string; minVersion: string };
  speaks: WireFormat[];
  reason?: string;                                 // for not-approved / beta
}

interface Routing {
  /** prd-v2 §9.2. Keys of `teams` are team paths **or the organization's path**; the nearest node on the chain
      that has a key wins, so an entry under the org path is the default for everyone and a team's entry overrides
      it (D30i). A personal account's one key is under its org path. Other keys are harness ids or provider ids. */
  defaultFor: { teams: Record<string, string>; harnesses: Record<string, string>; providers: Record<string, string> };
  approvedFor: { teams: Record<string, string[]>; harnesses: Record<string, string[]>; providers: Record<string, string[]> };
}

/** harnesses.md §6: 16 rows of 16 characters indexing a palette; `.` is transparent. */
interface Icon { palette: string[]; rows: string[] }

interface HarnessDef {
  id: string;
  name: string;
  description: string;
  icon: Icon;                                      // 16×16, harnesses.md §6, unchanged
  /** Asset ids. The harness names the thing; the chain picks the copy (01 §5). */
  assets: string[];
  /** A last narrowing step after the chain's (01 D131). Widening is a `reach-widened` conflict. */
  reach?: Reach;
}
```

### 4.4 The composed result

```ts
interface EffectivePolicy {
  boundaries: Boundary[];          // union down the chain, each tagged with the node that set it (by id prefix)
  grants: Grant[];                 // org grants + each node's narrowed grants, validated (01 §6)
  groups: Record<string, SecurityGroup>;
  modelProviders: Record<string, ModelProvider>;
  harnessProviders: Record<string, HarnessProvider>;
  routing: Routing;
  kinds: AssetKind[];
  /** W5-D10. Org assets every session loads whatever the harness says, and that no harness may
      drop: the `required` list of org-only `policy/always-loaded.json` (a bare array there is read
      as this list). */
  required: string[];
  /** W5-D10. Org assets a **new** harness starts with — copied into its `assets` at creation
      (`harness new`, `POST /v1/harnesses`) and ordinary entries from then on. Never forced into
      a session. */
  recommended: string[];
  /** The chain's reach, narrowed org → team → sub-team (01 D131). The harness's own step is
      `effectiveReach(policy.reach, harness)`, which only a session knows; compose reports a
      widening harness as a conflict but cannot hold one value for every harness at once. */
  reach: EffectiveReach;
}

interface Composed {
  chain: Chain;
  assets: ComposedAsset[];         // one per id, the winning copy
  conflicts: Conflict[];           // non-empty ⇒ preflight fails with compose.* blockers
  policy: EffectivePolicy;
  harnesses: HarnessDef[];         // every harness on the chain
  /** W5-D12. Harness id → every node path that holds a definition for it, root first; the last is
      the node whose copy won (01 §6 step 10's D3 rule). The boot screen's level line — *your version
      of Marketing's* — is this and nothing else knows it. */
  harnessFrom: Record<string, string[]>;
  /** git tree id of the composed working set: <kind>/<name>/… for every asset, plus versions.json. */
  tree: string;
}
```

```ts
/** The only I/O compose() performs, as four git plumbing wrappers. The CLI (01 §7.2) and `definitions`
    (02 §4) each implement it once; compose() is pure given one. An absent directory lists as []. */
interface Reader {
  ls(commit: string, dir: string): Promise<Array<{ name: string; mode: "040000" | "100644" | "100755" | "120000"; oid: string }>>;
  cat(oid: string): Promise<Uint8Array>;
  write(bytes: Uint8Array): Promise<string>;                       // blob oid
  mktree(entries: Array<{ name: string; mode: string; oid: string }>): Promise<string>;  // tree oid
}
```

`compose(chain, reader): Promise<Composed>` is pure given a `Reader` (whose four calls are all asynchronous). It is the one
implementation of PRD primitive *Composition*. It never throws for content
faults: those are `Conflict`s in the result.

```ts
/** PRD primitive *Scoping* (03 §5.1; the Python copy in api is conformance-tested against it). */
function covers(scope: Scope, chain: Chain, harnessId: string | null): boolean;
```

### 4.5 Choices and the plan

```ts
interface Choices {
  provider: HarnessProvider;
  located: Located;                // the binary Choose found for it, at or above the pin (07)
  harness: HarnessDef | null;      // null = no filter (harnesses.md §0 "no harness is not an empty harness")
  /** "team": for every asset whose winning copy is the person's own, load its `shadows` copy instead (08 `--team`). */
  view: "mine" | "team";
  model: { provider: ModelProvider; model: string; wireFormat: WireFormat; endpoint: string };
  /** Grants that cover this harness for this person, after Scope evaluation. */
  grants: Grant[];
  /** No covering grant supplies the model credential and the provider can use its own sign-in (00 D11):
      adapters render native mode; the model slot is `deferred` with `resolvedFrom: local` once probed. */
  native: boolean;
}

interface SpawnPlan {
  /** Credentialed hosts + the model endpoint host, always routable on 443 (05 D133). Never "any":
      everything beyond this list is `reach` (01 D132). */
  hosts: string[];
  /** Always applied, before `hosts` and before reach. From boundaries of kind endpoint. */
  deny: string[];
  /** The session's effective reach: the chain's, narrowed by the harness (01 D131, 05 §6a). */
  reach: EffectiveReach;
  /** alias → how the proxy attaches the credential on /connectors/<alias>/…
      `wireFormat` is set on `model` only, and is what `shapeModelRequest` reads (05 D134). */
  connectors: Record<string, { upstream: string; attach: { header: string; prefix: string }; wireFormat?: WireFormat }>;
  filesystem: {
    allowWrite: string[];          // workspace, assets work tree, session agent dir, spool, private tmp
    denyRead: string[];            // credentials, ~/.ssh …, excluded tool dirs, ambient provider stores
    denyWrite: string[];           // the provider's own settings files inside the workspace (07 §5)
  };
  env: Record<string, string>;     // the core set + adapter additions; adapters may add, never override
  argv: string[];                  // adapter's argv + passthrough; sandbox wrapper prepended at spawn
}

interface Enforcer {
  readonly name: string;
  /** Pure. Tighten only: allowlists intersect, deny lists union. Throw = a Blocker.
      `minted` is what the broker returned (§3 row 5); the network and credentials enforcers derive
      hosts and connectors from it, so Plan runs after Mint. */
  plan(composed: Composed, choices: Choices, minted: MintedCredential[], plan: SpawnPlan): SpawnPlan;
  /** Runs under the exact profile the agent will get. Throw = a Blocker. Unexpected success is a failure. */
  probe?(plan: SpawnPlan, run: ProbeRunner): Promise<void>;
}
```

### 4.6 Credentials, evidence, slots

```ts
type Evidence = "verified" | "harness-reported" | "declared";
type SlotState = "satisfied" | "unsatisfied" | "deferred";

/** Where a credential slot was filled from. The one field that makes a chain reviewable (prd-v2 §6.5). */
type ResolvedFrom =
  | { source: "vault"; vault: string; group: string; grant: string }   // where it came from, then why you were allowed
  | { source: "local"; tool: string }
  | null;

/** Preflight emits a `login` slot for every tool in its probe table, satisfied or not — the console's Account
    screen reads *logins present* from the last posted report, so the positive ones must be there too (console 04 D45). */
interface Slot {
  need: Need;
  state: SlotState;
  evidence: Evidence;
  resolvedFrom: ResolvedFrom;
  /** Set by the broker on a credential slot it chose a grant for but could not fill (deferred):
      the CLI consults a local login only if `via.sources === "vault-or-local"` (04 D60). */
  via?: { grant: string; group: string; sources: SecurityGroup["sources"] };
  blocker?: Blocker;
}

/** What the broker returns to the supervisor for one alias. Never reaches the jail. */
interface MintedCredential {
  alias: string;
  value: string;
  /** minted = created for this session and expires with it; stored = a long-lived value handed out under lease. */
  kind: "minted" | "stored";
  expiresAt: string | null;
  resolvedFrom: Extract<ResolvedFrom, { source: "vault" }>;
  evidence: Evidence;
}
```

### 4.7 Blockers and the report

```ts
interface Blocker {
  /** Namespaced by owning doc: compose.* repo.* definitions.* preflight.* broker.* proxy.* sandbox.* adapter.* cli.* supervise.* */
  code: string;
  /** One sentence, plain words, names the thing. */
  message: string;
  /** What to do. Always present. */
  remedy: string;
  /** A console deep link or a CLI command, when one exists. */
  link?: string;
}

/** One row of the authoritative endpoint log, written by the proxy (05). */
interface EndpointEvent {
  at: string;                      // ISO
  mode: "tunnel" | "inject" | "refused";
  host: string;
  port: number;
  alias?: string;                  // inject only
  method?: string;                 // inject only
  path?: string;                   // inject only, query stripped
  status: number | "no-route" | "denied" | "no-sni" | "sni-mismatch" | "ip-literal" | "bad-secret" | "retired" | "stripped";
  bytesOut: number;
  bytesIn: number;
  /** Why, in one machine-readable word: `port`, `reach.off`, `reach.not-listed`, `reach.denied`,
      `boundary`, or `stripped:<comma-separated names>` (05 D133, D134). */
  reason?: string;
  /** The node whose policy decided it: a node path, a `harness:<id>`, or the boundary's own node.
      The console's **Allow** action writes there (05 D133). */
  setBy?: string;
  /** Inject mode, alias `model` only: token usage read from the response when the wire format exposes it (05 §6).
      Absent in tunnel mode — native sessions are "not metered", never zero (C22). */
  usage?: { input: number; output: number } | null;
}

/** Aggregated per (host, port, alias) for the session record and the console's Endpoints reached.
    `stripped` counts model requests a capability was taken out of; `reasons` is reason → count (05 D134). */
interface EndpointTally { host: string; port: number; alias?: string; count: number; refused: number; stripped: number; reasons: Record<string, number>; firstAt: string; lastAt: string }

interface Drift {
  file: string;
  expected: unknown;
  actual: unknown;
}

interface PreflightReport {
  sessionId: string;
  composed: { commit: Record<string, string>; tree: string; conflicts: Conflict[] };
  /** null when Choose itself refused — the blockers say why (08 §12.3). */
  choices: Choices | null;
  /** The plan, when one was produced, so `harness preflight` can render reach, env and files (03 §5.10). */
  plan: SpawnPlan | null;
  slots: Slot[];
  drift: Drift[];
  passing: boolean;
  blockers: Blocker[];
  /** ISO time; the report is written to <sessionDir>/preflight.json before any spawn. */
  at: string;
}
```

**Error strings.** Every `Blocker.message` is a complete sentence a person
can act on without opening a log; every `remedy` names a command or a screen.
The catalogue lives in each doc's *Failure modes* section; codes are unique
across the engine. **Code style:** lower-case, dot-namespaced by the owning
doc (`compose.` `repo.` 01 · `definitions.` 02 · `preflight.` 03 · `broker.`
04 · `proxy.` 05 · `sandbox.` 06 · `adapter.` 07 · `cli.` `supervise.` 08),
words joined by `_`; a doc raises only its own codes and surfaces others'
verbatim.

### 4.8 Adapter contract

```ts
type Concern =
  | "skill" | "prompt" | "system_prompt" | "memory" | "tool_index"
  | "tool_gating" | "audit" | "state_isolation" | "project_suppression"
  | "model_org" | "model_native";

type Support = "native" | "emulated" | "none";

interface RenderContext {
  composed: Composed;
  choices: Choices;
  plan: SpawnPlan;
  sessionId: string;
  sessionDir: string;              // ~/.harness/sessions/<id>
  agentDir: string;                // <sessionDir>/agent — the only place render may write
  workspace: string;               // the person's cwd; denyWrite() names files under it
  assetsRoot: string;              // ~/.harness/assets — render may symlink into it, never copy from it
  proxyUrl: string;                // http://harness:<secret>@127.0.0.1:<port> — for HTTP_PROXY only. **Provider base URLs use `new URL(proxyUrl).origin`**: a URL carrying userinfo cannot be fetched; the secret travels in a header (05 D70)
}

interface Located { path: string; version: string }

interface Adapter {
  readonly id: string;
  readonly displayName: string;
  readonly speaks: readonly WireFormat[];
  readonly capabilities: Readonly<Record<Concern, Support>>;
  /** Find the binary this adapter is responsible for; refuse below the pin. */
  locate(pin: HarnessProvider["pin"]): Promise<Located>;
  /** Directories inside the workspace the agent must not be able to write (where its own settings live:
      <workspace>/.claude, <workspace>/.pi). Directories, not files, so a new settings file cannot appear beside a denied one (06 D81). */
  denyWrite(ctx: RenderContext): string[];
  /** Provider-side stores an ambient login could come from; always added to denyRead (G13). */
  ambientStores(): string[];
  /** Writes generated files under agentDir only. Returns what it honoured and what it dropped. */
  render(ctx: RenderContext): Promise<RenderReport>;
  /** Reads back what render wrote and returns the IR it encodes, for drift detection. */
  rehydrate(ctx: RenderContext): Promise<Rehydrated>;
  launch(ctx: RenderContext, located: Located): { argv: string[]; env: Record<string, string> };
  /** Read a provider's EXISTING configuration — one a person built before they had us — into assets and a
      harness definition, reporting what could not carry (07 §4a). The inverse of render over foreign files. */
  import(source: { dir: string; workspace?: string }): Promise<Imported>;
  /** After spawn, under the profile: came up at the located version, on the chosen model, with no credential we did not give. */
  probe(ctx: RenderContext, run: ProbeRunner): Promise<void>;
}

interface RenderReport { honoured: Concern[]; dropped: Array<{ concern: Concern; why: string }> }

/** What an import produced. Assets are written to the work tree with fresh sidecars; nothing is pushed
    until the person says so (08 §11.19). `dropped` is the fidelity report — declared, not discovered (I7). */
interface Imported {
  assets: Array<{ kind: AssetKind; name: string; path: string; from: string }>;   // from = the source file
  harness: HarnessDef;
  boundaries: Boundary[];                                                          // e.g. from permissions.deny
  dropped: Array<{ what: string; from: string; why: string }>;                     // hooks, MCP servers, unknown keys
}

/** The subset of the plan an adapter's files encode. Compared field-by-field to the plan. */
interface Rehydrated {
  skills: string[];                // asset ids
  prompts: string[];
  instructions: { system_prompt: string[]; memory: string[] };  // asset ids in order
  model: { endpoint: string; model: string } | null;
  hooks: string[];                 // audit hook commands
  denies: string[];                // permission denies the file carries
  /** path → sha256 of every generated file, recomputed from disk; compared to rendered.json (07 §5). */
  files: Record<string, string>;
}

interface ProbeRunner { (argv: string[], opts?: { timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }> }
```

### 4.9 Resolver contract (broker side, Python)

The same two calls for every vault, the bundled one, and — probe only — the
person's machine. There are no tiers or grades: what a resolver returns says
`minted` or `stored` and the slot carries its evidence; nothing ranks a
customer's vault (prd-v2 §6.2, §16). Written in Python in `api`; the CLI implements only the
`local` probes.

```py
class Probe(TypedDict):
    ready: bool
    evidence: Literal["verified", "harness-reported", "declared"]
    detail: str

class Minted(TypedDict):
    value: str
    kind: Literal["minted", "stored"]
    expires_at: str | None
    evidence: Literal["verified", "harness-reported", "declared"]

class SessionContext(TypedDict):
    person: str          # user id
    session: str         # session id
    org: str
    group: str
    grant: str

class Resolver(Protocol):
    id: str                                   # matches ModelProvider.credential / SecretRef.vault
    def probe(self, ref: str) -> Probe: ...
    def resolve(self, ref: str, session: SessionContext, mint: dict | None) -> Minted: ...
    def revoke(self, minted: Minted) -> None: ...   # no-op for stored
```

### 4.10 Server endpoints the engine uses

| Method | Path | Body → Response | Doc |
| --- | --- | --- | --- |
| `GET` | `/v1/me` | → `{ user: { id, email }, org: { id, path }, definitions: { origin: string }, chain: Chain, role: { level: "member" \| "team-admin" \| "org-admin"; at: string \| null } }` — `definitions.origin` + `org.id` give the clone URL `<origin>/<org>.git`; a ref carries no host. With `?as=<user-id>` (a team admin reading a member's branch, prd-v2 §18): the member's `chain` when `role.at` is on it, else `403`. | 02, 03, 08 |
| git | `https://<definitions>/<org>.git` | smart-HTTP; refs advertised per chain | 02 |
| `POST` | `/v1/sessions` | `{ id, provider, provider_version, harness, model, aliases: string[], commits: Record<ref, commit>, workspace?: string, hostname?: string }` → `{ credentials: MintedCredential[], slots: Slot[], blockers: Blocker[] }` (04 §5.3). `workspace` is the absolute directory the session runs in and `hostname` the machine's name (08 D141): the card offers *open again in …* from them. Both optional, so a CLI one version behind still opens a session; both stored on the row alone and read back by the owner only (console 04 §4). | 04 |
| `POST` | `/v1/sessions/{id}/revoke` | `{ reason }` → `204` — owner, or an admin over the owner's chain | 04, console 04 |
| `GET` | `/v1/sessions/{id}` | → `{ status: "active" \| "revoked" \| "closed", retired: string[] }` | 04, 08 |
| `PATCH` | `/v1/sessions/{id}` | `{ last_active_at }` · `{ preflight: PreflightReport }` (once, on the first supervise tick — it contains no values; stored in `harness_sessions.preflight jsonb`, console D7 / 03 §7) · `{ status: "closed", endpoints: EndpointTally[] }` | 08 |
| `POST` | `/v1/audit/batch` | attested events, as today | 08 |
| `POST` | `/v1/requests` | `{ title, reasoning, subject: { kind: "promotion", paths: string[], commit: string, harness?: string } \| { kind: "role", level: "team-admin", team: string } \| { kind: "publish", from: { repo: "platform", ref, paths }, to: { org, ref } } }` → `{ id, team, state: "open" }` — one primitive, two subjects (prd-v2 §13). The CLI opens promotion requests (`offer`); the console opens both. Decided in the console, never by the CLI. | 08 |
| `POST` | `/v1/requests/{id}/withdraw` | → `204` — author only, open requests only | 08 |
| `POST` | `/v1/sessions/{id}/endpoints` | `{ events: EndpointEvent[] }` — authoritative, batched on the supervise tick; the server writes them to the audit chain as `session.endpoint`, `reason` and `setBy` included (05 D133) | 05, 08 |
| `POST` | `/v1/providers/model/{id}/setup` | `{ key: string, model?: string }` → `CommitResult` — *connect a key* in one write, org admin only (console 04 §10, 08 §11.21). The value goes into the bundled vault first; then **one commit on `refs/heads/org`** touching `policy/groups.json` (group `model-keys`, entry `alias: <id>` → that secret, `upstream` = the preset's endpoint origin, `attach` from the preset), `policy/grants.json` (`model-keys` → `{ teams: "all" }`, written once), `policy/model-providers.json` (`credential: { alias: <id> }`; `models` gains `model`) and `policy/routing.json` (`defaultFor.teams[<org path>] = <id>` only when no key is set there — D30i). Narrowing to teams afterwards is the Groups screen's ordinary work. `{id}` must be a row of `model-providers.json` **without a credential** — a row that already has one is refused `409 provider.credential_exists` (*{id} already has a key. Rotate it on Key vaults, or add a provider under another id.*), because a second alias for the same provider would tie in the broker's precedence (04 §5.4). The key never appears in a URL, a log or a commit. | 04, console 04 |
| `DELETE` | `/v1/providers/model/{id}?scope=org` | → `CommitResult` — removes the row from `policy/model-providers.json` on the org branch, org admin only (console 04 §10, W6-D5). Model providers are a `recommended` default (01 §4.2), which is to say the organization's: every verb exists, and this is the one the defaults checker found missing. Refused `409 provider.in_use` while a routing cell (a team, a harness or a runtime, in `defaultFor` or `approvedFor`) or a security group entry attached to the provider's credential alias still names it — the refusal lists them and nothing is deleted on the admin's behalf. Sentence `provider.delete`. | 04, console 04 |
| `PUT` | `/v1/routing` | `{ defaultFor, approvedFor }` → `CommitResult` — the whole `policy/routing.json`, org admin for any cell, team admin for their own team's default within *approved for* (`routing.not_yours`, `routing.not_approved`; console D42). W6-D6: refused `409 provider.needs_key` when the write **adds** a default or an approval naming a model provider no security group holds a key for, naming the *Set up* verb; only what the write adds is checked, so an existing cell cannot block the one beside it. Sentence `routing.change`. | 04, console 04 |
| `POST` | `/v1/harnesses` | `{ name, description?, icon?, assets?, from?, scope: "me" \| "org" \| <team path>, reach?: { mode, hosts }, grant?: { group } }` → `CommitResult & { id, grant? }` — `harnesses/<id>.json` committed on the ref `scope` names; `me` is never refused, `org`/team need an admin over that node (`harness.not_yours`). The CLI's `new --team`/`--org` (08 §11.12) and the console share it. A bundled preset named in `assets` is copied onto that branch in the same commit (W5-D15). `reach` is D131's shape and becomes `HarnessDef.reach`, the harness's one last narrowing step — absent means *inherit*, which is not `off` (W7-D4; the console sends `off` and never `on`). `grant` is one security group scoped to this harness alone (`scope: { teams: "all", harnesses: [id] }`): it is a **second commit, on the org ref**, because `policy/` is refused on a user branch (01 §4.2) — both are in one transaction, so a refusal on the grant rolls the harness back, and it is refused exactly where `POST /v1/grants` refuses one (`grant.org_admin_required`, `invalid_request` for a group the organization does not hold), before anything is written. | 08, console 04 |
| `POST` | `/v1/harnesses/{id}/assets?scope=me` | `{ ids: string[] }` → `CommitResult & { added: string[] }` — the ids join **the person's version** of the harness: `harnesses/<id>.json` on their own branch, created from the nearest copy on their chain when their branch holds none, which is the file and the rule `joinHarness` writes (08 §10.0 step 5a). A bundled preset among them is copied onto that branch in the same commit; a `tool` whose sidecar names `needs: [{ kind: "environment", name }]` brings that environment too; an id already listed is skipped and nothing to do is not a commit. Refuses `asset.unknown` for an id nothing on the chain and nothing bundled answers. Sentence `harness.add_assets`. The console's store is the only caller today; the CLI reaches the same place through `joinHarness` (W5-D15). | 08, console 04 |
| `GET` | `/v1/console/reach?scope=` | → `{ scope, effective: EffectiveReach, chain: [{ node, name, mode, hosts, when }], suggested: string[], canEdit }` — the Boundaries screen's Reach section (01 D131, D136). `chain` is the walk root first, one entry per node that holds a `reach.json`, so *inherited* sits above *yours*; `suggested` is `engine/compose/presets/reach-suggested.json`. Read by anyone on the scope. | 01, 05, console 04 |
| `PUT` | `/v1/reach?scope=` | `{ mode, hosts }` → `CommitResult` — the whole file on that node's ref, admin of the node (`reach.not_yours`). Sentence `reach.set`. | 01, console 04 |
| `POST` | `/v1/reach/hosts?scope=` | `{ host }` → `CommitResult` — *let this through*: under `allow` the host is added, under `on` it is taken off the deny-list, under `off` it is refused `403 reach.off` naming the Reach section. This is the Endpoints tab's **Allow**, aimed at the node a refused row's `setBy` named (D136). Sentence `reach.allow_host`. | 05, console 04 |
| `DELETE` | `/v1/reach/hosts/{host}?scope=` | → `CommitResult` — the inverse. Sentence `reach.deny_host`. | 05, console 04 |

**Service-to-service** (`definitions` ↔ `api`, shared bearer from the environment, never a person's token):

| Method | Path | Body → Response | Doc |
| --- | --- | --- | --- |
| `GET` | `/v1/internal/principal` | header `X-Harness-Token: <person's token>` → `{ user_id, org_id, chain: Chain, readable: string[] }` — `definitions` resolves a git-transport token; `readable` = further refs the person may fetch (a team admin: the user refs of members in teams under `role.at`); cached ≤30 s | 02 |
| `POST` | `/v1/internal/index` | `{ org, ref, commit, rows }` · `{ org, ref, commit, stale: { error } }` → `204` — post-receive index write in one transaction; `api` owns the tables (02 §8.3) | 02 |
| `POST` | `/v1/internal/audit` | `{ org, events }` → `204` — `definitions`' authoritative events onto the org's chain | 02 |
| `POST` | `/v1/internal/policy-changed` | `{ org, refs: [{ ref, commit, paths: string[] }] }` → `204` — sent only for a push touching `policy/` or `harnesses/` on an org or team ref; `api` revokes every active session whose `commits` names such a ref (C33; 04 §5.5) | 02, 04 |
| `POST` | `definitions:/internal/commit` | `CommitRequest` (02 §5.3) → `{ commit }` \| `409 { head }` — promote / accept / rollback / admin edits, called by `api` | 02 |
| `GET` | `definitions:/internal/tree/{org}/{commit}/{path}` (a directory listing, or the blob for a file path) · `/internal/log?org=&ref=&path=&limit=` · `/internal/diff?org=&a=&b=&path=` (unified text; `api` parses to the console's `DiffHunk[]`) | read-only; called by `api` to serve the console's file, history and diff views (console D8). The browser never speaks to `definitions`. | 02 |
| `POST` | `definitions:/internal/orgs` | `{ org_id, node_path }` → `201` — the dotted org path travels with the id; nothing is derived from refs | 02 |
| `POST` | `definitions:/internal/branches` | `{ org_id, ref, node_path }` → `201` | 02 |

There is no `GET /v1/resolve` and no `POST /v1/api-keys/deliver` (§6). **Reserved, not built:** `/v1/platform/*` — staff reads across organizations and the publish request (D30g, prd-v2 §12.2); every handler under it appends a `platform.read` or `platform.publish` audit event to the customer org's chain as well as the platform's.

The console's own read endpoints (`/v1/console/*`) and its writes are specified in [`../console/00-overview.md`](../console/00-overview.md) §4.10–4.11; they are consumers of the index and of these endpoints, never a second path to git or to a secret.

---

## 5. Constraints the engine must not break

Thirty-seven decisions verified in code or by spike (sources in
`agents.md`, `harnesses.md`, `build-plan.md`, `enforcement-gaps.md`,
`claude-code-notes.md`, `sandbox-notes.md`, `scoping.md`). Each names the
doc that honours it. A reviewer checks a change against this table.

| # | Constraint | Doc |
| --- | --- | --- |
| C1 | One work tree, many renderers; only rendering differs per provider | 07 |
| C2 | A provider difference is declared, not discovered; dropped loudly or refuse to boot | 07 |
| C3 | A capability claim is per machine: `harness preflight` prints the probed answer | 07, 08 |
| C4 | A control ships only with a choke point we own; otherwise it is labelled advisory or removed | 03, 05, 06 |
| C5 | `render` writes only under `agentDir`, read-only, symlinks allowed, copies forbidden | 07 |
| C6 | An adapter may never override a core env key or add a network host | 07, 08 |
| C7 | The agent cannot rewrite its own policy: `denyWrite` on its settings files **and** `--setting-sources user`; either alone is insufficient | 06, 07 |
| C8 | Hook `PostToolUse` and `PostToolUseFailure`; never write an audit line from `PreToolUse` | 07 |
| C9 | The generated Claude settings file is not named `settings.json` | 07 |
| C10 | Claude Code skills by symlink, never the plugin marketplace | 07 |
| C11 | Team-tool gating is read geometry: deny `process-exec` as well as `file-read*`; the probe execs a compiled binary | 06 |
| C12 | Built-in tool gating is advisory; capabilities are what is stored | 03, 07 |
| C13 | A harness only takes away | 01, 03 |
| C14 | Hydrate the full composed set, then filter; the work tree is identical in every harness | 01, 08 |
| C15 | A personal override keeps the asset's id (§7 D3) — the branch-model form of harnesses.md §14 | 01 |
| C16 | The harness selection lives outside the agent-writable tree | 08 |
| C17 | The session records everything it was offered: `preflight.json` is written whole | 03 |
| C18 | An assigned id that resolves to nothing is shown, never hidden | 03, 08 |
| C19 | A model/format mismatch fails closed at plan time naming both sides | 03 |
| C20 | An absent model never becomes an accidental one: ambient provider stores are in `denyRead` | 06, 07 |
| C21 | Harness policy sits below the customer's managed tier and never fights it | 07 |
| C22 | Native login happens outside the jail; native mode reports "not metered", not zero | 07, 08 |
| C23 | Inject mode **replaces** `Authorization` after verifying the session secret; strips `Cookie`, `X-HTTP-Method-Override` | 05 |
| C24 | Tunnel and inject are separate modes; `CONNECT :443` only; one proxy; no SOCKS | 05 |
| C25 | A degraded sandbox init is a failed boot; never an ask callback; local binding and unix sockets closed | 06 |
| C26 | Probes run before `exec` under the identical profile; an unexpected success aborts | 06 |
| C27 | `HOME` is passed verbatim by design; deny explicitly under it | 06, 08 |
| C28 | The agent holds no control-plane token; audit is a 0600 spool pre-created before spawn; the heartbeat is the parent's | 08 |
| C29 | The hook trail is telemetry; the proxy log is authoritative | 05, 08 |
| C30 | Every git invocation: `-c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.fileMode=false`; git dir outside the work tree | 01, 08 |
| C31 | `push` commits to the user's branch; only hydration moves `refs/harness/remote` | 01, 08 |
| C32 | Absent is not empty: no boundary ≠ an empty allowlist. The cutover safeguard | 01, 05 |
| C33 | A policy change ends the session; there is no hot reload | 08 |
| C34 | The audit hash chain verifies per unit; reads roll up, verification does not | 02 |
| C35 | Reach is enforced by the control plane identically for every provider | 02, 05 |
| C36 | `api` is the only Postgres client — for records *and* for the index, which `definitions` writes through `POST /v1/internal/index` (02 D40/D41); RLS is a lockout, not authorisation | 02 |
| C37 | Adding an asset kind is one line of data (`kinds.json`) | 01 |

---

## 6. What the engine deletes

Nothing on this list is extended, wrapped or migrated. It is removed when
its replacement lands (09 says when), and its tests go with it.

| Today | Replaced by | Doc |
| --- | --- | --- |
| Provider key in the child environment (`index.ts` `credentialEnvVar`) | proxy inject mode | 05 |
| `HARNESS_REDACTIONS` and transcript redaction in the Pi extension | nothing to redact: no value in the jail | 05, 07 |
| `GET /v1/resolve` and the JSON `Manifest` as source of truth | `git fetch` + `compose()` | 01, 02 |
| `POST /v1/api-keys/deliver` (plaintext, long-lived, any owned session) | `POST /v1/sessions` mint | 04 |
| `boundary.model_policy.{source,user_credentials}` gating in `model.ts` | routing (`defaultFor`/`approvedFor`) + group `sources` (§7 D9) | 03 |
| `asset_scopes` table, endpoints, and the candidacy predicate in `resolve.py` | presence on a branch in the chain | 02 |
| `harness_assets(kind, name)` | `HarnessDef.assets: string[]` (ids) | 01 |
| `assets` / `asset_versions` / `asset_files` as source of truth | bare repos; the tables become the derived index | 02 |
| `denyReadArgv` as a bespoke wrapper | the `filesystem` enforcer writing `SpawnPlan.filesystem` | 06 |
| `identify()` by directory shape for `push` | the sidecar says the kind (`adopt` alone may still infer a kind from a hand-made directory's shape when minting a sidecar — 08 §11.11) | 01 |
| `automation_runners` table; `db.record`, `org_tree.ancestor_rows`, `identity.token_is_expired` | nothing (dead) | 02 |
| `enforcement-architecture.md` §6 `Adapter`; `agents.md` §4 `Adapter` | §4.8 here | 07 |

---

## 7. Decisions this plan makes

Each is reversible in one line unless marked. D1–D11 are the architect's;
D12–D30 adopt or retire decisions from older documents that `prd-v2.md`
did not carry (advisor review, 24 September 2026).

| # | Decision | Why | Doc |
| --- | --- | --- | --- |
| D1 | **The git server is bare repos on a volume in a service we own (`definitions`), one repo per org, with per-request `transfer.hideRefs` via `GIT_CONFIG_PARAMETERS` in front of `git http-backend`.** `plan-improvement.md` D1's objections are answered, not ignored: repos are the *only* source of truth (Postgres holds a derived index and separate records), so there is one restore order and no cross-store transaction; writes are human-rate (a push, a promote), so per-repo serialisation costs nothing measurable; the service is stateful by design and is the one thing backed up by volume snapshot. Horizontal scale is by sharding orgs across instances behind a path router, not by shared disk. **The transport forces git protocol v0**: v2's `fetch` accepts a `want` for any existing object, so `hideRefs` + `allowAnySHA1InWant=false` hold only under v0 (proved both ways by `hidden_ref_object_not_fetchable_by_sha`). `definitions` never sets `GIT_PROTOCOL`. | prd-v2 §3 | 02 |
| D2 | **Composition is one TypeScript implementation** (`@harness/compose`), run by the CLI at boot and by `definitions` post-receive to build the index. The Python `api` never composes; it reads the index. | prd-v2 §13 build-once | 01, 02 |
| D3 | **A personal override keeps the sidecar id.** `push` never mints an id for an existing path; `adopt`/`new` mint one for a new asset; a new id at an existing path is the §4.2 *same-path-different-id* conflict and is refused at pre-receive and at compose. This is how the branch model keeps harnesses.md §14's guarantee while keying harnesses by id. Test: `override_keeps_id`, `new_id_at_existing_path_is_refused`. | harnesses.md §14 vs prd-v2 §4.2 | 01 |
| D4 | **Sandbox: we generate Seatbelt profiles on macOS and invoke `bwrap` directly on Linux. `@anthropic-ai/sandbox-runtime` is not used.** It degrades instead of failing closed (G8) and carries three second-ways-out (G9); by philosophy §4 that is disqualifying, and the CLI keeps zero runtime dependencies. On Linux the jail's only exit is a unix socket bound in; a forwarder we ship bridges loopback TCP inside the namespace to it. | enforcement-philosophy §4; G8, G9 | 06 |
| D5 | **Credentials are attached by the proxy, never placed in the environment.** `prd-v2.md` §10.1's "only layer 5 holds a live value" is amended to "only the supervisor holds a live value; the proxy attaches it." | I3; enforcement-architecture §3 | 05 |
| D6 | **`asset_scopes` retirement ships with the same acceptance test as its backfill:** every manifest that resolved before the migration composes byte-identically after it, for every user. | v3 §5 | 02 |
| D7 | **Provider pinning is one field with two shapes.** A vendored or forked provider pins a repo and commit (prd-v2 §9); a located provider (Claude Code) pins a binary name and a version floor, and the adapter's generated settings disable self-update. Both are "the adapter chose the binary and checked its version". | agents.md §8 | 07 |
| D8 | **Per-harness model default is honoured** (prd-v2 §9.2). Precedence at Choose: harness → provider → team. harnesses.md §12's exclusion is retired. | prd-v2 §9.2 | 03 |
| D9 | **`model_policy` (0024) is retired; its two fields map exactly:** `source: none` ≡ no model provider approved for this scope; `user_credentials: forbidden/allowed/required` ≡ the model credential's group `sources: vault` / `vault-or-local` / (native mode: no group covers the model). Nothing is lost. | agents.md §5.1 | 03 |
| D10 | **`harness provider add`, managed installs, MCP definitions, Cursor: Later.** The engine ships Pi (vendored) and Claude Code (located). | agents.md 14.7 | 07 |
| D11 | **Native mode is not gated by the two spikes.** *Spike 2* (Pi `auth.json` relocation): seed-and-harvest — copy the stable login in before spawn, copy it back after — is the v1 mechanism, already built; relocation is an improvement, Later. *Spike 3* (macOS Keychain): the deny-read set cannot hide the Keychain, so an ambient Claude Code login is reachable inside the jail. What that threatens is **an org-mode session on macOS billing the person's own subscription instead of the organization's key** (G13) — closed at M4 by the fence, not by deny-read: the ambient token is useless when `api.anthropic.com` has no route, and when Anthropic *is* the org's provider, `ANTHROPIC_AUTH_TOKEN` takes precedence in Claude Code's own credential order. In a personal account there is no organization key to bypass, so the threat does not exist. Named test `ambient_token_has_no_route_in_org_mode` (T3, M4). | prd-v2 §12.1: personal must be a great experience; the spikes protected enterprise org mode, not native mode | 06, 07, 09 |
| D12 | Adopt `denyWrite` on the provider's settings files + `--setting-sources user` (C7) | the only mitigation for `disableAllHooks` | 06, 07 |
| D13 | Adopt declared-not-discovered: `capabilities`, `RenderReport`, and `agent_requirements` renamed **`policy.require: Concern[]`** on a boundary of kind `capability` | agents.md §3 | 07 |
| D14 | Adopt `locate()` + version floor + self-update pinning | agents.md §8 | 07 |
| D15 | Adopt adapter `probe`: came up at the located version, on the chosen model, with no credential we did not give | agents.md §9 | 07 |
| D16 | Adopt the two-mode proxy with per-session `Proxy-Authorization`, SNI matching, IP-literal refusal, and *replace* not strip on `Authorization` (C23) | enforcement-gaps G4–G6, corrections | 05 |
| D17 | Adopt the child environment allowlist with `HOME` verbatim (C27) | build-plan 0.1 | 08 |
| D18 | Adopt the audit spool exactly as built (C28) | build-plan 0.2 | 08 |
| D19 | Adopt the git `-c` flags on every invocation (C30) | build-plan 1.1 | 01 |
| D20 | Adopt absent-is-not-empty (C32): a chain with no endpoint boundary and no outside-endpoints grant has `hosts` = the derived list, never `[]` | build-plan 1.7 | 05 |
| D21 | Adopt the hard-closed sandbox keys (C25) as constants in `06`, not configuration | G9 | 06 |
| D22 | Retire `boundary.allowed_agents` and `agent.allowlist`: `HarnessProvider.approval` + `scope` is the one model | prd-v2 §9.1 | 03 |
| D23 | Retire preference `mode: suggested/absolute`; keep its one hard rule as a constraint: **the model default is never absolute** — a person may `/model` mid-session within *approved for* | agents.md §12 | 03 |
| D24 | Retire skills-by-symlink *versus* sparse checkout as a conflict: **sparse materialisation** is how the work tree is populated (01 D32 — delivered by the hydration table, not by git's `core.sparseCheckout`, which would add a second state machine; prd-v2 §4.2 amended to say so); symlinks are how a provider's config dir points at it. Both stand. | 14.5 vs prd-v2 §22 | 01, 07 |
| D24a | **The login token travels as `-c http.extraHeader=Authorization: Bearer …` on every git invocation and never lands in `assets.git/config`** — the git dir is not readable from the jail only by deny-read, and a secret should not depend on one control. | 01 D36 | 01, 08 |
| D25 | Adopt per-format `endpoints` on a model provider (§4.3) | agents.md §12.6 | 03 |
| D26 | Adopt `claude-settings.json` naming (C9) and the double-hook finding | claude-code-notes | 07 |
| D27 | Adopt "one connector does not serve both agents": URLs differ per wire format; only the credential and the allowlist are shared | agents.md §12.5 | 05 |
| D28 | Adopt the selection file at `$HARNESS_HOME/harness.json` (C16) | harnesses.md §8.1 | 08 |
| D29 | Adopt `supabase-migration-plan.md` D1–D6 unchanged; `harness login --sso` device-code remains the login modernisation path, Later | — | 08 |
| D30a | **`ResolvedFrom.source` is the place — `vault` or `local` — never the rule.** Group and grant ride alongside as *why you were allowed*. | prd-v2 §6.5's vocabulary is vault-supplied / locally-owned | 03, 04 |
| D30b | **Exit review** at row 13: diff against the boot tree, offer *all · none · pick*, push only. | the moment the product is sold on; missing from every earlier draft | 08 |
| D30c | **`Adapter.import()`** — an existing Claude Code or Pi setup becomes a harness on the person's branch, with a fidelity report. Named test `imported_claude_harness_runs_on_pi`. | the acquisition test: what a person built before us must run under us | 07, 08 |
| D30d | **Known wire formats beyond the two implemented** are values in the type, not a redesign. | a new format is data plus an adapter capability | 03, 07 |
| D30e | **Windows is a product gap with three paths, not a Later** (06 §9a): W1 WSL2 (spike M4, ships M5), W2 native AppContainer (spike M6), W3 credentials-only by explicit organization approval — shown on every session, never a CLI flag. | the buyers are departments; "not supported" would be a failure | 06, 09 |
| D30f | **A personal account is an org with zero teams** (prd-v2 §12.1): sign-up creates the org and the user node in one `definitions:/internal/branches` call; the person is org-admin of it; the broker, fence and preflight run unchanged. No engine work beyond sign-up. | one model, two shapes | 02, 04 |
| D30h | **A new organization is seeded, not empty** (prd-v2 §9.1: *not approved is a state, not an absence*). `POST /v1/orgs` commits `seeded <org path>` on `refs/heads/org` as its last `definitions` call (after both branches, before its own `append_event` — the §5.6 ordering in `cutover.md`): `policy/harness-providers.json` with every runtime in `engine/compose/presets/harness-providers.json`, `policy/model-providers.json` with every preset and no credential, `policy/routing.json` empty, `policy/kinds.json`, `policy/always-loaded.json`, `policy/groups.json` and `policy/grants.json` empty. Enterprise seeds every runtime `not-approved` with `reason: "Not yet reviewed by an organization admin."`; personal seeds every runtime `approved` and adds the group `my-keys` (no entries) granted `{ teams: "all" }` (console 07 D73). The exporter seeds the same files for a migrated org, **filling by id and never overwriting a row the records already had**. | a runtime nobody can see is indistinguishable from one nobody approved; the presets exist in one file so three copies stop drifting | 02, console 04, 07 |
| D30k | **`context` is an asset kind: material the assistant consults, never material it is fed.** A directory of any files — a slide template, a style guide, brand assets, a schema, a report to imitate — with a one-line `CONTEXT.md` saying what it is. Composed, hydrated, pushed, offered and scoped like every other kind (C37: one line of data in `kinds.json`); rendered as an index in the brief with the directory path and that line, and read by the assistant when a task calls for it. Nothing in it is injected into a call. Added to `seed.KINDS`, the seam paragraph (07 §6a), the `harness-authoring` skill and `adopt`'s shapes (08 §11.11). | a person's templates and references had no home that was not a memory (injected every call) or a project file (left behind) | 01, 07, 08 |
| D30m | **`environment` is an asset kind — the declaration; `envs/<harness id>/` (D30l) is its materialisation.** A directory with a one-line `ENVIRONMENT.md` and the manifests that say what must be installed — `requirements.txt`, `pyproject.toml`, `package.json`, `Gemfile`, `go.mod` — composed, pushed, offered and scoped like every other kind, so a harness travels with what its tools need. The brief indexes each one with the command that applies it, and the session applies it **inside the jail, through the fence** (reach is the organization's, as for any install); nothing is installed at boot behind the fence's back. The seam tells the assistant to record what it installs in an environment asset. Not hidden, not implicit: an environment is an asset. | the venv alone was a private cache nobody could review, offer or hand to a team | 01, 07, 08 |
| D30l | **Every harness has its own environments, and everything a session installs lands there.** `<HARNESS_HOME>/envs/<harness id>/` holds a Python venv (made once, in preflight's Plan row, offline), an npm prefix, and Go/Cargo/Gem homes; the child environment names them (`VIRTUAL_ENV`, `PIP_REQUIRE_VIRTUALENV`, `npm_config_prefix`, `GOPATH`, …) and puts their `bin` directories first on `PATH`; the directory is in the write geometry and persists between sessions. The machine's own site-packages and global prefixes are never written and, for Python, never read. Installs need reach like any other outside endpoint. | a person running many harnesses otherwise manages every package on the machine, and a tool's `pip install` lands in whatever Python happened to be first | 06, 08 |
| D30j | **Every session is told where the seam is, and one built-in skill says how to work across it.** `layout.ts` writes one fixed paragraph at the top of every rendered brief (07 §6a): where assets live, that the working directory is the project's, and that the `harness-authoring` skill exists. That skill ships as data in `engine/compose/presets/assets/skill/harness-authoring/` (id `0460b220-8379-5ddf-82ef-31bc0e8a99e1`, fixed), is seeded onto every org branch by D30h and named in `policy/always-loaded.json`, and is what an assistant reads to *make* an asset in the kind's shape or to *extract* one from another tool's setup — Claude Code, Codex, Cursor, Gemini CLI, Aider, Pi — in `import`'s own carried / partial / dropped terms, never carrying a credential value. The exit review adopts what was made (08 §10.0). | a runtime asked to *build a skill* wrote it into the project, and a person switching tools had no path but a hand-written adapter | 07, 08, console 07 |
| D30i | **Routing may be keyed by the organization's path.** `defaultFor.teams` / `approvedFor.teams` accept team paths or the org path; preflight walks the chain from the person's team upward to the org and takes the nearest key. One org-wide default is one line; a team's line overrides it; a personal account (org · user) has a place for its one key without inventing a team. | the exporter's *write the org's default onto every team* and its `routing_keyed_by_org_path` finding both go away | 03, 08 |
| D30g | **The platform scope is reserved, not built**: `/v1/platform/*` in `api`, a `staff` role that is never an org role, a platform repository `platform.git` in `definitions` holding assets and no policy, and the request subject `publish` (prd-v2 §12.2). Every staff read of an org is an audit event in both trails. | a retrofit later would touch every authorisation check | 02, 04 |
| D136 | **Reach is set at a scope, and every refusal offers the same write.** `GET /v1/console/reach?scope=` answers the effective reach, the walk that made it, and the suggested starter list; `PUT /v1/reach?scope=`, `POST /v1/reach/hosts?scope=` and `DELETE /v1/reach/hosts/{host}?scope=` write it, admin of that node. The console's Endpoints tab groups attempts by `(host, outcome, reason, setBy)` and each refused row carries whether *this* viewer may allow it and, when not, the one sentence saying who can — so a refusal in the log and the control that fixes it are one click apart, and the CLI's sentence, the log row and the screen all name the same node. | the refusal in the log and the setting that caused it were two screens and a guess apart | 01, 05, console 04 |
| D148 | **A runtime says what it is called** (§4.3, W6-D3). `HarnessProvider.name` — *Pi*, *Claude Code* — optional on the contract so a branch seeded before this change still composes, required of every row in `engine/compose/presets/harness-providers.json`, carried through `policy.ts`'s SPEC, written by the seed and passed into `idx_policy` verbatim by the indexer, which needs no edge for it: a display name is not a relationship | every screen holding its own id → name map, which is what `console.RUNNER_NAMES` was and what console 04 D90 recorded as a contract gap | 01, console 04 |
| D30 | **Fix the build first:** root `npm run build` omits both harness packages; milestone 0 makes a fresh checkout runnable | survey 1 | 09 |

---

## 8. Budgets

"Nothing unnecessary" is checked with numbers. Ceilings, not targets; a
module over its ceiling needs a sentence in the PR saying why. Baseline:
the engine today is ~2,300 source lines in `harness-cli` plus ~300 in the Pi
extension.

| Module | Ceiling (source LOC, excluding tests) |
| --- | --- |
| `engine/compose` | 600 |
| `engine/cli` — run, hydrate, git, env, supervise, session | 1,200 |
| `engine/cli` — preflight and enforcers | 500 |
| `engine/cli` — proxy | 500 |
| `engine/cli` — sandbox (both OSes + forwarder) | 450 |
| `engine/cli` — each adapter | 300 |
| `engine/cli` — commands and output | 700 |
| `engine/definitions` | 900 |
| `backend` broker + resolvers (Python) | 700 |
| `backend` OpenID issuer for vault federation (11 §4) | 80 |
| Pi extension | 250 |

Tests are not budgeted; the hydration table's tests against real git are the
model for how the rest is tested (§10).

---

## 9. Supersession

| Older statement | Superseded by |
| --- | --- |
| `enforcement-architecture.md` §6 (adapter interface, tiers) | 00 §4.8, 07 |
| `enforcement-architecture.md` §3 "strip inbound `Authorization`" | 05 (replace, C23) |
| `enforcement-architecture.md` §4 `SpawnPlan` | 00 §4.5 |
| `agents.md` §4 adapter interface; §2 `allowed_agents`; §12 preferences | 00 §4.8, D22, D23 |
| `sandbox-notes.md` "wrap each spawned shell process, not the whole Harness process"; the `@anthropic-ai/sandbox-runtime` decision | 06, D4 |
| `asset-sync.md` §9 "no server-side git" | 02 |
| `harnesses.md` §2 `(kind, name)` keying; §12 no per-harness model; §5 schema | 01 (D3), D8, 02 |
| `build-plan.md` Phases 3–4 | 05, 06, 09 |
| `scoping.md` in full | prd-v2 §21; this plan implements the reversal |
| `plan-improvement.md` D1 (Postgres CAS, not git) | D1 here — reversed with the objections answered |
| `prd-v2.md` §10.1 "only layer 5 ever holds a live value" | D5: only the supervisor holds a live value; the proxy attaches it |

---

## 10. Testing, in one page

Four tiers. Every doc names its tests by tier.

| Tier | Runs against | Examples |
| --- | --- | --- |
| **T1 pure** | functions with no I/O | `compose()` over fixture trees; enforcers over fixture plans; `Scope` evaluation; rehydrate equality |
| **T2 real git** | a repo in a tmpdir, as `hydrate.test.ts` does today | the five hydration rows; sparse checkout; sidecar validation; the conformance fixtures shared with `definitions` |
| **T3 process** | a spawned child on this OS | proxy conformance (tunnel/inject/refusals); sandbox probes; adapter `probe`; forwarder |
| **T4 service** | `definitions` + `api` + Postgres in a scratch DB | per-ref auth (a user cannot fetch a sibling team's ref); pre-receive refusals; index rebuild equals fresh index; the mint rules; D6's byte-identical migration test |

**Conformance fixtures.** `engine/compose/fixtures/` holds chains as
directories with expected `Composed` JSON. The CLI and `definitions` both run
them; the console's Playwright suite reads the same expected JSON for its
fixtures. One truth, three consumers.

**Named tests are part of the spec.** When a doc says *test:
`override_keeps_id`*, a test with that name exists before the code is
merged, and a reviewer can find it by name.

---

## 11. Glossary

| Word | Means | Never means |
| --- | --- | --- |
| **harness** | a named list of asset ids, with a drawing (prd-v2 §17) | the runtime |
| **harness provider** / **provider** | the runtime: Pi, Claude Code | a model vendor |
| **model provider** | where models come from: Anthropic, OpenRouter, a gateway | — |
| **chain** | the ordered refs from org to the person | a merge |
| **compose** | build the effective set from the chain by precedence | `git merge` |
| **grant** | a scoped instance of a group, or of reach | a group |
| **group** | a named set of alias → secret entries with a sources rule | a team |
| **boundary** | a deny | an allowlist |
| **slot** | one `Need` with its state, evidence and `resolved from` | — |
| **blocker** | a named, linked reason preflight or the broker refused | an exception message |
| **supervisor** | the `harness` process during a session | the extension |
| **jail** | the sandboxed provider process and its children | the supervisor |
| **attested** | reported from inside the jail | authoritative |
| **authoritative** | recorded by the proxy, the broker or `definitions` | attested |
