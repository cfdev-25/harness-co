# Console Plan — 03 · Data and naming

The read model behind every screen, the `api` endpoints that serve it, the
conventions every endpoint and table follows, and the UI table standards
made checkable. Nothing here decides what a screen says (the PRD does) or
how it looks (01 does); this document decides where each cell's value comes
from and what it is called.

## 1. Purpose

Every console screen is a read of the index (`idx_*`, engine 02 §8) or of
records (`harness_sessions`, `audit_log`, people tables), served by
`/v1/console/*`. This document names, per endpoint: the tables and joins,
the authorisation rule, the derivation rule for every derived field, the
provenance of every field (K3), and the response type from 00 §4. It also
fixes the conventions — API, database, UI table — that keep two screens from
rendering one object two ways (K6).

## 2. Invariants

| # | Honoured here |
| --- | --- |
| K2 | every read is over `idx_*` or records; file bytes, history and diffs come through `api` calling `definitions` read-only (00 D8); no console code composes |
| K3 / P2 | every field in a view model carries `Fact.provenance` or is documented here as declared/observed/derived; observed values are fetched at draw and never stored |
| K4 / P3 | scale columns are `ScaleTag`s from the registry (05 §4); an unregistered value is a bug |
| K6 | one column spec per object; one sentence template per audit action; one commit helper for every write that touches a ref |
| K8 | every write in 00 §4.11 is an endpoint the CLI could call; this doc adds no console-only mutation |
| P1 | every object endpoint returns `Related` for its relationships and an `EdgeWalk` on request |
| P4 | every relationship cell has a unit; `all: true` renders *All teams*, never a repeated list |
| P13 | every `403` body names who decides |
| engine C36 | `api` is the only Postgres client; console endpoints are `api` routes |

## 3. Contracts used

From 00 §4 by name: `Scope`, `Viewer`, `NavKey`, `Fact`, `Provenance`, `Hidden`,
`Column<Row>`, `HarnessCard`, `HarnessView`, `HarnessFileRow`, `FileView`,
`RequestView`, `DiffHunk`, `SessionRow`, `SessionView`, `ScaleId`, `ScaleTag`,
`Related`, `BoundaryRow`, `EdgeWalk`, `LogCategory`, `LogRow`, `EndpointRow`,
`PersonRow`, `TeamRow`, `RemovalPreview`. From engine 00 §4: `Chain`, `HarnessDef`, `Boundary`,
`Grant`, `SecurityGroup`, `ModelProvider`, `HarnessProvider`, `Routing`,
`Slot`, `PreflightReport`, `EndpointEvent`, `EndpointTally`, `Blocker`.
From engine 02 §8: `idx_refs`, `idx_stale`, `idx_nodes`, `idx_assets`,
`idx_harnesses`, `idx_policy`, `idx_effective`, `idx_edges`, and the reads
`org_policy`, `harness`, `effective_for`. From engine 04 §6: the
`harness_sessions` columns.

**Row types this document defines** (the per-endpoint read model 00 §4.10
delegates here; 04 specifies their columns): `GroupRow`, `GrantRow`,
`HarnessProviderRow`, `ModelProviderRow`, `RoutingMatrix`, `VaultRow`,
`SecretRow`, `OrgAssetRow` — each given in §4 as its field list, and each
named identically as a pydantic response model (§8 rule 10).

**Engine reads this document relies on** (engine 02 §5.3, engine 00 §4.10):
`definitions:/internal/tree/{org}/{commit}/{path}` (a tree listing, or the
blob when `path` is a file — there is no separate blob endpoint),
`/internal/log/{org}/{ref}?path=&limit=`, and `/internal/diff/{org}/{a}/{b}?path=`
returning unified hunks. `api` never parses a repo; it parses unified-diff
text into `DiffHunk[]`.

## 4. Read model, per endpoint group

Common rules first; each group below states only what differs.

- **Module.** `backend/app/api/routes_console.py` (routes, thin) and
  `backend/app/domain/console.py` (queries, derivations). Ceiling 900 lines
  together (00 §9).
- **Scope resolution.** `?scope=org` requires `role.level = org-admin`;
  `?scope=team:<path>` requires `<path>` on the viewer's chain (member) and,
  for admin verbs, `role.at` at or above `<path>`; `?scope=me` (default) is
  the viewer. A missing scope is `me`. A scope the viewer cannot see is
  `403 console.scope_forbidden` naming who can.
- **`?as=<user-id>`.** Allowed when `role.level ∈ {team-admin, org-admin}`
  and `role.at` is an ancestor of the member's user node (engine 00 §4.10).
  The response is computed for the member as viewer; the audit chain gets
  `console.read_as` at the admin's unit with `{ as, endpoint }` — reading
  another person's branch is recorded (PRD §18: *the member is told*).
  Otherwise `403 console.as_forbidden`.
- **Provenance.** Unless a row below says otherwise: values from `idx_*` are
  **derived** (`at = idx_refs.indexed_at` for the governing ref); values from
  `idx_policy` bodies are **declared** (`by` = the commit author, read from
  `idx_refs` → `definitions:/internal/log` lazily, only on the object page);
  values from `harness_sessions` are **declared** by the CLI except
  `slots[*].evidence`, which is itself an evidence level and is shown as
  such; **observed** values are named explicitly and never stored.
- **Pagination.** Every list: `?cursor=&limit=` (default 50, max 200),
  response `{ items, next }`; keyset on `(sort_key, id)`, cursor =
  base64url of that pair; `next` absent on the last page.
- **Staleness.** If `idx_stale` has a row for the org, every index-backed
  response carries `stale: { since, refs }` and the shell shows a `Notice`
  (01 §9 *Index behind*). Reads are not refused — only the broker fails closed on staleness
  (engine 02 §8.4) — but the console says the index is behind.

### 4.1 `/v1/console/me` → `Viewer`

