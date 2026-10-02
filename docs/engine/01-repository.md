# Engine Plan — 01 · The repository

The definition plane on disk: how an organisation's branches are laid out on
the server, how the person's clone mirrors them, what a sidecar is, how
`compose()` turns a chain of refs into one effective set, and how the work
tree is materialised and pushed back without ever committing more than the
person's own changes.

## 1. Purpose

Everything the engine loads is a file on a branch. This document is the one
place that says which files, on which branches, with which names — and the
one algorithm that reads them. `02-definitions-service.md` serves and guards
these branches; `03-preflight.md` consumes `Composed`; `08-supervisor-and-cli.md`
drives the commands. Nothing else may know the layout.

## 2. Invariants it upholds

| From 00 | Here |
| --- | --- |
| I1 definitions are git | every file in §4 is content on a ref; no definition is fetched any other way |
| I2 composed by precedence, never merged | §6 walks the chain and picks per id; no `git merge` appears in this document |
| I6 declared / observed / derived | `versions.json` records where each key came from and what it shadows |
| C13 a harness only takes away | a `HarnessDef` names ids; §6 step 11 never lets one reach an id the chain did not resolve |
| C14 hydrate the full set, then filter | the subscription (§8) is per person, never per session; render filters |
| C15 an override keeps the id | D3 rules in §5; tests `override_keeps_id`, `new_id_at_existing_path_is_refused` |
| C30 the git flags | §7.1; every invocation goes through one helper |
| C31 push commits to the user's branch; only hydration moves `refs/harness/remote` | §7.3, §7.4 |
| C32 absent is not empty | a chain with no `policy/boundaries.json` composes to `boundaries: []` *and* no endpoint boundary; the proxy (05) reads the derived list, never an empty allowlist |
| C37 a kind is one line of data | `policy/kinds.json` |

## 3. Contracts used

From `00 §4`, by name: `Chain`, `ChainNode`, `Sidecar`, `Need`, `AssetKind`,
`ComposedAsset`, `Conflict`, `Scope`, `SecurityGroup`, `SecretRef`, `Grant`,
`Boundary`, `WireFormat`, `ModelProvider`, `HarnessProvider`, `Routing`,
`HarnessDef`, `EffectivePolicy`, `Composed`, `Blocker`.

`Reader` is `00 §4.4`: `ls(commit, dir)` (entries with mode and oid; an
absent directory lists as `[]`), `cat(oid)`, `write(bytes)`, `mktree(entries)`
— four thin wrappers over `ls-tree`, `cat-file --batch`, `hash-object -w` and
`mktree`. The CLI implements it in `git.ts` over `~/.harness/assets.git`
(§7.2); `definitions` implements it over the bare repo (02 §4). Every "read
`<path>`" below is `ls` the containing directory, then `cat` the entry's oid.
The `Conflict` variants `malformed` and `invalid-grant` this document reports
are in `00 §4.2`.

## 4. On disk

### 4.1 The server repo — one per organisation

```
refs/heads/org                       the root. Policy lives here and nowhere else.
refs/heads/teams/<dotted-path>       one per team, e.g. refs/heads/teams/acme.marketing.interns
refs/heads/users/<user-id>           one per person; <user-id> is the auth user uuid
```

The dotted path is `ChainNode.path`. Git accepts it (single dots, no `..`,
no `.lock` suffix); `definitions` refuses a team name that would violate a
ref rule at creation time, which is the only place a name enters.

**A branch starts as an empty tree with no parent.**

```
git hash-object -t tree /dev/null                       → 4b825dc…  (the empty tree)
git commit-tree 4b825dc… -m "branch <path>"             → C0        (no -p)
git update-ref refs/heads/<…> C0
```

Not forked from its parent: a forked branch would carry the parent's files
as its own content, so ownership would be unreadable from the tree and
every later parent change would look like divergence. With an empty root a
branch's `git log` is exactly that node's own history, which is what
`prd-v2.md` §19's change log shows. Composition supplies inheritance (I2).

### 4.2 Directory layout on a branch

```
assets/<kind>/<name>/asset.json      the Sidecar — required; the directory is the asset
assets/<kind>/<name>/…               the asset's files, any shape the kind wants
policy/boundaries.json               Boundary[]                     any node
policy/reach.json                    Reach                          any node (D131) — org sets it, teams narrow it
policy/grants.json                   Grant[]                        org: grants; team: narrowed grants only
policy/groups.json                   SecurityGroup[]                org only
policy/harness-providers.json        HarnessProvider[]              org only
policy/model-providers.json          ModelProvider[]                org only
policy/routing.json                  Routing                        org only
policy/kinds.json                    AssetKind[]                    org only
policy/always-loaded.json            { required[], recommended[] }  org only  (prd-v2 §5.2, W5-D10)
harnesses/<harness-id>.json          HarnessDef                     the owning node
```

`always-loaded.json` is **two lists** (W5-D10):

```json
{ "required": ["<asset id>", "…"], "recommended": ["<asset id>", "…"] }
```

A **required** id is in every session's load set whatever the harness says
(03 §5.3), cannot be removed from a harness (`cli.asset_required`, 08 §10.0)
and cannot be deleted (`asset.required`). A **recommended** id is copied into
a new harness's `assets` at creation — `harness new` and `POST /v1/harnesses`
— and is an ordinary entry of that harness from then on, which the person may
take out again. An id on both lists is required; the stronger state wins.
Both lists name organisation assets only, by the same step-12 rule.

A **bare array** is still accepted and reads as `required` everywhere it is
read — compose, the definitions indexer (which normalises it into the object
shape on its way into `idx_policy`), `console_index`, `routes_writes`. That
is the shape every organisation seeded before W5-D10 holds, and the first
write to the file leaves the object shape behind.

It starts non-empty: every organisation is seeded with D30j's built-in
`harness-authoring` skill at `assets/skill/harness-authoring/`, so its id
`0460b220-8379-5ddf-82ef-31bc0e8a99e1` is **required** from the first commit,
and with the default brief at `assets/system_prompt/harness/`
(`7b1f5c94-2d0a-5e63-9c18-4a6d3f0b28c7`, W5-D11), which is **recommended**.

