# Engine Plan — 03 · Preflight

Compose has produced a `Composed`. Preflight turns it into either a
`SpawnPlan` the supervisor may execute, or a list of `Blocker`s the person can
act on. It is rows 4–10 of the boot table (`00 §3`): **choose → needs walk →
mint → plan → render → fence → probe → report**. `harness preflight` is the
same code stopped before spawn (the proxy is started for the probes and
closed again).

Preflight replaces `pi/packages/harness-cli/src/model.ts` (the
`model_policy` decision) and the filtering half of `adapters/layout.ts`
(`assetsByKind`, `grantedCapabilities`, `toolIsGranted`, `deniedToolDirs`).
Both are deleted when this lands (`00 §6`).

## 1. Purpose

Answer, before any process exists, four questions with evidence: *what will
load, on which runtime, against which model, with which credentials* — and
refuse, naming the thing, when any answer is missing. What preflight decides
the broker re-decides at mint and the proxy re-decides per request (`00`
I4); preflight exists to give a good error before launch rather than a
cryptic one after.

## 2. Invariants

| # | Invariant | Source |
| --- | --- | --- |
| P1 | Preflight is a detector. Every check here has a server-side or fence-side twin that holds without it. | `00` I4 |
| P2 | Nothing rounds up. A slot's `evidence` is what was actually established; a probe that did not run leaves `declared`. | `00` I6 |
| P3 | Enforcers only tighten. Allowlists intersect, deny lists union, no enforcer may add a host, a write path or an env key another removed. | `00 §4.5` |
| P4 | A harness only takes away. The load set is a subset of `composed.assets`; nothing preflight does can reach an id the chain did not deliver. | C13 |
| P5 | Absent is not empty. A chain with no endpoint boundary produces `hosts` = the derived list, never `[]`, and absent reach is `off`, never "anything". | C32, D20, 01 D131 |
| P6 | The report is written whole, before any spawn, whether passing or failing. | C17 |
| P7 | A format mismatch names both sides. | C19 |
| P8 | An assigned id that resolves to nothing is reported, never dropped. | C18 |
| P9 | An unexpected probe success is a failure. | C26 |

## 3. Contracts used

From `00 §4`, by name and nothing else: `Chain`, `ChainNode`, `Composed`,
`ComposedAsset`, `Sidecar`, `Need`, `Conflict`, `Scope`, `Grant`,
`SecurityGroup`, `Boundary`, `ModelProvider`, `HarnessProvider`, `Routing`,
`HarnessDef`, `WireFormat`, `Choices`, `SpawnPlan`, `Enforcer`, `Slot`,
`SlotState`, `Evidence`, `ResolvedFrom`, `MintedCredential`, `Blocker`,
`Drift`, `PreflightReport`, `Adapter`, `RenderContext`, `Rehydrated`,
`Located`, `ProbeRunner`. Server calls: `GET /v1/me`, `POST /v1/sessions`
(`00 §4.10`).

`GET /v1/me` carries `role: { level: "member" | "team-admin" | "org-admin", at }`;
preflight reads `role.level` for the beta check (§5.2 step 2). The
broker re-checks the same rule at mint, so a stale or forged answer here
changes only the quality of the error.

## 4. Module layout

`engine/cli/src/preflight/`, ceiling 500 source lines for the whole
directory (`00 §8` "preflight and enforcers").

| File | One export | Does |
| --- | --- | --- |
| `preflight.ts` | `preflight(input): Promise<PreflightReport>` | the phases in order; the only file that performs I/O (mint call, probes, render, report write) |
| `choose.ts` | `choose(composed, argv, selection, me): Choices` | §5.2, pure |
| `loadset.ts` | `loadSet(composed, choices): { loaded: ComposedAsset[]; missing: string[] }` | §5.3, pure; the adapters (07) import this one function |
| `needs.ts` | `walkNeeds(composed, choices, loaded): Slot[]` | §5.4–5.5 before mint, pure |
| `enforcers/index.ts` | `ENFORCERS: readonly Enforcer[]` | §5.7 ordered list |
| `enforcers/network.ts` · `credentials.ts` · `commands.ts` · `filesystem.ts` · `environment.ts` · `provider.ts` | one `Enforcer` each | §5.7, pure `plan()`; `probe()` where stated |
| `drift.ts` | `diffRehydrated(expected, actual): Drift[]` | §5.8, pure |
| `probes.ts` | `LOCAL_PROBES` | §5.9 table, data |
| `report.ts` | `renderReport(report, mode: "run" \| "preflight"): string` | §5.10, pure |