| Field | From | Provenance |
| --- | --- | --- |
| `user` | `auth.users` ⋈ `org_unit_members` | declared |
| `chain` | `idx_nodes` walked up from the user node | derived |
| `role` | `role_at()` (deps.py) | declared |
| `teams` | chain nodes of kind `team` ⋈ `org_unit_admins` for `admin` | derived |
| `visibility` | `org_unit_boundaries.policy->'visibility'` at the org node, default all `true` (PRD §16) | declared |
| `waiting` | `harnesses`: open `requests` the viewer may accept (admin over the team) plus, at `me`, files whose `differs` would be `conflict` in the last session's report; `people`: open role requests waiting on the viewer (org admin) or on their team (team admin); other keys absent | derived |

No scope; no `as` (a viewer is always themselves; `as` applies per screen).

### 4.2 Harnesses

**`/harnesses` → `HarnessCard[]`.** `idx_harnesses` where `node_path` is on
the scope's chain (me: the viewer's chain; team: that team's ancestors and
the team; org: the org node), ⋈ `idx_nodes` for `team`; `fileCount` =
`count(*)` of `idx_effective` rows for the viewer whose `asset_id ∈ def.assets`
(so a name that resolves to nothing is not counted — P11, C18: the card
carries no status, and the count is what the viewer would actually load).
One card per id: the nearest copy on the chain wins, and the rest become
`alsoAt: [{ level, label, href }]` in chain order (W5-D9) — the same id on
the organisation and on the person's branch is one harness read at two
levels, not two cards. Sort: own team's first, then name. Provenance: derived.
`runners: [{ id, name }]` (W5-D13) is the launch buttons: every
`policy.harnessProviders` entry that is not `not-approved`, whose `scope`
covers this chain and this harness, and whose `speaks` meets the routed model
provider's `endpoints` — `canRunOn`'s wire-format half (`console.speaks_routed`,
the one the `/providers/harness` row's `canRun` reads) with approval and scope
added. `name` is the runtime's own word for itself (*Pi*, *Claude Code*), read from
`HarnessProvider.name` (W6-D3) with the id as the fallback for a branch seeded
before the field; `console.RUNNER_NAMES`, the map that held it beside its one
reader, is deleted (04 D97). `lastWorkspace` / `lastHost` (W5-D14) are
the viewer's **own** most recent session with this harness that recorded a
workspace, and are `null` for everyone else and under `?as`.

**`/harnesses/{id}` → `HarnessView`.** Authorisation: the harness's
`node_path` is on the viewer's (or `as` member's) chain, else `404
console.harness_not_found` (a harness off the chain does not exist for this
viewer — PRD harnesses invariant 6).

| Field | Rule | Provenance |
| --- | --- | --- |
| `def` | `idx_harnesses.def` | declared |
| `team` | `idx_nodes` at `node_path` | derived |
| `header.fileCount` | as the card | derived |
| `header.groups` | grants covering this harness for the viewer: `idx_edges grant scoped_to team` ∩ chain teams, minus grants with `only_for` not naming `{id}`; map to `grants → group` | derived |
| `header.outsideEndpoints` | `allowed` iff a covering grant has `reach`; else `prohibited` (PRD §8: derived, never stored) | derived |
| `header.modelProvider` | routing precedence harness → provider → team over `idx_edges default_for`; the provider is the viewer's default `harness_provider` — when several are approved, the routing row for `harness` wins, then `team` (engine 00 D8) | derived |
| `header.preflight` | **rule P-1:** the viewer's most recent session (`harness_sessions` where `harness_id = {id}`, any status) whose `commits` equal the current `idx_refs.commit` for every ref on the chain → its `preflight.passing`; otherwise a **dry check** over the index: (a) at least one `harness_provider` approved for a chain team whose `speaks` ∩ the model provider's `exposes` is non-empty (`canRunOn`); (b) no loaded asset's `sidecar.format` outside that intersection; (c) every `needs_alias` of a loaded asset has an `entry` in a group of a covering grant. All three → `passing`, else `failing`. The `Fact.at` is the session's `at` or `now`. Commits-equality replaces a time window: a session on moved refs proves nothing about the present. | derived |
| `versions` | `mine`, `team`; plus `member:<id>` for each `org_unit_members` row in the team's subtree when the viewer is admin over the team (PRD §18); `?as` narrows to that member's own two | derived |
| `files` | §4.2.1 | — |
| `groups` | the covering grants' groups as `{ name, grant }` | derived |
| `boundaries` | every `Boundary` in `idx_policy` bodies on the chain, plus `only_for` naming `{id}` (union, PRD §7); **listed in full** (P17); hidden when `visibility.boundaries = false` — the response then carries `hidden: { boundaries: "An organisation admin has turned this view off." }` and no list (P10) | declared |

**4.2.1 `HarnessFileRow`.** `?version=mine` (default): `idx_effective` for
the viewer ⋈ `idx_assets` on `(org, from_path, asset_id)`, filtered to
`def.assets` (or all when the screen asks for the whole library). `owner`:
`from_path` = org node → `org`; = a team on the chain → `team`; = the
viewer's user node → `you`; = another user node (admin reading) →
`member:<id>`. `lastEditor` = the last commit touching
`assets/<kind>/<name>/` on `from_path`'s ref, via
`definitions:/internal/log?limit=1`, fetched lazily per page of rows and
cached for the request only (observed-from-git but recorded in a commit, so
**declared**, `by` = author). `?version=team`: the same with the chain
truncated below the team node (the composition without the viewer's ref —
engine 03 `view: "team"`). `?version=member:<id>`: as `mine` for that
member. Every row carries `tree` (the asset directory's tree id on its
winning branch) and `loads` — `required` · `recommended` · `on-request`
(W5-D10, replacing `always: bool`): what the *organisation* said about the
asset, not what this harness chose, which is why the row reads
*skill · required*. The required ids are listed on the page even when the
harness does not name them (prd-v2 §5.2); a recommended one is here only
because this harness lists it. `?version=differences` is not an endpoint: the client renders
Differences from `mine` and `team` fetched together, computing `differs`
per `assetId` (`yours-only` present in mine not team; `theirs-only`; `both`
when both present with different `tree`; `conflict` when both differ from
the last delivered — the client has no `refs/harness/remote`, so `conflict`
is shown only when the latest `mine` session's `preflight.composed.tree`
disagrees with both; otherwise `both`). P12: `differs` is present only in
this view.