`policy/reach.json` is **`{ mode, hosts }`** and is per node, like
`boundaries.json` — not org-only. `allow` makes `hosts` the allow-list, `on`
makes it the deny-list, `off` ignores it; absent everywhere is `off`. The
organisation's file starts the walk and each team below may only narrow it
(D131): move `on` → `allow` → `off`, take a host off an allow-list, add one
to a deny-list. A step that widens is a `reach-widened` conflict, refused at
pre-receive as `definitions.reach_widens`, and the parent stands. A
`HarnessDef` may carry a `reach` of the same shape as one last step; the
value the session gets is `effectiveReach(policy.reach, harness)`.

**The reach grant is retired** (D132). `Grant.reach: "outside-endpoints"` was
the old answer and is gone: a grant is a security group and nothing else. A
branch that still holds one composes to a `reach-grant-retired` conflict and
the push that would carry it is refused with
`definitions.reach_grant_retired` — which means an organisation upgrading
across this change removes its reach grants before it can push again, and
until it does, every session on that chain refuses at row 2 with the same
conflict. That is deliberate: a grant that silently stopped meaning anything
would be worse than one that says so. The examples below are written without
one, and the seed writes none.

Three provider files rather than one: each is edited by one console screen,
so a change is one commit touching one file and lands in one log row
(`prd-v2.md` §19). Anything under `policy/` on a `users/…` branch, and
anything org-only on a team branch, is refused at pre-receive (02) and
reported as `malformed` at compose.

**Where the first version of each of these files comes from: `engine/compose/presets/`,
and nowhere else** (D146). It is the one home of a default, and
`presets/index.json` is its manifest. A default that is not in the manifest
does not exist; a file under `presets/` that no entry names is a finding of
`scripts/check-defaults.py`. Each entry says what the default is (`path` — a
JSON file, or an `assets/<kind>/<name>/` directory), **how it is managed**, and
which console screen manages it (`screen`, a route segment under
`web/app/(console)/console/[scope]/`, with the `verbs` that screen offers):

| `managed` | Seeded? | Who owns it afterwards |
| --- | --- | --- |
| `required` | yes, into every organisation | nobody may remove it — the harness cannot run without it (§4.4) |
| `recommended` | yes, into every new organisation | the organisation, wholly: create, read, update and delete all exist on the screen the entry names |
| `suggested` | **no** | nobody yet — the screen offers each item as a one-click add |