`covers()` and `scopeSpecificity()` live in `@harness/compose`
(`engine/compose/src/scope.ts`) because the broker (04) and `definitions`
(02) evaluate the same predicate; preflight imports them. `harness preflight`
and `harness run` call `preflight()` with `{ spawn: false | true }`; there is
no second code path.

## 5. Algorithms

### 5.1 `covers(scope, chain, harnessId)` — the Scoping primitive

```
covers(scope, chain, harnessId):
  teams := chain.filter(n => n.kind === "team").map(n => n.path)
  1. if scope.teams !== "all" and scope.teams ∩ teams = ∅  → false
  2. if scope.harnesses is present:
       if harnessId is null                                → false
       if harnessId ∉ scope.harnesses                      → false
  3. → true
```

`scopeSpecificity(scope, chain)`: `(depth, narrowed)` where `depth` is the
index in `chain` of the deepest team path in `scope.teams` (`-1` for
`"all"`) and `narrowed` is `1` if `scope.harnesses` is present else `0`.
Ordered lexicographically; larger is more specific. Used by §5.4 step 5 and
§5.2 step 6. Test: `covers_matches_prd_scoping_table` (T1, fixtures shared
with 02 and 04).

### 5.2 `choose(composed, argv, selection, me): Choices`

Inputs: `argv.provider` (the one undashed word, or undefined),
`argv.harnessFlag` (the one non-reserved dashed word, or undefined),
`argv.team` (the `--team` flag, 08 §6), `selection` (the parsed
`$HARNESS_HOME/harness.json`, or undefined), `me.role`. Steps; the first
failing step throws its `Blocker`.

1. **Provider word.** `known := Object.values(composed.policy.harnessProviders)`.
   No word and one known → it. No word and several → `preflight.provider_ambiguous`.
   Word not in `known` → `preflight.provider_unknown` listing `known` ids.
2. **Approval.** `approval === "not-approved"` → `preflight.provider_not_approved`
   carrying `reason`. `approval === "beta"` and `me.role.level === "member"` →
   `preflight.provider_beta`.
3. **Approval scope.** `!covers(provider.scope, composed.chain, null)` →
   `preflight.provider_out_of_scope`. (Harness is not chosen yet; approval
   scope is by team only. A `HarnessProvider.scope` with `harnesses` set is a
   `compose.*` conflict raised by 01, not handled here.)
4. **Harness.** `argv.harnessFlag` → match case-insensitively on `name` or
   `<owner path>/<name>` across `composed.harnesses`; zero →
   `preflight.harness_unknown` listing them; more than one →
   `preflight.harness_ambiguous` listing qualified forms. No flag →
   `selection?.harness_id` looked up by id; missing from `composed.harnesses`
   → delete the selection file and throw `preflight.harness_gone` (never
   silently fall back; harnesses.md §8.2). No flag, no selection → `null`.
   The flag never writes the selection file.
5. **Grants covering.** `grants := composed.policy.grants.filter(g =>
   covers(g.scope, composed.chain, harness?.id ?? null))`.
   Choose derives no reach: it is `policy/reach.json`, composed (01 D131), and
   `Grant.reach` is retired (01 D132).
6. **Model.** Let `R := composed.policy.routing`, `teams` as in §5.1,
   `deepest := last team path in chain`.
   - `approved :=` union of `R.approvedFor.harnesses[harness.id]`,
     `R.approvedFor.providers[provider.id]`, and `R.approvedFor.teams[t]` for
     every `t` in `teams` — each entry a model-provider id. Empty →
     `preflight.model_none_approved`.
   - `defaultId :=` first defined of `R.defaultFor.harnesses[harness?.id]`,
     `R.defaultFor.providers[provider.id]`, `R.defaultFor.teams[t]` for `t`
     from deepest to root (D8: harness → provider → team). Undefined →
     `preflight.model_no_default`. `defaultId ∉ approved` →
     `preflight.model_default_not_approved` (a routing inconsistency an org
     admin must fix).
   - `argv.model` (a `--model <provider>/<id>` override the person typed) →
     must be in `approved`, else `preflight.model_not_approved`. Within
     `approved` the person's choice stands (D23: the default is never
     absolute).
   - `mp := composed.policy.modelProviders[defaultId]`; missing →
     `compose.*` (01 validates references); here it is an assertion.
   - **Wire format** (C19): `wireFormat := provider.speaks.find(f => mp.endpoints[f])`.
     None → `preflight.format_mismatch` with both sides named:
     *"Claude Code speaks anthropic-messages, but OpenRouter exposes
     openai-completions."* `endpoint := mp.endpoints[wireFormat]`.
   - `model :=` the `--model` id if given, else `mp.models[0]`; not in
     `mp.models` → `preflight.model_unknown`.