**`/harnesses/{id}/files/{assetId}` → `FileView`.** `content.mine` and
`content.team` via `definitions:/internal/tree/{org}/{commit}/{path}` for the
two composed trees (a missing side is `null`); `diff` via `/internal/diff`
between the two trees at the path when both sides exist — the console never
diffs text (01 D66); `history` via `/internal/log?path=` on both refs,
merged by time, each row tagged `mine`/`team`; `request` = the open or
latest closed request whose `paths` include this asset's path.

### 4.3 Requests

**`/harnesses/{id}/requests` → `RequestView[]`** (`?state=open|closed`,
default `open`), and **`/requests/{id}`**. Records: `requests` (§7 schema),
`request_comments`. `files[*].added/removed/diff` from
`definitions:/internal/diff/{org}/{team-head-at-open}/{commit}?path=`;
`stale` = the team ref's current blob for the path ≠ its blob at
`request.base_commit` (PRD §17.3). `verbs`: `accept`/`decline` when the
viewer is admin over `team` and `state = open`; `withdraw` when author and
open; `comment` when on the chain. Sort: open by `at desc`; closed by
`outcome.at desc`. Authorisation: the harness on the viewer's chain.

### 4.4 Sessions

**`/sessions` → `SessionRow[]`** (`?person=&harness=&status=`). Scope
`me`: `owner_auth_user_id = viewer`; `team:<path>`: owners whose user node is
in the subtree and viewer is admin over it; `org`: all. `endpoints.reached`
= `sum(count)` and `refused = sum(refused)` over `endpoints_tally` (closed)
or a live aggregate over `session.endpoint` audit rows since `created_at`
(active). Sort `last_active_at desc`.

**`/sessions/{id}` → `SessionView`.** Direct columns (engine 04 §6);
`preflight` from the `preflight` column added by 00 D7 (`null` when
absent); `slots` verbatim — the console renders `state`, `evidence`,
`resolvedFrom`, `via` as three scale columns and one relationship column;
`endpointsTally` verbatim. A `session.refuse` with no session row is not a
session; it appears in the harness log (§6) only.

### 4.5 Security groups, grants, boundaries

**`/groups`** → `GroupRow { name, entries: Array<{ alias, secret: { vault, ref }, upstream, attach: { header, prefix } }>, sources: "vault" | "vault-or-local" (text with a hover — not a scale, 04 D41), tier: ScaleTag, teams: Related, harnesses: Related, narrowed: Related(groups) }`. `entries` is `policy/groups.json` verbatim: a `PATCH` replaces the whole list, so *Add an entry* hands back what is held, and a composite id cannot be edited back into an entry. A `ref` is a reference and never a value (`no_credential_value_in_any_response`). From `idx_policy` (`policy/groups.json` at the org node) ⋈ `idx_edges` (`entry_secret`, `grants`, `scoped_to`, `only_for`, `narrowed_from`). `tier` is the vault's (`api` resolver registry, engine 04 §7) — declared. **`/groups/{name}`** adds `EdgeWalk` (§5). Scope `team`: grants scoped to the team or its ancestors; `me`: covering the viewer.

**`/grants`** → `GrantRow`: a `Grant` with `teams`/`harnesses` as `Related`, `gives: "entries" | "reach"`, `entryCount`, `narrowedFrom` as a link, `reach` grants included (PRD §8: outside endpoints is a grant); `by` and `at` from the commit author (declared).

**`/boundaries`** → `BoundaryRow[]` (00 §4.7: a `Boundary` with `setBy: ChainNode`, the node whose `policy/boundaries.json` holds it) with `scope` rendered as `Related`; org-wide rows first (PRD §15: not repeated per harness, but listed on this screen). Hidden per `visibility.boundaries` for scope `me` (P10, response `hidden` as §4.2). The screen's three tabs (04 §9, W6-D8) read this **once** and filter it by kind in `lib/views/boundaries.ts`; three routes for three tabs would be three walks of the same chain. **`/boundaries/suggested`** → `SuggestedCommands` (W6-D10): `engine/compose/presets/command-boundaries.json`, each entry plus `present` — whether this level or anything above it already holds that pattern — and `canEdit`. Its own route and **not** a field on the page above, because `Page[T]` is the one listing shape every table reads (§4.2) and widening it for one screen puts an unused key on twenty others; Reach's starter list rides on `ReachView` because `ReachView` is that section's own view model and the deny list has no such object. A viewer whose boundary list is hidden is offered nothing: an add whose result you cannot see is not an offer.

### 4.6 Providers, routing, vaults, assets