`seed.py` walks the manifest: every `required` and `recommended` entry lands at
`policy/<its file name>` or as its asset directory, and the seed names no
preset file. Four policy files are in no entry because they hold no default —
`routing.json`, `groups.json` and `grants.json` are the empty shape a branch
carries, and `always-loaded.json` is derived from the asset entries' `managed`
words (W5-D10's two lists are `required` and `recommended`, the same two).

**One indirection, and only one**: a value in a preset spelled `@<entry id>` is
that entry's file, read by the seed. It existed so `reach-default-personal.json`
could be `{ "mode": "allow", "hosts": "@reach-suggested" }` — D135's default was
the suggested list with a mode, and a hand-copied second list would have drifted
from the first. **No preset uses it today** (D155 made the personal default
`{ "mode": "on", "hosts": [] }`), and it stays anyway: the seed resolves it,
`check-defaults.py` still refuses an `@` naming no entry, and the next default
that *is* another entry with a field on it says so rather than copying it.
`reach-suggested.json` itself stays a plain array, which is the shape the
Boundaries screen offers and `hosts` takes.

The two reach defaults are D135 made data: `reach-default-personal.json` and
`reach-default-enterprise.json`, and the edition picks which one is written as
`policy/reach.json`. **D135 — the wave-5 plan's decision 1c — is amended by W7-D4 / D155**: the personal
default is `on` with an empty deny-list, not the suggested allow-list. The
reason is the first-harness modal's *Web access* switch. Reach only ever
narrows, so a harness can turn web access **off** under an `on` organisation
and cannot turn it on at all; under an `allow` organisation `off` is still
reachable but the switch's other position would be a `reach-widened` conflict,
and the suggested list would be the thing a hobby user had to understand before
their first harness. So the organisation says *everything, nothing denied* and
the harness says *this one, nothing*. The enterprise default is unchanged
(`off`), and the suggested list is unchanged: it is what Boundaries → Reach
offers as one-click adds, which is where an allow-list gets built. Their `screen`, and `reach-suggested.json`'s, is
`boundaries/reach` — W6-D8 made Reach a tab of its own and the three entries
were repointed at it, which is what the checker testing a directory rather
than a sentence is for.

`command-boundaries.json` is the second `suggested` entry (W6-D10, D154): the
command lines most organisations never want run — the system and home wipes,
a download piped into a shell, a force push, the shell history turned off —
each with the `reason` whoever hits it will read and `holds: "intercepted"`,
which is the only word a command boundary can have (06 §13). It is **never
seeded**: a default that denies something is a decision, and the organisation
makes it on Boundaries → Commands, where each entry is one click.

Examples, each valid against `00 §4`:

`assets/tool/deploy/asset.json`
```json
{ "id": "6f1c9a2e-3b0d-4c7e-9a51-2f0e8b7d4c11", "kind": "tool",
  "needs": [{ "kind": "credential", "alias": "deploy-key" }, { "kind": "login", "tool": "gh" }] }
```

`assets/memory/never-drop-db/asset.json` (a memory is a directory holding one `.md`, as today)
```json
{ "id": "0b7e4d2a-9c31-4f8e-b6a2-51d3c7e9f0a4", "kind": "memory" }
```

`policy/kinds.json`
```json
["skill", "memory", "tool", "prompt", "system_prompt", "connection"]
```

`policy/groups.json` — every entry names the secret, the origin it is used at, and how it is attached (`00 §4.3`; the proxy needs all three, 05 §6)
```json
[{ "name": "marketing",
   "entries": [{ "alias": "crm",   "secret": { "vault": "aws-prod", "ref": "marketing/crm-api-key" },
                 "upstream": "https://api.crm.example",   "attach": { "header": "Authorization", "prefix": "Bearer " } },
               { "alias": "email", "secret": { "vault": "aws-prod", "ref": "marketing/sendgrid" },
                 "upstream": "https://api.sendgrid.com",  "attach": { "header": "Authorization", "prefix": "Bearer " } }],
   "sources": "vault",
   "mint": { "role_arn": "arn:aws:iam::123456789012:role/harness-marketing", "duration_seconds": 3600 } }]
```

`secret.vault` names a key vault `api` has connected (04 §7); it is not
validated at push — an unknown vault is refused at mint (`broker.vault_unknown`).

`policy/grants.json` on `org`
```json
[{ "id": "g-marketing",  "scope": { "teams": ["acme.marketing"] },              "group": "marketing",          "by": "dana@acme.co" },
 { "id": "g-crm-eng",    "scope": { "teams": ["acme.eng"], "harnesses": ["8c…"] }, "group": "marketing", "by": "dana@acme.co" }]
```

`policy/grants.json` on `teams/acme.marketing` — a narrowed grant, the only kind a team branch may hold
```json
[{ "id": "g-interns-crm", "scope": { "teams": ["acme.marketing.interns"] }, "group": "marketing",
   "narrowedFrom": { "grant": "g-marketing", "aliases": ["crm"] }, "by": "rae@acme.co" }]
```

`policy/reach.json` on `org`, then on `teams/acme.marketing` — the second only narrows the first
```json
{ "mode": "on",    "hosts": ["competitor-crm.com"] }
{ "mode": "allow", "hosts": ["pypi.org", "files.pythonhosted.org", "*.githubusercontent.com"] }
```

`policy/boundaries.json` on `teams/acme.marketing`
```json
[{ "id": "no-competitor-crm", "scope": { "teams": "all" }, "kind": "endpoint",
   "value": "competitor-crm.com", "holds": "enforced", "reason": "Contract clause 4.2." }]
```

`policy/model-providers.json`
```json
[{ "id": "anthropic",   "endpoints": { "anthropic-messages": "https://api.anthropic.com" },
   "models": ["claude-opus-5", "claude-sonnet-5"], "credential": { "alias": "anthropic-key" } },
 { "id": "openrouter",  "endpoints": { "anthropic-messages": "https://openrouter.ai/api",
                                       "openai-completions": "https://openrouter.ai/api/v1" },
   "models": ["anthropic/claude-sonnet-5"], "credential": { "alias": "openrouter-key" } }]
```

`policy/harness-providers.json`
```json
[{ "id": "pi",     "approval": "approved", "scope": { "teams": "all" },
   "pin": { "repo": "https://github.com/…/pi", "commit": "60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759" },
   "speaks": ["openai-completions", "anthropic-messages"] },
 { "id": "claude", "approval": "beta",     "scope": { "teams": ["acme.eng"] },
   "pin": { "binary": "claude", "minVersion": "2.1.275" }, "speaks": ["anthropic-messages"],
   "reason": "Reviewing 2.1.x permission changes." }]
```

`policy/routing.json`
```json
{ "defaultFor":  { "teams": { "acme": "anthropic" }, "harnesses": {}, "providers": {} },
  "approvedFor": { "teams": { "acme": ["anthropic", "openrouter"] }, "harnesses": {}, "providers": { "claude": ["anthropic"] } } }
```

`harnesses/3e9d…​.json` on `teams/acme.marketing`
```json
{ "id": "3e9d0f6a-1b2c-4d5e-8f70-9a1b2c3d4e5f", "name": "Campaign drafts",
  "description": "Weekly campaign copy.", "icon": { "palette": ["#c8875a"], "rows": ["................", "…"] },
  "assets": ["6f1c9a2e-3b0d-4c7e-9a51-2f0e8b7d4c11", "0b7e4d2a-9c31-4f8e-b6a2-51d3c7e9f0a4"] }
```

### 4.3 The person's clone

```
~/.config/harness/credentials.json   the login token. 0600. Deny-read in the jail. Unchanged.
~/.harness/
  assets/                            the WORK TREE  = the composed set, materialised per §8. Agent-writable.
    <kind>/<name>/…                  note: no assets/ prefix — the work tree root is the branch's assets/ directory
    versions.json                    written by hydration (§7.5)
  assets.git/                        the GIT DIR. Not writable in the jail. Now a real clone:
    refs/remotes/origin/org          … teams/<path> … users/<id>    exactly what definitions advertised
    refs/heads/main                  the person's branch; tracks refs/remotes/origin/users/<id>
    refs/harness/remote              the last composed tree, as asset-sync §3.2. Only hydration moves it.
  harness.json                       the selection (C16). Unchanged.
  sessions/<id>/                     ephemeral. Unchanged.
```

`origin` is `https://<definitions-host>/<org>.git`. **The token is never
written into `assets.git/config`** — reads inside the jail are allow-by-
default (C27), so a stored token would be a credential in reach. It is
passed per invocation as `-c http.extraHeader=Authorization: Bearer <token>`
and appears in no file.

### 4.4 The harness OS

`managed: required` is the complete list of what the product cannot run
without. It is short on purpose, it is the one thing an organisation may not
remove, and every entry on it is here with the sentence that says why
(W6-D1, D147).

| Entry | What it is | Why nothing works without it |
| --- | --- | --- |
| `kinds` → `policy/kinds.json` | the asset kinds, as `AssetKind[]` | the kind is the sidecar's one required claim (§5 rule 2) and both adapters render **only the kinds they know** — a kind that is on no list is `unknown-kind` at compose, so an organisation with no `kinds.json` has no assets it can deliver |
| `asset:harness-authoring` → `assets/skill/harness-authoring/` | D30j's built-in skill, `required` on `always-loaded.json` | it is how a person makes or extracts an asset; without it the first session can use the product but cannot extend it, and every *write me a skill* answer would be a guess at our own file layout |

Everything else is `recommended` or `suggested`, which is to say: the
organisation's. The two runtimes' **identities** — their pins, what they speak
and their names (D148) — ship in `harness-providers.json` and are not
negotiable facts about Pi and Claude Code, but the *row* is `recommended`,
because whether a runtime is approved, for whom, and whether the row exists at
all is the organisation's decision and nobody else's (prd-v2 §9.1).

A default added to the `required` list without a sentence in this table is a
finding of `scripts/check-defaults.py`, which is the point: *required* is a
claim about the product, so it is made here, in prose, once.

## 5. The sidecar

`asset.json` is the identity. Rules, enforced at pre-receive (02 §5) and
again at compose (§6 step 4), because git carries whatever a file claims
(`prd-v2.md` §4.1):

1. Present in every `assets/<kind>/<name>/` directory. A directory without
   one is not an asset; compose reports `malformed`.
2. `id` is a lowercase RFC 4122 uuid. `kind` equals the `<kind>` directory
   segment and is in `policy/kinds.json`. `needs`, if present, is an array
   of `Need`. `format`, if present, is a `WireFormat`. `description`, if
   present, is a string — shown on the organisation assets row and written by
   `PATCH /v1/assets/{id}` (console 00 §4.11, WS3a), the one other field the
   sidecar carries. Unknown keys are refused — a sidecar is not a place for a
   kind's own metadata.

   A `tool` may name the environment it runs in:
   `needs: [{ "kind": "environment", "name": "python-data" }]` (W5-D15).
   Compose neither resolves it nor adds anything to a set — it is carried
   through verbatim, like every other `Need` the chain does not answer. The
   one reader is the console's store (console 04 §12) and the write behind
   it: ticking the tool ticks the environment of that name, and the
   confirmation says why. It is a `Need` and not a key of its own because
   `needs` is already the list of what an asset cannot run without, and a
   fourth variant costs one line where a second key would cost a shape.
3. **One id appears at most once on one branch.** Twice is
   `duplicate-id-on-one-branch`.
4. **The same path on two branches with different ids is a conflict**, never
   an override. Same path, same id: an override; the narrower wins. Same id,
   a different path: a rename; subscription follows the id and the composed
   tree uses the narrower name.
5. **An override keeps the id (D3).** The person edits files in a delivered
   directory; the sidecar is one of those files and is left alone. `push`
   (§7.3) refuses if the sidecar's id differs from the id the composed set
   holds at that path. New assets get an id from `adopt` or `new` (08), which
   are the only two places an id is ever minted on a person's machine.

Tests (T2, `engine/compose/test/sidecar.test.ts`): `override_keeps_id` —
edit a delivered tool's `run`, push, compose: same id, `from` is the user
node, `shadows.from` is the team. `new_id_at_existing_path_is_refused` — a
directory at `tool/deploy` with a fresh id while `teams/…` holds `tool/deploy`:
compose reports `same-path-different-id`; the CLI's push refuses before the
network. `rename_follows_id` — the team renames `tool/deploy` →
`tool/ship` keeping the id: a person whose harness names the id gets
`tool/ship`, and `versions.json` shows the key moved.

## 6. `compose(chain, read): Composed`

Pure given a `Reader`. Deterministic: the same commits produce the same
`Composed` and the same `tree` oid, because every list is sorted and every
tree is built from sorted entries. Cost: one `ls` per `assets/<kind>/` per
node, one `cat` per sidecar and policy file; O(assets across the chain).

1. **Validate the chain.** Non-empty; `chain[0].kind === "org"`;
   `chain[at(-1)].kind === "user"`; each `path` extends the previous by one
   dotted segment. Otherwise return no assets and one `malformed` conflict
   with `path: "<chain>"`.
2. **Read org policy** from `chain[0].commit`: `kinds`, `groups`,
   `harness-providers`, `model-providers`, `routing`, `always-loaded`. Each
   file is optional except `kinds.json`; a missing optional file is `[]` /
   `{}` (C32 — absent is not a policy). A file that fails to parse or
   validate against `00 §4.3` is a `malformed` conflict and is treated as
   absent for the rest of the walk.
3. **Per node, root first:** `ls(commit, "assets")` → kinds present; for each
   kind `ls(commit, "assets/<kind>")` → asset directories with their tree
   oids; `cat` each `asset.json`. Also `cat` `policy/boundaries.json`,
   `policy/grants.json`, and `ls(commit, "harnesses")` → each `HarnessDef`.
   On a `users/…` node, any `policy/` file is `malformed` and ignored.
4. **Validate sidecars** per §5 rule 2. A kind not in `kinds` →
   `unknown-kind`; a malformed sidecar → `malformed`. The directory is
   skipped. Within one node, a repeated id → `duplicate-id-on-one-branch`;
   all but the first occurrence (by path order) are skipped.
5. **Precedence by id.** Maintain `byId: Map<id, ComposedAsset[]>` in chain
   order. The winner is the last entry (narrowest). `shadows` is the entry
   before it, if any: `{ from, tree }`.
6. **Path conflicts.** Maintain `byPath: Map<"<kind>/<name>", Set<id>>`
   across nodes. A path claimed by two ids → `same-path-different-id`; the
   narrower claimant is dropped from `assets` (fail closed: nothing at that
   path resolves) and both ids are named in the conflict.
7. **Boundaries.** Concatenate every node's list, rewriting each `id` to
   `"<node.path>/<id>"` so the source is legible; union is the only
   operation. Order: root first, then file order.
8. **Grants.** Start with the org's `grants.json`. Every grant on a *team*
   node must carry `narrowedFrom`; one without it is `invalid-grant`
   ("a team may only narrow").
9. **Validate a narrowed grant** on node N against the grants accumulated so
   far: (a) `narrowedFrom.grant` exists; (b) the source grant's scope covers
   N — `teams` is `"all"` or contains N's path or an ancestor of it; (c) the
   narrowed `scope.teams` is a list whose every entry starts with `N.path + "."`
   (inside N's subtree) and its `harnesses`, if any, is a subset of the
   source's when the source names any; (d) the source grant names a `group`
   (reach grants cannot be narrowed by alias) and `narrowedFrom.aliases` is a
   non-empty subset of that group's entry aliases; (e) the narrowed grant's
   `group` equals the source's. Any failure: `invalid-grant` with `why`
   naming the clause, and the grant is dropped. A valid one is appended.
   *This is `prd-v2.md` §6.4 as arithmetic.*
10. **Effective entries for a narrowed grant** are the source group's entries
    filtered to `narrowedFrom.aliases`. Compose does not materialise a new
    `SecurityGroup`; the consumer (03) applies the filter when it walks
    grants, so a group has one definition (I2 applied to credentials).
10a. **Reach** (D131), per node, root first, beside boundaries and grants.
    The organisation's `policy/reach.json` *is* the start of the walk:
    `{ mode, hosts, setBy: org.path }`, or `{ mode: "off", hosts: [], setBy:
    org.path }` when it holds none. Each team node below may only narrow it —
    move down `on` → `allow` → `off`, drop a host from an allow-list, add one
    to a deny-list, and never name on an allow-list a host the parent denies.
    Anything else is `reach-widened` naming the node, and the parent stands.
    A step that restates what it inherits narrows nothing, so `setBy` still
    names the node a person has to ask. A grant carrying the retired
    `reach: "outside-endpoints"` is `reach-grant-retired`, is not a grant, and
    is dropped (D132).
10b. **A harness's own step**, after the node walk, when the chain's reach is
    final: every `HarnessDef` carrying `reach` is checked by the same rule and
    a widening one is `reach-widened` naming `harness:<id>`. The *value* is not
    stored — `EffectivePolicy.reach` is one reach and a chain has many
    harnesses — so a session applies it with `effectiveReach(policy.reach,
    harness)` (03 §5.7 row 1) and compose reports only the fault.
11. **Harnesses.** Collect every `HarnessDef` from every node. Ids in
    `assets` that resolve to nothing are kept (C18); ids that resolve to a
    dropped conflict are kept too — preflight reports them.
12. **Required and recommended.** `always-loaded.json` ids — on **either**
    list — must be assets whose winning copy is on the org node; any other id
    → `malformed` naming the file, and the id is dropped from that list. A
    bare array is read as `required` (W5-D10). An id on both lists is
    required only.
13. **`versions.json`.** One entry per winning asset (§7.5), keys sorted.
    `write()` it → `versionsOid`.
14. **The composed tree.** For each kind, `mktree` of `{ name, "040000",
    "tree", asset.tree }` entries sorted by name → `kindOid`; root `mktree`
    of the kind entries plus `{ "versions.json", "100644", "blob",
    versionsOid }`, sorted → `tree`. Blob oids are reused from the branches
    untouched, so the composed tree shares every object with the branches
    and is cheap to check out.
15. **Return** `{ chain, assets, conflicts, policy, harnesses, tree }` with
    `assets` sorted by `kind` then `name`, `conflicts` in discovery order.

The composed tree is not a commit and is never pushed. The CLI wraps it in
a throwaway commit for `refs/harness/remote` (§7.4); `definitions` writes it
to the index (02 §6) and discards it.

**Conformance fixtures** — `engine/compose/fixtures/<case>/`:

```
chain.json                           Chain, with commit ids "org", "t1", …, "u" as placeholders
branches/<placeholder>/…             the tree each placeholder commit holds, as plain files
expected.json                        Composed with `tree` and every oid replaced by the fixture path they came from
```

A fixture runner materialises the branches into a tmp repo, resolves
placeholders to real commits, runs `compose`, and compares after replacing
oids the same way. The CLI, `definitions`, and the console's Playwright
suite all consume `expected.json`. Required cases: `single-org`,
`override-keeps-id`, `rename-follows-id`, `same-path-different-id`,
`duplicate-id`, `narrowed-grant-valid`, `narrowed-grant-outside-subtree`,
`narrowed-grant-alias-not-held`, `boundary-union`, `always-loaded`,
`required-and-recommended`,
`harness-names-nothing`, `no-policy-files` (C32).

## 7. The local clone: fetch, hydrate, push

### 7.1 One helper for git

Unchanged from today's `git.ts` and non-negotiable (C30):

```
git --git-dir=$HARNESS_HOME/assets.git --work-tree=$HARNESS_HOME/assets \
    -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.fileMode=false \
    -c user.name=harness -c user.email=harness@local \
    [-c http.extraHeader="Authorization: Bearer <token>"]   only on fetch/push \
    <command…>
```

`withIndex(scratch, …)` and `worktreeTree()` survive as they are.

### 7.2 Fetch and chain

1. `GET /v1/me` → `{ user, chain }` (paths and ref names; no commits yet).
2. `git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'` with the
   token header. `definitions` advertises only the person's chain (02 §4),
   so this cannot fetch more than it should; `--prune` drops refs that left
   the chain (a team the person was removed from).
3. For each `ChainNode`, `commit := rev-parse refs/remotes/origin/<ref>`. A
   chain node the server named but did not advertise is `repo.chain_mismatch`
   (a bug, not a policy state — refuse).
4. `compose(chain, gitReader)` where `gitReader` implements `Reader` with
   `ls-tree`, `cat-file`, `hash-object -w`, `mktree` through §7.1.
5. Record the chain: write `$HARNESS_HOME/assets.git/chain.json` — the
   `Chain` as fetched, commits included. `harness run --offline` (08 §6)
   composes from it and from `refs/remotes/origin/*` without a server; a
   missing file means nothing has ever been fetched here.

### 7.3 Push — the person's branch holds only the person's changes

The work tree is the composed set; `main` must contain only what this
person added or overrode. So a push commits **one path** onto the branch
tree, never the work tree. For `push` and `offer` (08) the path is
`assets/<key>`, taken from the work tree; for `new` (08 §11.12) it is
`harnesses/<id>.json`, taken from a scratch file — the same steps with a
different source for step 3.

Given `key = <kind>/<name>`, `message`:

1. `sidecar := <work tree>/<key>/asset.json`. Absent → `repo.no_sidecar`.
2. `composed := compose(...)` (from the last fetch, cached in the session);
   if `composed` has an asset at `key` with a different id → the §5 rule 4
   conflict: `repo.id_mismatch`. Refuse before the network.
3. `W := worktreeTree()`; `sub := rev-parse W:<key>` (the asset directory's
   tree).
4. `base := rev-parse refs/remotes/origin/users/<id>` — may be absent on the
   first push; `baseTree := base ? "<base>^{tree}" : <empty tree>`.
5. In a scratch index: `read-tree <baseTree>`; `rm -r --cached --ignore-unmatch
   -- assets/<key>`; `read-tree --prefix=assets/<key>/ <sub>`; `write-tree` → `T`.
6. `commit-tree T [-p <base>] -m <message>` → `C`.
7. `update-ref refs/heads/main C`.
8. `push origin refs/heads/main:refs/heads/users/<id>` with the token header,
   **never `--force`**. Rejected non-fast-forward → `repo.branch_moved`
   (another machine pushed); the remedy is `harness pull` then push again.
   Rejected by pre-receive → surface `definitions`' message verbatim (02 §5
   messages are written to be shown).
9. `fetch` so `refs/remotes/origin/users/<id>` = `C`.

Removing an override ("take the team's" for a path the person had pushed):
`reset <key>` (§7.4) locally, then steps 4–9 with step 5 omitting the
`read-tree --prefix` — a commit that deletes `assets/<key>` from the branch.
`offer` is this push followed by a request (08); the commit is the same.

`record()` in today's `assets.ts` is replaced by this; there is no second
history.

### 7.4 Hydration is unchanged

`asset-sync.md` §4 stands with one substitution and one prefix:
**`incoming := <composed tree>`** wrapped as `commit-tree <tree> -m hydrate`
(objects only; no ref until step 4), and **row 0** for the subscription (§8).

| # | Condition | Action |
| --- | --- | --- |
| 0 | key ∉ subscription | if on disk and clean vs `R`: `rm -rf`, notify *"`<key>` is not in any of your harnesses; removed. `harness switch --none` keeps everything."* If dirty: keep, notify *"…kept because you changed it."* Skip rows 1–5. |
| 1–5 | as `asset-sync.md` §4 | unchanged |
| 4' | `update-ref refs/harness/remote incoming` | unchanged |

The idempotency test (`asset-sync.md` §4) is unchanged and remains T2:
`hydrate` twice with no change performs zero writes.

`reset <key>` is `rm -rf <key>; checkout refs/harness/remote -- <key>`,
unchanged.

### 7.5 `versions.json`

Written into the composed tree by compose (§6 step 13), so it is versioned
with the delivery it describes. One entry per winning asset:

```json
{ "tool/deploy": {
    "id": "6f1c9a2e-…", "kind": "tool",
    "from": "acme.marketing", "commit": "9a3f…", "tree": "b71c…",
    "shadows": { "from": "acme", "tree": "e02d…" },
    "required": false } }
```

`shadows` drives `asset-sync.md` §5's notice: where `shadows.tree` changed
between `R` and `incoming`, the person's override is standing on a moved
team copy. `status` reads `subscribed` from the selection (§8), not from
this file, because subscription is local.

## 8. Subscription — sparse materialisation

`prd-v2.md` §4.2 asks that the working copy hold only what is subscribed,
so an unsubscribed path can never collide and a partial commit can never
delete anyone's paths. §7.3 already gives the second property to every
push. The first is delivered by one predicate applied in hydration row 0,
not by git's `core.sparseCheckout` (D32).

**The subscription is per person, not per session:**

```
subscribed(key) :=
    the person has no harness on their chain        → true          (harnesses.md §0: no filter)
    or key.id ∈ ⋃ { h.assets : h ∈ composed.harnesses }
    or key.id ∈ composed.policy.required                       (W5-D10)
```

So `switch` changes nothing on disk (C14 holds literally), a harness edited
in the console changes the set at the next `pull`, and a person who wants
an asset no harness of theirs names adds it to one — or runs with no
harness selected and receives everything. Per-session filtering (which
assets *this* session loads) stays where it is today, at render (07), from
`Choices.harness`.

`status` shows an unsubscribed key as `not checked out · in no harness of
yours`. `versions.json` still lists it: a session records everything it was
offered (C17).

**Re-subscription (28 Sep).** A key row 0 removed, or never laid out, is *absent*, not *edited*: when a harness names it again, row 3 takes it. Before this an absent directory read as a local deletion (row 4, *local edits, team unchanged*) and a harness that gained assets stayed empty on disk until `harness reset`. Test `resubscribed_key_is_laid_out_again`.

## 9. Failure modes

Compose never throws on content; it reports. The CLI turns each `Conflict`
into a `Blocker` with these codes (03 owns the preflight decision; the
strings are defined here so they exist once).

| Code | Message | Remedy |
| --- | --- | --- |
| `compose.chain_invalid` | Your organisation's branches do not form a chain: `<detail>`. | This is a server fault. Run `harness preflight` and share the output with an organisation admin. |
| `compose.malformed` | `<path>` on `<node>` does not parse: `<why>`. | An admin of `<node>` fixes the file; the change log shows who last touched it. |
| `compose.unknown_kind` | `<path>` on `<node>` is a `<kind>`, which this organisation does not define. | Add `<kind>` to `policy/kinds.json` on the organisation, or rename the directory. |
| `compose.duplicate_id` | `<node>` holds the same asset id at `<paths>`. | Keep one; give the other a new id with `harness adopt`. |
| `compose.same_path_different_id` | `<path>` exists on `<a.from>` and `<b.from>` with different ids, so neither can be loaded. | `harness reset <path>` to take theirs, or rename yours. |
| `compose.invalid_grant` | The grant `<grant>` on `<node>` is not a narrowing of one it holds: `<why>`. | An admin of `<node>` edits `policy/grants.json`; only aliases the team holds, to teams inside it. |
| `compose.reach_widened` | Your organisation's definitions do not compose: reach-widened at `<node or harness:id>`. | Reach only ever narrows on the way down: `<why>`. An admin of the node above sets it there. |
| `compose.reach_grant_retired` | Your organisation's definitions do not compose: reach-grant-retired at `<grant>`. | Reach is `policy/reach.json` now, not a grant. An organisation admin removes this grant and sets reach under Boundaries → Reach. |
| `compose.always_loaded_missing` | `policy/always-loaded.json` names `<id>`, which is not an organisation asset. | Remove it from the file or move the asset to the organisation branch. (Either list — W5-D10.) |
| `repo.no_sidecar` | `<key>` has no `asset.json`, so it is not yet an asset. | `harness adopt <path>` gives it an identity. |
| `repo.id_mismatch` | `<key>` already exists on `<node>` with a different id. | `harness reset <key>` to take theirs, or rename yours. |
| `repo.branch_moved` | Your branch moved on another machine since this one last pulled. | `harness pull`, then push again. |
| `repo.chain_mismatch` | The server named `<ref>` in your chain but did not serve it. | This is a server fault. Run `harness preflight` and share the output with an organisation admin. |
| `repo.not_in_work_tree` | `<path>` is not under `~/.harness/assets`. | `harness adopt <path>` moves it there. |

## 10. Tests

| Tier | Name | Asserts |
| --- | --- | --- |
| T1 | `compose_is_deterministic` | two runs over the same fixture give equal `Composed` and equal `tree` |
| T1 | `precedence_narrowest_wins` | user copy beats team beats org; `shadows` chain is correct |
| T1 | `boundaries_union_root_first` | ids prefixed by node path; order preserved |
| T1 | `narrowed_grant_clauses` | each of §6 step 9 (a)–(e) fails alone with the clause named in `why` |
| T1 | `no_policy_files_is_not_empty_policy` | C32: `boundaries: []`, `grants: []`, no conflict |
| T1 | `harness_naming_nothing_is_kept` | C18 |
| T1 | `reach_narrows_down_the_chain` | §6 step 10a · org `on` → team `allow`, `setBy` the team, no conflict (fixture `reach-narrows`) |
| T1 | `reach_widened_is_a_conflict_and_the_parent_stands` | §6 step 10a · a team moving `allow` → `on` (fixture `reach-widened-conflict`) |
| T1 | `reach_grant_is_retired` | D132 · one `reach-grant-retired`, the grant beside it untouched (fixture `reach-grant-retired`) |
| T1 | `a harness takes the last narrowing step` | §6 step 10b · `effectiveReach` sets `setBy` to `harness:<id>`; a widening harness is ignored |
| T1 | `reach_matches_by_name_and_by_subdomain` | `*.suffix` is subdomains, never the apex — one rule, shared with `plan.deny` (05 D77) |
| T2 | `override_keeps_id` · `new_id_at_existing_path_is_refused` · `rename_follows_id` | §5 |
| T2 | `push_commits_one_directory` | after two pushes of different keys, `main`'s tree holds exactly two `assets/<key>` entries and nothing else |
| T2 | `push_never_forces` | a moved remote yields `repo.branch_moved`; remote unchanged |
| T2 | `remove_override_deletes_path` | §7.3 removal leaves the path absent from `main` |
| T2 | `hydrate_row0_removes_clean_unsubscribed` · `hydrate_row0_keeps_dirty` | §7.4 |
| T2 | `hydrate_is_idempotent` | unchanged from today |
| T2 | `token_never_in_config` | after fetch and push, `assets.git/config` contains no `Authorization` |
| T2 | fixture runner over every case in §6 | expected equals actual |
| T4 | `fetch_receives_only_chain` | with `definitions` (02): a user's fetch lands no sibling team ref |

## 11. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D31 | **A branch starts as an empty tree with no parent** (§4.1). | forking from the parent at creation; costs legibility of ownership and of the change log |
| D32 | **Subscription is a hydration predicate (row 0), not git `core.sparseCheckout` / `skip-worktree`.** The work tree is not an index-tracked checkout today (`worktreeTree()` builds a scratch index each time); introducing the real index only to carry sparse bits would add a second state machine beside the hydration table for the same property. `prd-v2.md` §4.2 names the git mechanism; the property it asks for is delivered. *Recommend rewording §4.2 to "sparse materialisation".* | making `assets/` a real checkout of `refs/harness/remote` with cone-mode sparse patterns; then dirty detection becomes `git diff HEAD` and row 3 must be rewritten to refuse overwriting dirty paths, which `git checkout -- <path>` does not |
| D33 | **The subscription is per person (union of their harnesses + the required list), not per selected harness** (§8). | subscribing to the selected harness only; `switch` then rewrites the work tree and C14 no longer holds |
| D34 | **Three provider files, not one** (§4.2). | one `policy/providers.json` |
| D35 | **Kinds live at `policy/kinds.json`** (00 §4.2 says "`kinds.json` on the org branch" without a directory). | moving it to the branch root |
| D131 | **Reach is a policy file, and it only narrows.** `policy/reach.json` on the org node and on team nodes, `{ mode: "off" \| "allow" \| "on", hosts }`, plus an optional `reach` on a `HarnessDef`. The walk is org → team → sub-team → harness; each step may keep the mode or move down `on` → `allow` → `off`, shorten an allow-list or lengthen a deny-list. Anything else is a `reach-widened` conflict and the parent stands. `EffectivePolicy.reach` carries `setBy`, the last node that narrowed it — which is the node a person has to ask, and the node the console's **Allow** writes to | a grant, which is what D132 retired: nobody could find it, and it had one bit where the question has three answers |
| D132 | **The reach grant is retired.** `Grant.reach: "outside-endpoints"` composes to a `reach-grant-retired` conflict and grants nothing; `Choices.outsideEndpoints` and `SpawnPlan.hosts === "any"` go with it. A branch holding one is refused at the push, rather than read as `off` in silence | restoring the field; but reach would then be set in two places and neither would say which won |
| D135 | **A personal account starts on the suggested allow-list.** The personal seed writes `policy/reach.json` as `allow` with `engine/compose/presets/reach-suggested.json` — the package registries, source hosts and update hosts a first `pip install` needs — so a hobby user's first session works and the Boundaries screen has something to show. The enterprise seed writes `off`; an org admin turns it on from the same screen, where the same list is offered as one-click adds | seeding `off` for both, and a hobby account's first install fails with a refusal it has to go and read a screen to fix |
| D36 | **The fetch token travels in `-c http.extraHeader` and is never persisted** (§4.3). | a credential helper; costs a second file the deny-read set must cover |
| D146 | **Every out-of-the-box behaviour lives in one place, and that place has a manifest** (§4.2, W6-D1). `engine/compose/presets/` is the only home of a default and `presets/index.json` is its list: per entry, the file or asset directory it is, how it is **managed** (`required` · `recommended` · `suggested`), the console screen that manages it and the verbs that screen offers. A default not in the manifest does not exist; a file under `presets/` no entry names is a finding. One indirection only: a value spelled `@<entry id>` is that entry's file, which is how `reach-default-personal.json` is the suggested list with a mode rather than a second copy of it | letting each new default be added wherever its author stood — which is how the kinds became a Python constant, the reach starter list a JSON array nobody could find, and the runtime display names a map beside one reader |
| D147 | **The seed walks the manifest and names no file** (§4.2, W6-D2). `seed.py` writes every `required` and `recommended` entry — policy files to `policy/<name>`, asset directories to `assets/<kind>/<name>/` — derives `always-loaded.json`'s two lists from the asset entries' `managed` words, and the only preset it still names is which of the two `reach-default-*` entries an edition takes. `KINDS` and `REQUIRED_ASSETS` are deleted: the kinds are `presets/kinds.json`, read on every branch as `policy/kinds.json` the way they already were, and *required* is a word in the manifest | keeping the lists in Python, where a default is invisible to the checker and to the person it ships to |
| D149 | **A default without a screen is a build failure** (W6-D4). `scripts/check-defaults.py`, run beside `check-plan-docs.py`: the manifest and `presets/` are the same set; every entry's `screen` is a directory under `web/app/(console)/console/[scope]/`; every verb occurs in that directory's own files or in a write spec of the entry's own name; every `required` entry is named in §4.4 with the sentence that says why. Zero findings is the bar. Its first run says model providers have no `delete` verb, which is true and is the point | checking the manifest against the docs, which would prove only that two prose lists agree |
| D154 | **The starter set of command boundaries ships as a default and is never seeded** (W6-D10, §4.2). `presets/command-boundaries.json`, `managed: suggested`, `screen: boundaries/commands` — the system and home wipes, a download piped into a shell, the two force-push forms, the shell history turned off. It is `suggested` and not `recommended` because a deny that arrives switched on is a decision we made for an organisation that never asked: the first time a boundary we shipped refuses something real, the person reads a reason written by a stranger. So it is offered, one click each, with its reason, under *Set here* — and what the organisation clicks is its own row at its own node, liftable where it was set like any other. | seeding them, which is the shortest path to an organisation turning the whole feature off |
| D155 | **A personal organisation starts with reach `on`, so one harness can turn it off** (W7-D4, §4.2; amends D135, the wave-5 plan's decision 1c). `reach-default-personal.json` is `{ "mode": "on", "hosts": [] }` and not the suggested allow-list. The reason is the first-harness modal's *Web access* switch: reach only ever narrows (D131), so a harness under an `on` organisation can say `off` and nothing else, which is exactly the two positions the switch has. Under the old `allow` default the switch's *on* would have been a `reach-widened` conflict — and that conflict stops every session on the chain (`compose.reach_widened`), not just the harness — and a hobby user would have had to understand an allow-list of fourteen hosts before making a first harness. The enterprise default is unchanged (`off`): there an admin turns the organisation on from Boundaries → Reach first. The suggested list is unchanged too, and is still what that screen offers as one-click adds — which is now its only reader, so `@reach-suggested`, the one indirection, has no user and is kept for the next default that is another entry. `POST /v1/harnesses` takes `reach?: { mode, hosts }` and writes it as `HarnessDef.reach`; **the console sends `off` and never `on`**, because absent means *inherit* and a harness restating `on` narrows nothing today and conflicts the day the organisation turns itself down. | keeping `allow` and giving the modal a third position, *inherit*; keeping `allow` and having the switch write an allow-list minus every host, which is a widening by another name |

## 12. Out of scope

- Serving the repo, authorisation, pre-receive validation, the index: 02.
- What preflight does with `Composed`, and how `Choices.grants` is derived
  from `policy.grants` through `Scope`: 03.
- `adopt`, `new`, `offer`, `status` output and every command's surface: 08.
- Migration of today's Postgres assets into branches: 02 §8.
- Git LFS, submodules, `.gitignore`, dependency installation: still refused
  (`asset-sync.md` §9 minus its "no server-side git" line).

## 13. Definition of done

- `engine/compose` exists with `compose()`, `Reader`, and the fixture runner;
  every case in §6 passes; budget ≤ 600 lines.
- `engine/cli` fetches a chain from a local `definitions` (T4), composes,
  hydrates through the unchanged table plus row 0, and pushes one directory
  per §7.3; `main` never contains a path the person did not push.
- Every code in §9 has a test that produces it.
- `hydrate.test.ts`'s existing cases pass unmodified against the new
  `incoming`.
- `Reader` and the `Conflict` variants are used exactly as `00 §4` defines
  them; no local redeclaration exists in `engine/compose`.
- `python3 scripts/check-defaults.py` reports 0 findings, beside
  `scripts/check-plan-docs.py`: every default is an entry of
  `engine/compose/presets/index.json`, every entry's screen is a route
  directory, every verb it names exists in code, and every `required` entry
  has its sentence in §4.4 (D149).