6a. **Native mode** (D9's last row, D11; W7-D2). `native :=` no key this
   person holds reaches `mp` — `mp.credential` is absent, or no covering grant
   supplies its alias. That is `broker.needs_key` read from this side, and
   W7-D2 retired the old clause that a provider with no `credential` at all is
   an organization gateway and never native: W6-D6 had already retired the
   keyless gateway provider, so a row no key reaches is one fact, however it
   got that way.
7. **View.** `view := argv.team || selection?.version === "team" ? "team" : "mine"`.
8. Return `{ provider, harness, view, model: { provider: mp, model, wireFormat,
   endpoint }, grants, native }` — without `located`.

`choose` performs no I/O. The `me` argument is the parsed `/v1/me` body the
caller already fetched for the chain. `preflight.ts` then runs
`located := await adapter.locate(provider.pin)` (§5.9) and completes the
`Choices` as `{ ...choices, located }`; `locate` is the only I/O in the Choose
row and is kept out of the pure function. It also completes `native`, because
only the adapter knows whether it can sign in at all
(`capabilities.model_native !== "none"`) and which providers it has a sign-in
*for* (`modelNative`, 07 §6) — so `native` means *this runtime will log itself
in to this provider*, which is the same question the broker asks at 04 §5.3
step 5 (D156) and the reason the two never disagree about a session.

### 5.3 `loadSet(composed, choices): { loaded, missing }`

The one function that says what a session loads; the adapters (07 §9)
import it rather than owning a copy.

```
1. byId := Map(composed.assets by id)
2. if choices.harness === null → wanted := every id                (harnesses.md §0)
   else wanted := harness.assets ∪ composed.policy.required        (W5-D10)
3. loaded := wanted.map(id => byId.get(id)).filter(defined)
4. if choices.view === "team": for each asset in loaded whose from.kind === "user",
     replace it with its `shadows` copy when one exists ({ ...asset, from: shadows.from,
     tree: shadows.tree, shadows: undefined }), else drop it — the session sees the
     team's copies; the work tree is untouched (08 §6 `--team`, C14)
5. missing := wanted where byId has no entry                       (P8)
6. return { loaded, missing }
```

§5.4 turns each `missing` id into a Slot: need `{kind:"asset", id}`, state
`unsatisfied`, evidence `declared`, blocker `preflight.asset_missing`.
`required` ids are loaded in every harness including the empty one, and a
harness naming one twice is not an error (W5-D10). `recommended` ids are
**not** here: they are copied into a harness's `assets` when the harness is
created, and are ordinary entries of it from then on.

### 5.4 `walkNeeds(composed, choices, loaded): Slot[]`

One `Slot` per `Need` in every loaded sidecar, in load order then
declaration order. `compatible(alias)` := every `(grant, group, entry)` with
`grant ∈ choices.grants`, `grant.group` defined,
`group = composed.policy.groups[grant.group]`, `entry ∈ group.entries` with
`entry.alias === alias`, and — for a narrowed grant — `alias ∈
grant.narrowedFrom.aliases`.

1. **Model credential.** If `choices.model.provider.credential` is set, push
   a synthetic `Need {kind:"credential", alias}` for it first. A model
   provider with no `credential` is gateway mode: no slot.
2. **`asset` need.** `id ∈ loaded` → satisfied/verified (composition is a
   fact). Else unsatisfied, `preflight.asset_needed`: *"`<loaded asset name>`
   needs `<needed asset name>`, which is not in this harness."* remedy *"Add
   it to <harness name>, or remove <loaded asset name>."* If the id is not in
   `composed.assets` at all, remedy names the chain instead (P8).
3. **`credential` need.** `c := compatible(alias)`.
   - `|c| = 0` → unsatisfied, `preflight.no_compatible_group`:
     *"<deepest team name> holds no group with an entry for `<alias>`."*
     remedy *"Ask a <deepest team name> admin to narrow one into the
     sub-team."* (the PRD's sentence; when the person's deepest team is a
     top-level team the remedy is *"Ask an organization admin to grant a
     group holding `<alias>` to <team>."*).
   - `|c| ≥ 1` → order by `scopeSpecificity(grant.scope)` descending; if the
     top two are equal → unsatisfied, `preflight.ambiguous_group` listing
     both grants (a tie is an admin's ambiguity, not ours to guess — the
     same rule `harness switch` applies to an ambiguous name). Else the
     first is the **candidate**: `state "declared"`-pending — recorded as
     `unsatisfied` with `resolvedFrom` = `{source:"vault", vault, group, grant:
     grant.id, vault: entry.secret.vault}` and `evidence "declared"` until
     the broker answers (§5.5).
4. **`login` need.** `tool ∈ LOCAL_PROBES` → probe later (§5.9); until then
   `unsatisfied`/`declared`. `tool ∉ LOCAL_PROBES` → `deferred`/`declared`
   (an OAuth held in the provider's own store, prd-v2 §6.7: checked once the
   provider is up, never counted as satisfied).
5. **Format** (C19, per asset). `sidecar.format` set and `≠
   choices.model.wireFormat` → blocker `preflight.asset_format` with `link`
   to the asset: *"Long-context summariser needs the anthropic format, and
   OpenRouter exposes openai. Drop it from this harness, or route through a
   provider exposing anthropic."* This is a `Blocker`, not a slot.
6. Return slots (including §5.3's missing-asset slots).

### 5.5 Slots and evidence

| Moment | `state` | `evidence` | `resolvedFrom` |
| --- | --- | --- | --- |
| after §5.4, credential with a candidate | unsatisfied | declared | the candidate group/grant/vault |
| broker minted it | satisfied | `MintedCredential.evidence` (deep vault → verified; shallow → harness-reported) | `MintedCredential.resolvedFrom` |
| broker refused it, group `sources: "vault"` | unsatisfied | declared | null — with the broker's `Blocker` |
| broker refused it, group `sources: "vault-or-local"`, and `alias ∈ LOCAL_PROBES` | as the local probe decides (below) | | |
| local probe ran and confirmed | satisfied | **verified** | `{source:"local", tool}` |
| local probe ran and found nothing | unsatisfied | declared | null, `preflight.login_missing` with the tool's login command as remedy |
| probe could not run (binary absent) | unsatisfied | declared | null, `preflight.login_tool_absent` |
| `login` need for a tool not in the table | deferred | declared | null |
| `asset` need present | satisfied | verified | null |

The local leg of the credential chain (prd-v2 §6.5 *explicit → vault →
ambient*) is entered **only** when the group says `vault-or-local`; the
broker never falls through on its own, and preflight never tries the local
probe for a `vault` group. A fallback is never silent: `run` prints
*resolved from your local `gh` login* for every local slot (§5.10).

### 5.6 The mint call

After §5.4, and only if no `Blocker` has been raised so far:

```
POST /v1/sessions
{ id: <uuid minted here>, provider: choices.provider.id,
  harness: choices.harness?.id ?? null,
  model: { provider: choices.model.provider.id, model: choices.model.model },
  aliases: [every credential slot's alias, model credential first] }
→ { credentials: MintedCredential[], slots: Slot[], blockers: Blocker[] }
```

Merge rule: the broker's `slots` **replace** preflight's credential slots
alias-for-alias (the broker's evidence and `resolvedFrom` are authoritative);
its `blockers` are appended; a non-empty `blockers` fails preflight —
**the broker's refusal is final** (I4), preflight never retries with a
different alias or grant. `credentials` are held in memory by the supervisor
and handed to the `credentials` enforcer (§5.7); they are never written to
the report, the session dir, or the environment. A network failure is
`preflight.api_unreachable` naming the URL.

### 5.7 Plan — the enforcers, in order

`plan := ENFORCERS.reduce((p, e) => e.plan(composed, choices, minted, p), EMPTY)`
(the four-argument `Enforcer.plan` of `00 §4.5`; `minted` is §5.6's result)
with `EMPTY = { hosts: [], deny: [], connectors: {}, filesystem: {allowWrite:
[], denyRead: [], denyWrite: []}, commands: [], env: {}, argv: [] }`. Each enforcer
receives the previous plan and returns a new object. **Tighten-only** is
checked by the runner after every step, not trusted: `hosts` may only shrink
or become `"any"` once (by `network`, from `EMPTY`); `deny`, `denyRead`,
`denyWrite` and `commands` may only grow; `allowWrite` is set once by `filesystem` and is
then frozen; `env` keys may be added, never changed; `argv` is set once by
`provider`. A violation is a bug → thrown, not a `Blocker`. Test:
`enforcers_never_widen`.

| # | Enforcer | Reads | Writes |
| --- | --- | --- | --- |
| 1 | `network` | every `MintedCredential`'s upstream host (from `connectors`, so it runs after `credentials` for host derivation — see note); `choices.model.endpoint`; `policy.boundaries` of kind `endpoint` covering this scope; `policy.reach` and `choices.harness` | `hosts` = the set of upstream hosts ∪ {model endpoint host}, port 443 only, and never `"any"` (01 D132); `deny` = boundary values, **always** (P5, D20: no endpoint boundary ⇒ `deny = []`, and `hosts` is still the derived list, never `[]`); `reach` = `effectiveReach(policy.reach, choices.harness)` — the one place that knows both the chain and the chosen harness, so the harness's own last narrowing step is taken here (01 D131) |
| 2 | `credentials` | the minted credentials; `policy.modelProviders`; `policy.groups`; `choices.model.wireFormat` | `connectors[alias] = { upstream, attach }` per minted alias, from the group entry that `MintedCredential.resolvedFrom` names (`entry.upstream`, `entry.attach` — `00 §4.3`; both are present by construction, 02 §7 step 11). The reserved alias `model` uses `choices.model.endpoint` as upstream, the model entry's `attach`, and carries `wireFormat`, which is what `shapeModelRequest` reads (05 D134) |
| 3 | `filesystem` | workspace path, `HARNESS_HOME`, session id, load set, `policy.boundaries` of kind `capability` and `filesystem`, `adapter.ambientStores()`, `adapter.denyWrite(ctx)` (directories) | `allowWrite`, `denyRead`, `denyWrite` per 06 §7 geometry. `denyRead` = credentials path + the standing deny set (06 §7.2) + **excluded tool dirs** + ambient stores + boundary `filesystem` values. Excluded tool dirs = every `assets/tool/<name>` present on disk whose id is not in the load set, or whose `tool.<name>` capability is denied by a covering `capability` boundary (C12, C13; fail closed on a directory with no sidecar) |
| 4 | `commands` | `policy.boundaries` of kind `command` covering this scope | `commands` = `{ id, pattern, reason }` per covering boundary, first occurrence of a pattern winning, so a pattern two nodes on the chain set is one refusal named by the node that set it first (W6-D9, D153). Nothing is enforced here and nothing can be: a command boundary is `intercepted`, which is the runtime's own veto (06 §13), and this row exists so that both adapters read it from the plan rather than filtering the composed policy for themselves — the road `deny` and `denyWrite` already travel |
| 5 | `environment` | core env (08 §7), `adapter.launch().env` | `env`; an adapter key colliding with a core key is thrown as a bug, not a `Blocker` (C6) |
| 6 | `provider` | `adapter.launch().argv`, argv passthrough after `--` | `argv` |

Ordering note: `network` needs the connector hosts, so the runner passes
enforcers in the order `credentials, network, commands, filesystem,
environment, provider`; the table is numbered by what each *means*, the code is ordered
by data dependency and says so in one comment.

Capability boundaries on built-ins (`filesystem.read`, `process.exec`,
`network.fetch`) are **advisory** here (C12): they are handed to the adapter
via `RenderContext.plan` for its own permission file and are never claimed
as enforced. `tool.<name>` is enforced by read geometry (C11).

### 5.8 Render and drift

After `plan` — for `run` and for `harness preflight` alike (a preflight
without render has no drift to report):

0. Before render: for every covering `capability` boundary `require:<concern>`
   (D13), `adapter.capabilities[concern] === "none"` →
   `adapter.unsupported_concern` (07 §12); render is not attempted.
1. `report := await adapter.render(ctx)`. Every `dropped` concern is printed
   once (*"Claude Code cannot do X; continuing without it"*) and recorded in
   the report's `blockers` with code `preflight.concern_dropped`, `passing`
   unaffected (D54). A dropped concern that a `require:` boundary names is
   impossible after step 0 and is treated as a bug if it occurs.
2. `actual := await adapter.rehydrate(ctx)`; `expected := Rehydrated` derived
   from `loaded` and `choices` — `skills` = loaded ids of kind `skill`;
   `prompts` = kind `prompt`; `instructions.system_prompt` and `.memory` =
   loaded ids of those kinds in 07 §4's order; `model` = `{ endpoint, model
   }` or `null` in native mode; `hooks` ⊇ the adapter's audit hook command;
   `denies` ⊇ `plan.filesystem.denyWrite`.
3. `drift := diffRehydrated(expected, actual)` — one `Drift` per field that
   differs, `file` = the generated file that carries it. Non-empty →
   `preflight.drift`, preflight fails.
4. Start the proxy (05; `00 §3` row 8) so the probes in §5.9 can reach it. On
   a failing report, or after a `harness preflight`, it is closed again.

This is a control against a **buggy adapter** — a render that silently
omitted a skill or pointed at the wrong endpoint — not against a hostile
person, who owns the machine (`00` I4). It is the "output validation"
prd-v2 §10.1 names.

### 5.9 Probes

Preflight runs three kinds itself and delegates two.

**Located binary** (run at Choose, §5.2). `located := await
adapter.locate(provider.pin)`; absent, below the floor, or the wrong pin →
`adapter.not_installed` / `adapter.below_min_version` /
`adapter.pin_mismatch` (07 §12) with the found and required versions.

**Local logins** — `LOCAL_PROBES`, data:

| tool | command | network? | verified when |
| --- | --- | --- | --- |
| `gh` | `gh auth status --hostname github.com` | no (reads the token store) | exit 0 |
| `aws` | `aws sts get-caller-identity --output json` | **yes** | exit 0 and `Arn` present |
| `az` | `az account show -o json` | no (cached token) | exit 0 |
| `gcloud` | `gcloud auth list --filter=status:ACTIVE --format=value(account)` | no | exit 0 and non-empty stdout |
| `supabase` | `supabase projects list -o json` | **yes** | exit 0 |
| `vault` | `vault token lookup -format=json` | **yes** | exit 0 |

Each probe runs **outside the jail** with a 5 s timeout and a
`{ HOME, PATH }`-only environment; the two network probes are skipped (slot
stays `declared`, not `verified`) when `--offline` is passed. A probe that
prints a token to stdout is a bug; none of these do.

**Delegated.** The sandbox self-test (06 §8) and `adapter.probe` (07 §5) run
under the exact profile the agent will get; both are called by `preflight()`
in that order after render and after the proxy is up. **Any unexpected
success aborts** (P9): a probe that expected `no route` and got a connection,
or expected `permission denied` on `~/.ssh` and read it, fails the boot with
`sandbox.probe_unexpected_success` (06 §10) naming the check. A probe is a
negative test run every launch.

### 5.10 Report

`passing := blockers.filter(b => b.code !== "preflight.concern_dropped").length === 0
&& drift.length === 0 && slots.every(s => s.state !== "unsatisfied")`.
Deferred slots do not block.

Written to `<sessionDir>/preflight.json` as the whole `PreflightReport`
**before** row 11 (C17, P6); `run` and `harness preflight` both write it.
Credential values never appear in it.

**`run` output.** Failing: one line per blocker — `message`, then `remedy`
indented, then `link` dimmed — nothing else. Passing: one line:
*Using your organization's model: anthropic/claude-sonnet-5 · 3 credentials
from Marketing (1 from your local gh login) · allow-list, 2 hosts.* The last
clause is the plan's reach in the person's words: *off — only the hosts this
session holds a credential for* · *allow-list, n hosts* · *on — anything but
n denied hosts* (01 D131).
Native mode: *No organization model for this session — using your own
sign-in · not metered.*

**`preflight` output.** The same report rendered in sections, plain words
first, `--json` for the raw report:

| Section | Shows |
| --- | --- |
| identity | chain as `org › team › you`, role, api url |
| harness | card, or *none selected — everything you have is loaded*; `n` ids, `m` of them resolve to nothing |
| provider | id, approval, located path and version, pin |
| model | provider, model, wire format, endpoint; how chosen (harness / provider / team default, or your override) |
| credentials | one row per slot: alias · state · evidence · resolved from (group name and vault, or *your local gh login*) |
| reach | the mode in words and who set it (`plan.reach.setBy`), the credentialed hosts, and the `deny` list in full, each with its boundary's reason |
| files | load set grouped by kind, each with owner (`org` / `team` / `you`) and id short form; excluded tool dirs |
| drift | each `Drift` as *file · expected · actual* |
| blockers | as `run` prints them |

Every line that reports an enforcement labels it `enforced` / `advisory`
(C4); nothing prints a checkmark it did not earn.

## 6. What this replaces — the mapping

**D9 — `boundary.model_policy` is retired.** Do not re-add it; each field is
already expressed:

| `model_policy` field | Now |
| --- | --- |
| `source: "none"` | no model provider in `approvedFor` for this scope → `preflight.model_none_approved` |
| `source: "proxied"` | a model provider with `credential` set, minted through a group |
| `source: "gateway"` | a model provider with no `credential` |
| `user_credentials: "forbidden"` | the model credential's group has `sources: "vault"` |
| `user_credentials: "allowed"` | `sources: "vault-or-local"` |
| `user_credentials: "required"` | native mode: no key reaches the model alias; the adapter's `model_native` concern is used, for a provider on its own `modelNative` list (W7-D2, 07 §6). `choose()` sets `native` when no covering grant supplies the alias **or** the provider names none at all — W7-D2 retired the old *gateway mode is never native* clause, because W6-D6 had already retired the keyless gateway provider — and `preflight.ts` keeps it only where the adapter can sign in to *that* provider, so the boot line's *your own sign-in · not metered* is never printed over a session the broker refuses (04 §5.3 step 5, D156) |

**D22** — `boundary.allowed_agents` and `agent.allowlist` are retired;
`HarnessProvider.approval` + `scope` is the one model (§5.2 steps 2–3).

**D23** — preference `mode: suggested | absolute` is retired; its one hard
rule survives as §5.2 step 6: the model default is never absolute, and a
person may change model mid-session within `approvedFor`.

## 7. Failure modes

Codes are unique across the engine. `compose.*` codes are raised by 01 and
surfaced here unchanged.

| Code | Message (shape) | Remedy |
| --- | --- | --- |
| `preflight.provider_unknown` | *"`<word>` is not a runtime your organization has listed. Listed: pi, claude."* — distinct from 08's `cli.provider_unknown`, which fires before any I/O when the word matches no adapter at all | `harness run pi` |
| `preflight.provider_ambiguous` | *"Say which runtime: pi, claude."* | as above |
| `preflight.provider_not_approved` | *"<name> is not approved for use: <reason>."* | link: Providers screen |
| `preflight.provider_beta` | *"<name> is in beta; only an admin may be handed credentials with it."* | *Ask an admin to approve it, or run an approved runtime.* |
| `preflight.provider_out_of_scope` | *"<name> is approved for <teams>, not for <your team>."* | link: Providers screen |
| `preflight.harness_unknown` | *"No harness called `<flag>`. You have: …"* | `harness switch` |
| `preflight.harness_ambiguous` | *"`<flag>` names more than one harness: acme.marketing/Support, acme.support/Support."* | `harness run --acme.marketing/Support` |
| `preflight.harness_gone` | *"Your harness `<name>` no longer exists, or is no longer shared with you."* | `harness switch` (selection file already deleted) |
| `preflight.asset_missing` | *"<harness> names an asset that nothing on your chain provides."* | link: the harness in the console |
| `preflight.asset_needed` | *"<A> needs <B>, which is not in this harness."* | *Add <B> to <harness>, or remove <A>.* |
| `preflight.no_compatible_group` | *"<team> holds no group with an entry for `<alias>`."* | *Ask a <team> admin to narrow one into the sub-team.* / *Ask an organization admin to grant …* |
| `preflight.ambiguous_group` | *"Two grants of equal scope hold `<alias>`: <g1>, <g2>."* | link: Security groups |
| `preflight.asset_format` | *"<asset> needs the <fmt> format, and <provider> exposes <fmts>."* | *Drop it from this harness, or route through a provider exposing <fmt>.* link: the asset |
| `preflight.model_none_approved` | *"No model provider is approved for <team>."* | link: Model providers |
| `preflight.model_no_default` | *"No model provider is the default for <harness/provider/team>."* | link: Model providers |
| `preflight.model_default_not_approved` | *"<mp> is the default here but is not approved for <team>."* | link: Model providers |
| `preflight.model_not_approved` | *"<mp> is not approved for <team>. Approved: …"* | `--model <one of them>` |
| `preflight.model_unknown` | *"<mp> lists no model called `<id>`."* | list |
| `preflight.format_mismatch` | *"<runtime> speaks <fmts>, but <mp> exposes <fmts>."* | *Route <harness> through a provider exposing <fmt>, or run a runtime that speaks <fmt>.* |
| `preflight.login_missing` | *"No `<tool>` login on this machine."* | the tool's login command, e.g. `gh auth login` |
| `preflight.login_tool_absent` | *"`<tool>` is not installed, so its login cannot be checked."* | install hint |
| `preflight.drift` | *"<file> does not match the plan: <field> expected <x>, got <y>."* | *This is a bug in the <runtime> adapter; report it with `harness preflight --json`.* |
| `preflight.api_unreachable` | *"Could not reach the Harness API at <url>."* | *Is it running? `harness preflight identity`.* |
| `preflight.concern_dropped` | informational: *"<runtime> cannot do <concern>; continuing without it."* — does not fail | — |
| `adapter.not_installed` / `adapter.below_min_version` / `adapter.pin_mismatch` / `adapter.unsupported_concern` | 07 §12, surfaced verbatim | |
| `sandbox.probe_unexpected_success` | 06 §10, surfaced verbatim | |
| `broker.*` | 04 §9, surfaced verbatim | |
| `compose.*` | 01 §9, surfaced verbatim | |

## 8. Tests

| Tier | Name | Asserts |
| --- | --- | --- |
| T1 | `covers_matches_prd_scoping_table` | every row of the shared fixture table (02, 04 run the same file) |
| T1 | `choose_refuses_not_approved` | `not-approved` → blocker with reason; nothing else evaluated |
| T1 | `beta_requires_admin` | `beta` + member → blocker; `beta` + team-admin → passes |
| T1 | `choose_prefers_harness_default_then_provider_then_team` | D8 precedence over a routing fixture |
| T1 | `model_override_within_approved_stands` | D23 |
| T1 | `format_mismatch_names_both_sides` | message contains both format lists |
| T1 | `harness_flag_never_writes_selection` | selection file untouched after a `--flag` run |
| T1 | `harness_gone_deletes_selection_and_refuses` | |
| T1 | `loadset_includes_always_loaded_in_empty_harness` | |
| T1 | `missing_assigned_id_is_a_slot_not_dropped` | P8 |
| T1 | `no_compatible_group_names_the_admin_action` | exact PRD sentence for a sub-team and for a top-level team |
| T1 | `narrowest_grant_wins_and_tie_is_ambiguous` | specificity ordering; equal → `ambiguous-group` |
| T1 | `narrowed_grant_only_offers_kept_aliases` | `narrowedFrom.aliases` respected |
| T1 | `local_leg_only_for_vault_or_local` | a `vault` group never reaches the local probe |
| T1 | `enforcers_never_widen` | random enforcer orderings; runner throws on any widening, `reach` included — a mode that moves back up `on` → `allow` → `off`, or a list that loosens |
| T1 | `absent_boundary_is_not_empty_hosts` | no endpoint boundary → `hosts` = derived list, `deny = []` |
| T1 | `reach_on_leaves_hosts_derived_with_deny_still_applied` | `hosts` is never `"any"`; the deny list holds whatever reach says |
| T1 | `the_harness_takes_the_last_narrowing_step` | a harness narrows `reach` and `setBy` becomes `harness:<id>`; one that widens is ignored |
| T1 | `excluded_tool_dirs_fail_closed_without_sidecar` | |
| T1 | `drift_fails_preflight` | one field differs → `preflight.drift` |
| T1 | `nothing_rounds_up` | a slot with no probe run stays `declared` |
| T2 | `report_written_before_spawn` | `preflight.json` exists and is complete when the spawn stub is reached; also on failure |
| T3 | `local_probe_env_is_home_and_path_only` | spawned probe sees no other variables |
| T3 | `unexpected_probe_success_aborts` | a stubbed delegated probe returning success where failure was expected → `sandbox.probe_unexpected_success` |
| T3 | `broker_refusal_is_final` | mocked `POST /v1/sessions` with a blocker → no retry, no spawn |
| T4 | `mint_replaces_slots_alias_for_alias` | against `api` in a scratch DB |

## 9. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D50 | The beta check reads `role` from `/v1/me`; the broker is authoritative (I4). | dropping the CLI check; the error gets worse, nothing else changes |
| D51 | Among compatible groups the narrowest grant wins; an exact tie refuses. | preferring the first grant in declaration order — rejected: declaration order is invisible to the person |
| D52 | The local leg of the credential chain is entered only for `vault-or-local` groups and only after the broker refused the vault. | letting the CLI probe first — rejected: it would make a fallback silent (prd-v2 §6.5) |
| D53 | Two local probes (`aws`, `supabase`, `vault`) use the network; `--offline` skips them and leaves `declared`. | making them all offline — not possible for those tools |
| D54 | `preflight.concern_dropped` is a non-failing blocker in the report so `harness preflight` shows it; a concern fails the boot only when a `require:<concern>` boundary names it (§5.8 step 0). | failing on any drop — rejected: it would make every `none` concern fatal even where no policy asked for it |
| D55 | `harness preflight` is `preflight({spawn:false})`, not a separate reader of files; it renders and starts the proxy so drift and the sandbox probes are real, then closes the proxy. | a separate implementation — rejected (`10` rule 2) |
| D56 | Capability boundaries on built-ins are passed to the adapter and labelled advisory; not claimed. | none; C4 |

## 10. Out of scope

- Exit reconciliation and needs grown from observed use (prd-v2 §10.3, Later).
- Budgets and rate limits.
- Any interactive prompt: preflight never asks; it refuses with a remedy.

## 11. Definition of done

- `engine/cli/src/preflight/` exists with the files in §4, under 500 source lines.
- `model.ts`, `assetsByKind`, `grantedCapabilities`, `toolIsGranted`, `deniedToolDirs` and their tests are deleted in the same change.
- Every code in §7 has a test that produces it and asserts its message and remedy.
- Every test in §8 exists by name and passes on macOS and Linux CI.
- `harness preflight` and `harness run` share one `preflight()` call; `preflight --json` emits a `PreflightReport` that validates against `00 §4.7`.
- `preflight.json` is written on every run, passing or failing, before any spawn.
- No credential value appears in the report, the session directory, or the child environment (negative test at T3).