**`/providers/harness`** → `HarnessProviderRow`: a `HarnessProvider` — including `name`, the runtime's own word for itself (W6-D3) — + `Related(teams)` from `scoped_to` + `speaks` as chips + `canRun: Related(harnesses)` derived from `speaks` ∩ `exposes` of each harness's routed model provider, minus any whose routed provider *needs a key* (W6-D6) — but **not** one it signs in to itself, which the broker now opens (W7-D2). **`/providers/model`** → `ModelProviderRow`: a `ModelProvider` + `status: ScaleTag providerStatus` (W6-D6, replacing `reachable: Fact<boolean>`), `credential` alias → `Related(groups)` via `entry`, `defaultFor`/`approvedFor` as `Related` per dimension (P4: six columns, two words — PRD §9.2), which 04 §10 draws as two columns of this table now that Routing is not a tab (D95). `status` is `needs-key` when no security group entry in a connected vault holds the credential alias — read from the composed policy, never a secret fetch — `sign-in` when that is so **and** a runtime the organisation lists and has not declined signs in to this provider itself (W7-D2: `broker.signs_in`, the adapter's `modelNative`), else `set-up` or `unreachable` by a `HEAD` with a 3 s budget (as §4.6 vaults). Only a held key is probed: a `sign-in` row's endpoint is reached by the runtime, not by us. **`/routing`** → `RoutingMatrix`: `Routing` verbatim, the resolved default per team as `derived`, and `subjects: { teams, harnesses, providers: [{ id, label }] }` — what *Set default…* and *Approve for…* may pick, labelled by the server because a harness id is a uuid and a runtime has a `name` (W6-D5).

**`/vaults`** → `VaultRow`, one per resolver in `api`'s registry + the person's machine (PRD §6.2): `{ id, handsUs: "minted" | "stored" /* engine fact, plain text */, issues: "temporary" | "stored", contents: "listable" | "not listable", reachable: Fact<boolean>, groups: Related }`. `reachable` is **observed**: the endpoint calls `Resolver.probe()` with a 3 s budget per vault, in parallel, and the result is returned with `provenance: "observed", at: now` and stored nowhere (P2). **`/vaults/{id}/secrets`** → `SecretRow[]`: secrets from `probe`-time listing when `contents = listable` (observed), else the secrets named by groups (derived from `entry_secret`), each with `Related(groups)`, `ready: Fact<boolean>` (observed), `lastUsed` (from `session.open` slots) and two flags derived from the join: `uncovered` (listed, no group) and `dangling` (named by a group, not listed) — PRD §6.7's two findings.

**`/assets?scope=`** → `AssetsPage { items: OrgAssetRow[], next, kinds }`: the **scope's own node**'s `idx_assets` rows (W5-D9 — the person's user node at `me`, the team's at `team:`, the org node at `org`; `console.scope_node`, because `ctx.scope_path` is the organisation at `me`) — **two nodes at `me` on a personal account**, the organisation's and the person's, because there the organisation *is* the person and the seeded copies have no other screen to appear on (`console.scope_nodes`, 07 §3, D104); every row carries `level: "org" | "team" | "me"`, the node it is on, which is the one thing that tells a seeded copy from an edited one + `loads: ScaleTag` (`required` · `recommended` · `on-request`, from the two lists of `policy/always-loaded.json` — W5-D10) + `Related(harnesses)` via `includes` (`all: true` when required — PRD §15) + `Related(teams)` via `placed_on` subtree + `Related(groups)` via `needs_alias → entry`; `sidecar.description` is the row's description (WS3a). `kinds` is `policy/kinds.json` in its own order — the screen's tabs, including the kinds this node holds nothing of. **`/assets/{id}?scope=`** adds `EdgeWalk` and the reverse view.

**`/assets/browse?scope=`** → `Page<BrowseRow>` (W5-D15, the store):
`{ id, kind, name, description, level, from, href, held, preset,
needsEnvironment }`. The rows are `console.browse_rows` — the **winning**
copy per id from `idx_effective` (so a shadowed copy is not offered twice),
each carrying the level and segment of its `from_path`, followed by the
bundled presets whose ids that set does not answer, read from the seed's own
preset directory and marked `preset: true` with no `href` (they are on no
branch). `level` is `org` · `team` · `me` · `preset`; `from` is the node's
own name and is empty for the two the console has words for. `held` is
whether the **viewer's own** branch holds a copy. `needsEnvironment` is the
`name` of a `kind: "environment"` entry in the sidecar's `needs` (engine 01
§5) — the one key the store reads out of a sidecar. `visibility.store:
false` answers `hidden` in place of the list (P10). `BrowseRow` is its own
type and not a narrowed `OrgAssetRow`: the two answer different questions,
and a shared type would carry one screen's relationships into the other. The noun is **assets** at every level; `OrgAssetRow` keeps its name because it is the row of one node's assets whatever node that is.

### 4.7 Logs and endpoints

**`/logs/{category}`** → `LogRow[]` from `audit_log` via `descendant_events`
for the scope's unit (existing downward walk), filtered to the actions of
that category (§6), sentence built by §6's template, `diff` fetched lazily
by `/logs/{category}/{id}/diff` → `DiffHunk[]` via `definitions:/internal/diff`
for git-backed rows. Scope `me`: `actor_id = viewer` or rows about the
viewer; hidden per `visibility.logs` (P10). **`/endpoints`** →
`EndpointRow[]` aggregated by §6.2's SQL.

### 4.8 People and teams

**`/people`** → `org_unit_members` ⋈ `auth.users` ⋈ `org_unit_admins`,
`teams` as `Related` from the user node's ancestors — plus `team`, the
membership's direct parent path, and `unit`, the person's own node, which
are what a removal and a visibility change name (a chain cell cannot say
which team a person is actually on) — `role` as `ScaleTag`,
`state` from `org_invites` (invited) and a `deactivated_at` column (§7);
`lastActive` = latest `harness_sessions.last_active_at`; and, on an invited
row, `invite` = `org_invites.id`, which is the only handle such a row has —
it names no person yet, and withdrawing it is `DELETE /v1/invites/{id}`.
**`/people/{id}`** adds sessions count, groups reached (derived),
`visibility` — this person's own, read up their unit's chain as §4.1 reads
the viewer's, so the switch on their page sets theirs and not the viewer's —
and the honesty line's data: admins who can read this person's branch
(`org_unit_admins` at ancestor nodes). **`/people/{id}/removal`** → `RemovalPreview`: `loses` = grants
covering the person that no remaining membership would (all of them, since
membership is one leaf — PRD §12); `sharedKeysToRotate` = `stored`-kind
entries in those grants' groups. **`/teams`** → `idx_nodes` of kind `team`
as a tree (`parent`, `children: Related`), `people` count, `groups`
(`scoped_to`), `admins`.

### 4.9 `/edges`, `/how` and `/search`

`/edges?kind=&id=` → `EdgeWalk` (§5). `/how` → `ScaleRegistry` plus the
content blocks 05 owns, served from `api` so the CLI can print the same
words (P14) — one source.

**`/search?q=&scope=`** → `{ items: Array<{ kind, id, label, href }> }` for
the header Palette (01 §4.3, 01 D61): a prefix match on `name` over
`idx_harnesses`, `idx_assets` (the viewer's effective set), `idx_policy`
groups and boundaries, `org_unit_members` (people the viewer may see), and
open `requests` — each restricted by the same scope rule as its own
endpoint, ≤ 8 per kind, plus the command-sheet rows matching `q` (05 §6).
No full-text index; `ilike 'q%'` over the indexed `name` columns.

An asset hit's `href` carries **the level that holds the copy**, not the
level the viewer is on: `level_of_node(ctx, asset.from_path)` (W5-D15). The
asset screen is one node's own copies (W5-D9), so at *You* a hit on an
organisation asset linked as `/console/me/assets/<id>` was a 404 — the same
rule `HarnessCard.alsoAt` already follows. A member whose hit lands on
`/console/org/…` meets the scope's own refusal there, which is the honest
answer and not a dead link.

## 5. The edge walk

`idx_edges` rows are directed `from → to`. **Rests on** = what this object
needs to work; **rested on by** = what would stop working. Both are computed
from the same rows by reading them in opposite directions, never merged
(PRD §14 principle 1).

| Object kind | restsOn (out, via) | restedOnBy (in, via) |
| --- | --- | --- |
| harness | asset `includes` · group ← grant `only_for`/`scoped_to` (*covered by*) · boundary `only_for` (*constrained by*) · model_provider `default_for` (*routed to*) | request (records) · session (records) |
| asset | alias `needs_alias` → group `entry` (*satisfied by*) · node `placed_on` (*placed on*) | harness `includes` (*included by*) · team via `placed_on` subtree (*reaches*) |
| group | secret `entry_secret` (*holds*) · origin `entry_upstream` (*reaches*) | grant `grants` (*granted by*) → team `scoped_to` (*to*) · harness `only_for` |
| secret (`vault:ref`) | vault (parsed from id) | group `entry_secret` → grant → team, harness (**two hops**: *rotate this and these stop*) |
| grant | group `grants` · team `scoped_to` · harness `only_for` · grant `narrowed_from` (*narrowed from*) | grant `narrowed_from` (*narrowed into*) |
| model_provider | alias `credential` → group | harness/team/provider `default_for`, `approved_for` · harness_provider via `speaks`∩`exposes` (*can run*) |
| harness_provider | wire_format `speaks` | team `scoped_to` (*approved for*) · harness (derived `canRun`) |
| boundary | — | team/harness `scoped_to`/`only_for` (*applies to*) |

```sql
-- two hops, directed, depth-limited; :dir = 'out' follows from→to, 'in' follows to→from
with recursive walk(kind, id, via, depth, path) as (
  select :kind, :id, null, 0, array[:kind || ':' || :id]
  union all
  select case when :dir = 'out' then e.to_kind else e.from_kind end,
         case when :dir = 'out' then e.to_id   else e.from_id   end,
         e.rel, w.depth + 1,
         w.path || (case when :dir = 'out' then e.to_kind || ':' || e.to_id else e.from_kind || ':' || e.from_id end)
  from walk w join idx_edges e
    on e.org = :org
   and ((:dir = 'out' and e.from_kind = w.kind and e.from_id = w.id)
     or (:dir = 'in'  and e.to_kind   = w.kind and e.to_id   = w.id))
  where w.depth < 2
    and not (e.to_kind || ':' || e.to_id = any(w.path))
)
select kind, id, via, depth from walk where depth > 0;
```

Labels (`via`) are the table's italic words, one per `rel`, defined once in
`domain/console.py` `VIA: dict[str, str]`. A `rel` without a label is a
test failure (`every_rel_has_a_via_label`, V1).

## 6. Log sentences

One template per audit action; the template is the *only* place the sentence
is built (K6), in `domain/console.py` `SENTENCES`. `{actor}` is the actor's
name, `{team}` the unit's name. Categories per PRD §19.

| Action | Category | Sentence | git-backed |
| --- | --- | --- | --- |
| `session.open` | harness | *{actor} started {harness} on {provider} · {model}* | — |
| `session.refuse` | harness | *{actor} could not start {harness}: {blockers[0].message}* | — |
| `session.revoke` | harness | *{actor}'s session on {harness} was ended: {reason}* | — |
| `session.retire` | harness | *the {alias} credential was rotated during {actor}'s session* | — |
| `session.close` | harness | *{actor} closed {harness} · {n} endpoints reached · {refused} refused* | — |
| `session.endpoint` | — (feeds `/endpoints`, never a log row) | | |
| `asset.push` | harness | *{actor} kept a change to {kind} {name}* | yes |
| `asset.promote` | harness | *{actor} promoted {kind} {name} to {team}* | yes |
| `asset.rollback` | harness | *{actor} rolled {kind} {name} back to {date}* | yes |
| `asset.approve` | harness | *{actor} accepted {kind} {name}* | yes |
| `asset.edit` | harness | *{actor} edited {kind} {name}* | yes |
| `asset.delete` | harness | *{actor} removed {kind} {name}* | yes |
| `request.open` | harness | *{actor} offered {n} files to {team}: "{title}"* | yes |
| `request.accept` | harness | *{actor} accepted "{title}" from {author} into {team}* | yes |
| `request.decline` | harness | *{actor} declined "{title}": {reason}* | — |
| `request.withdraw` | harness | *{actor} withdrew "{title}"* | — |
| `harness.create` / `harness.delete` | harness | *{actor} created the harness {name}* / *…deleted {name} ({n} things were in it)* | yes |
| `harness.add_assets` | harness | *{actor} added {n} to {harness}* | yes |
| `grant.create` | permission | *{actor} granted {group} to {teams}* | yes |
| `grant.narrow` | permission | *{actor} narrowed {group} into {team}: {aliases}* | yes |
| `grant.remove` | permission | *{actor} took {group} back from {teams}* | yes |
| `boundary.set` / `boundary.remove` | permission | *{actor} added a boundary for {scope}: {value}* / *…lifted…* | yes |
| `reach.set` | permission | *{actor} set reach at {team} to {mode} ({n} hosts)* | yes |
| `reach.allow_host` | permission | *{actor} let {team} reach {host}* | yes |
| `reach.deny_host` | permission | *{actor} stopped {team} reaching {host}* | yes |
| `vault.connect` | permission | *{actor} connected {vault}* | — |
| `group.create` | permission | *{actor} created the security group {group} ({n} entries)* | yes |
| `key.rotate` | permission | *{actor} rotated {name}* | — |
| `provider.approve` / `provider.beta` / `provider.decline` | provider | *{actor} approved {provider} for {scope}* / *…moved {provider} to beta…* / *…declined {provider}: {reason}* | yes |
| `routing.change` | provider | *{actor} set {model_provider} as default for {target}* | yes |
| `member.add` / `member.invite` / `member.remove` / `member.role` | people | *{actor} added {person} to {team}* / *…invited {email} to {team}* / *…removed {person} from {team} ({n} groups lost)* / *…made {person} a {role} at {team}* | — |
| `console.read_as` | people | *{actor} read {person}'s versions* | — |

A payload field the template needs that is absent renders the row with the
template's fallback (`{harness}` → *a harness*) and increments a metric —
never an empty sentence, never a stack. V1 test `every_action_has_a_sentence`
asserts the template table covers every action string in `audit.py` and
engine 04 §8.

### 6.2 `EndpointRow` aggregation — W5-D4

One row per **attempt kind**, not per host: the same host refused for two
reasons is two things to do something about (engine 05 §8). `reason` and
`setBy` ride along because every refusal names the rule that refused it and
the node that owns that rule (P11, engine D133), and `setBy` is where the
Endpoints tab's **Allow** writes.

```sql
select (payload->>'host') host, (payload->>'port')::int port, payload->>'alias' alias,
       case when (payload->>'status') = 'stripped' then 'stripped'
            when (payload->>'status') ~ '^[0-9]+$' then 'reached'
            else 'refused' end outcome,
       coalesce(payload->>'reason', '') reason,
       coalesce(payload->>'setBy', '') set_by,
       count(*) as count,
       min(created_at) first_at, max(created_at) last_at,
       count(distinct payload->>'session') sessions
from audit_log
where action = 'session.endpoint' and org_unit_id = any(:scope_units)
  and created_at >= :since
group by 1, 2, 3, 4, 5, 6
order by last_at desc;
```

`harnesses: Related` is a second query over the sessions in the group.

**The three outcomes.** Three, not two: a model request that went with a
provider-side browsing capability taken out of it is neither reached nor
refused (engine D134).

| `outcome` | From `status` | The word |
| --- | --- | --- |
| `reached` | a numeric HTTP status | *reached* |
| `refused` | anything else | *refused* |
| `stripped` | `stripped` | *stripped* |

**The reasons, in plain words.** `EndpointEvent.reason` is one machine word
and the console says it as a sentence. A reason this table does not know
prints as it came: a sentence invented for it would be a claim (K2).

| `reason` | The sentence |
| --- | --- |
| `reach.off` | *Reach is off here, so only credentialed hosts resolve.* |
| `reach.not-listed` | *It is not on the allow-list.* |
| `reach.denied` | *It is on the deny-list.* |
| `port` | *Only port 443 is open.* |
| `boundary` | *A boundary denies it.* |
| `bad-secret` | *Something tried the proxy without the session secret.* |
| `stripped:<names>` | *{names} not sent: the provider may not browse on its own side either.* |

**`setBy`** is a node path or `harness:<id>`, and neither is ever shown: the
console renders the level's own word (01 §4.4's `levelLabel`) or the
harness's name. `AllowAction` carries the rest — `can`, the `?scope=` the
write takes, and the one sentence for when it may not (04 §14.1).

## 7. Schema deltas (records)

```sql
-- 0031_requests.sql  (prd-v2 §13 Request; console 00 §4.4)
create table requests (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org_units(id),        -- the team decided at
  harness_id uuid not null,
  author_auth_user_id uuid not null,
  title text not null check (length(title) between 1 and 120),
  reasoning text not null default '',
  paths text[] not null check (cardinality(paths) between 1 and 200),
  commit text not null,                                        -- the author's ref at open
  base_commit text not null,                                   -- the team ref at open; stale = moved since
  state text not null default 'open' check (state in ('open','closed')),
  decision text check (decision in ('accepted','declined','withdrawn')),
  decided_by uuid, decided_at timestamptz, reason text,
  created_at timestamptz not null default now()
);
create index requests_org_unit_id_state_created_at_idx on requests (org_unit_id, state, created_at desc);
create table request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  author_auth_user_id uuid not null, text text not null check (length(text) <= 4000),
  created_at timestamptz not null default now()
);
alter table requests enable row level security;
alter table request_comments enable row level security;

-- 0032_people.sql
alter table org_unit_members add column deactivated_at timestamptz;

-- 0033_session_preflight.sql  (console D7)
alter table harness_sessions add column preflight jsonb;    -- PreflightReport, no values by construction
```

## 8. API conventions

Apply to every route under `/v1/`, new and existing; existing routes that
disagree are brought into line in the milestone that touches them (06).

1. **Nouns plural, one segment per resource:** `/v1/requests/{id}`,
   `/v1/console/harnesses/{id}/files/{assetId}`. No verbs in paths except
   **state transitions as sub-resources**: `/accept`, `/decline`,
   `/withdraw`, `/revoke`, `/approve`. Never `/get…`, `/list…`, `/update…`.
2. **Methods.** `GET` list → `{ items, next? }`; `GET` one → the object;
   `POST` create → `201` + the object; `POST` transition → `200` + the
   object; `PATCH` partial with only the fields sent; `PUT` full replacement,
   idempotent; `DELETE` → `204`.
3. **Pagination** as §4: `?cursor=&limit=`, keyset, opaque cursor. Never
   `?page=`.
4. **Errors.** One envelope everywhere: `{ code, message, remedy?, detail? }`.
   `remedy` is **added** (D30) so an API error and a `Blocker` render through
   one component. `code` is namespaced by resource:
   `request.not_open`, `grant.not_subset`, `session.not_owned`,
   `console.scope_forbidden`. Validation is `422 invalid_request` with
   `detail.errors: [{ field, reason }]`. Conflicts are `409` with the current
   head in `detail`. **Every `403` body names who decides** in `message`
   (P13): *"Accepting publishes to everyone on Marketing, so a team admin
   decides it."*
5. **`?scope=`** and **`?as=`** as §4. `as` is never accepted on a write.
6. **Bulk** only where the PRD names a bulk verb: `POST /v1/requests/{id}/accept`
   accepts the whole request (PRD §17.3 *accept all n*); offering
   "everything" is the CLI's `offer` over many paths — one request, not many
   calls. No generic batch endpoint.
7. **Times** ISO 8601 UTC with `Z`; ids uuid strings; money never.
8. **Console reads** under `/v1/console/*` (00 D1) are `GET` only; a write
   under `/v1/console/` is a bug.
9. **Every write that touches a ref** goes through `domain/commits.py`
   `commit_on_ref(org, ref, author, message, changes) → commit` (00 D9),
   which calls `definitions:/internal/commit` and appends the audit event in
   one function. No route calls `definitions` directly.
10. **OpenAPI** is generated from the routes and is the source of
    `lib/api.generated.ts` (00 D3); every response model is a pydantic
    class named for its 00 §4 type (`HarnessView`, `SessionRow`), so the
    generated names match the plan.

## 9. Database naming

| Rule | Example |
| --- | --- |
| tables `snake_case`, plural | `requests`, `request_comments` |
| derived index tables prefixed `idx_`; record tables unprefixed; nothing else prefixed | `idx_edges` · `harness_sessions` |
| columns `snake_case`; FKs `<noun>_id`; timestamps `<verb>ed_at`; actors `<verb>ed_by` or `<role>_auth_user_id` | `harness_id`, `decided_at`, `decided_by` |
| jsonb columns named for their type, singular for one object, plural for a map or list | `preflight`, `slots`, `commits`, `payload` |
| enums as `text` + `check (col in (...))`; the values listed in the migration's header comment with the PRD section that defines them | `state in ('open','closed')` |
| functions `verb_noun`; triggers `<table>_<event>_<purpose>` | `ensure_partition_for`, `org_units_role_order` |
| indexes `<table>_<col>[_<col>]_idx`; partial indexes say why in a comment | `requests_org_unit_id_state_created_at_idx` |
| migrations `NNNN_<what>.sql`, one change each, header comment naming the PRD/engine/console section; **never edit a merged migration** | `0031_requests.sql — console 03 §7` |
| RLS enabled on every table, no policies (engine C36: a lockout); `api` roles: `harness_api` (records, read index) and `harness_index` (index tables, write) | |
| authoritative audit in the same transaction as the act; hash-chained per unit; **a value string never appears in a payload** (negative test `no_value_in_audit`) | |

## 10. UI table standards

Checkable rules for every table on the console (PRD §14 principles 3–4; P3,
P4). The `Table` component (01 §3) consumes a `Column<Row>[]` spec declared
**once per object** in `lib/columns/<object>.ts` — two screens showing
harnesses import the same spec and may only *select* columns from it, never
redefine a heading.

| # | Rule | Checked by |
| --- | --- | --- |
| T1 | Every column has a heading; a relationship column's heading names its unit (*Granted to teams*, *Only for harnesses*) | type: `Column.heading` required; `Related` columns require `unit` |
| T2 | A scale column renders `ScaleTag`; the value must be in the registry | `ScaleTag` throws in dev on an unregistered value; V2 `scale_tag_unregistered_throws_in_dev` (01 §13) |
| T3 | A relationship column renders `Related`; `all: true` renders *All teams* (or the unit), never the full list | V2 |
| T4 | Description is a column with a heading, never an unlabelled second line | lint: no `Td` without a `Column` |
| T5 | Default sort stated per spec (`Column.sort` on exactly one column) | type |
| T6 | One row height; no expanding rows — detail is a destination (P1) | V2 snapshot |
| T7 | Empty cell renders `—`, never blank | `Table` renders `—` for `null`/`undefined`/`[]` |
| T8 | Numbers right-aligned, unit in the heading (*Files*, *Endpoints reached*) | `Column.kind = "number"` |
| T9 | Dates relative (*2 days ago*) with the absolute on hover | `Column.kind = "time"` |
| T10 | The row is a link (`<a>`) to the object; no `div onClick`; keyboard: ↑/↓ moves focus row by row, Enter opens | V2 `table_rows_are_links`, `table_keyboard_row_navigation` (01 §13) |
| T11 | Provenance is visible: observed cells carry the *Checked just now* affordance, derived cells *Connected*, declared cells *Set by* on hover (P2) | `Column.kind = "fact"` |
| T12 | A hidden view (P10) renders the hiding sentence in place of the table, not an empty table | V3 `hidden_view_says_so` |

`Column<Row>` is 00 §4.2's; `kind` picks the renderer, `unit`/`scale` are required by kind, and `help` carries the `(?)` text from the screen's content module (05 §3).

### 10.1 Verbs, as the defaults manifest names them

`engine/compose/presets/index.json` (engine 01 §4.2, engine D146) says for every
out-of-the-box default which screen manages it and **which verbs that screen
offers**. The word in the manifest is the word in the code and the word on the
screen, in that order of proof: `scripts/check-defaults.py` finds each verb in
the screen's own route directory or in a `<subject>-writes.spec.tsx` test name,
and only then is §4's *Verbs by role* table (04) read as prose beside it. The
vocabulary is small on purpose — one word per control, lower case, hyphenated
when the control is two words:

| Verb | The control | Where it is proved |
| --- | --- | --- |
| `read` | the screen lists the thing at all; no write | the route directory |
| `add` · `remove` | an item joins or leaves a list the level owns (a reach host, a boundary) | `reach-writes.spec.tsx`, `boundary-writes.spec.tsx` |
| `edit` | a row's own fields change in place (`PATCH`) | `asset-writes.spec.tsx` |
| `delete` | the thing leaves the branch | `asset-writes.spec.tsx` |
| `mode` | a scale is set — the three reach modes, not a free field | `reach-writes.spec.tsx` |
| `approve` · `decline` | an organisation admin's judgement on a provider, with a reason on the refusal | `providers/` |
| `pin` · `scope` | the two other columns of a harness provider row: what version it is held at, and who may run it | `providers/` |
| `set-up` | a credential is attached to a model provider for the first time | `providers/model/` |
| `default` | a routing choice is made from the row that will serve it | `providers/model/` |
| `loads` | an asset's place on `always-loaded.json` is set (*required* · *recommended* · *on request*) | `assets/` |

A verb only the docs mention is a finding, which is the half of this that
matters: a default is not *managed* because a screen says so, it is managed
because the control is there.

## 11. Failure modes

| Code | Status | Message | Remedy |
| --- | --- | --- | --- |
| `console.scope_forbidden` | 403 | *This view belongs to {team}; its admins and organisation admins can open it.* | *Ask a {team} admin, or open your own view.* |
| `console.as_forbidden` | 403 | *You can read a member's versions only for teams you administer.* | *Pick a member of {your teams}.* |
| `console.harness_not_found` | 404 | *No harness with that id is on your chain.* | *`harness switch` lists yours.* |
| `console.file_not_found` | 404 | *{path} is not in this harness for you.* | *Open the harness and pick a file.* |
| `console.hidden` | 200 + `hidden` | *An organisation admin has turned this view off.* | *Ask an organisation admin.* |
| `console.definitions_unavailable` | 503 | *File contents are unavailable right now; the rest of the page is current.* | *Try again in a moment.* |
| `console.index_stale` | 200 + `stale` | *The index is behind the repository since {since}.* | *Nothing to do; it catches up on its own.* |
| `request.not_open` | 409 | *This request was {decision} by {by} on {at}.* | *Open it to read the decision.* |
| `request.not_author` | 403 | *Only the author can withdraw a request.* | — |
| `request.decider_required` | 403 | *Accepting publishes to everyone on {team}, so a team admin decides it.* | *Ask {admins}.* |
| `grant.not_subset` | 422 | *A narrowed grant may only keep entries {team} already holds.* | *Untick {aliases}.* |
| `grant.outside_subtree` | 422 | *{team} is not inside {your team}.* | *Pick a sub-team of yours.* |
| `boundary.not_yours` | 403 | *That boundary was set at {node}; only its admins can lift it.* | — |
| `session.not_visible` | 404 | *No such session in your view.* | — |

## 12. Tests

**V1** (`web/lib` and `backend/tests/test_console.py`, pure): `every_action_has_a_sentence`, `sentence_fallbacks_never_empty`, `every_rel_has_a_via_label`, `preflight_rule_prefers_matching_commits`, `preflight_dry_check_three_clauses`, `differs_classification`, `owner_from_path`, `cursor_roundtrip`.
**V3/V4** (routes against a scratch DB seeded from the engine fixtures): `member_cannot_read_sibling_team`, `as_requires_admin_over_member`, `as_is_audited`, `as_refused_on_writes`, `hidden_view_says_so`, `stale_index_flags_not_refuses`, `vault_reachable_is_observed_not_stored`, `groups_related_all_teams_when_all`, `edge_walk_two_hops_directed`, `secret_walk_reaches_harnesses`, `requests_stale_when_team_moved`, `sessions_scope_by_subtree`, `no_value_in_audit`, `every_403_names_decider`, `openapi_names_match_00`.

## 13. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D30 | The error envelope gains `remedy?` so API errors and `Blocker`s render through one component. Additive. | — |
| D31 | `header.preflight` uses **commits equality**, not a time window: a session counts only if it ran on the refs the index holds now; otherwise a three-clause dry check. | a time window (worse: a stale pass reads as current) |
| D32 | `Differences` is computed client-side from `mine` + `team`; `conflict` is shown only when the latest session's composed tree disagrees with both, else `both`. The console has no `refs/harness/remote`. | a server endpoint that reads the person's machine — impossible |
| D33 | Reading `as` a member is audited (`console.read_as`) at the admin's unit and surfaces in the member's People log. | silent reads (PRD §18 says the member is told) |
| D34 | Observed probes (`/vaults`) run in parallel with a 3 s budget; a timeout is `reachable: false, provenance: observed`, never an error page. | serial probes; longer budget |
| D34a | A model provider's probe runs **only when a key is held** (W6-D6): *held* is a group entry in a connected vault, read from the composed policy, so a fresh organisation's three keyless presets cost no network at all and the probe answers one question — *is this endpoint up* — instead of two. | probing every row and reporting *not reachable* for a provider nobody has given a key |
| D35 | `lastEditor` is fetched lazily per page of rows from `definitions:/internal/log`, request-scoped cache only. | denormalising last-editor into `idx_assets` at index time (faster; stale on user-ref pushes only if the indexer misses them — acceptable later) |
| D36 | `/how` is served by `api`, not bundled, so the CLI and console print identical words (P14). | bundling in the web app |
| D37 | `requests` is a records table (`api`), not a file on a branch: it has a state machine and comments, which are records, while the paths it names are refs. | `requests/<id>.json` on the team branch |
| D38 | Index-stale flags reads and never refuses them; only the broker fails closed (engine 02 §8.4). | refusing console reads (an outage for a paged operator's problem) |

## 14. Out of scope

The public site's `request_access` RPC and its table; SIEM export and
webhook streaming of the audit chain (prd-v2 Later); full-text search
(`/search` is a prefix match on names, §4.9); reporting or cost
dashboards (native sessions are *not metered* — P16 — and metering beyond
`usage` on inject is Later); any write under `/v1/console/`.

## 15. Definition of done

- `routes_console.py` + `domain/console.py` ≤ 900 lines; every endpoint in
  00 §4.10 exists and returns exactly its 00 §4 type; OpenAPI names match
  (`openapi_names_match_00`).
- `SENTENCES` covers every action in `audit.py` and engine 04 §8; `VIA`
  covers every `rel` in engine 02 §8.2.
- Every test in §12 exists by name and passes against a scratch DB seeded
  from `engine/compose/fixtures/`.
- The error envelope carries `remedy` and every `403` in this document
  names who decides.
- `lib/columns/<object>.ts` exists for every object in §5 of 00, and no
  screen declares a column heading outside it (lint rule in 02).
- `Column<Row>` is in 00 §4.2 and the three read-only `definitions`
  endpoints are in engine 02 §5.3 and engine 00 §4.10 (they are); engine 04
  §6 lists the `preflight` column this document adds in §7.
