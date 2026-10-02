# Engine Plan — 02 · The definitions service

The definition plane's server: bare git repositories, one per organisation,
served over smart-HTTP with **per-ref authorisation**, validated on every
push, and mirrored into a **derived index** in Postgres that the console and
the broker read. It is the one stateful service we own, and it is the source
of truth.

Contracts: [`00 §4`](00-overview.md). Layout of what is *in* the repos:
[`01-repository.md`](01-repository.md). This document says how those bytes
are stored, protected, validated, indexed, and migrated to.

---

## 1. Purpose

Make `prd-v2.md` §5.3 true: *a branch you are not on is a branch you cannot
read.* Everything else here exists so that statement holds without the
console, the broker or the CLI having to trust each other.

## 2. Invariants honoured

| | |
| --- | --- |
| I1 | Definitions are git. The repos hold no secret value, ever — pre-receive refuses a push that contains one (§7 step 8). |
| I2 | Composition runs here, post-receive, with the same `compose()` the CLI runs (D2). |
| I4 | Per-ref authorisation is enforced by the transport, not by a client check. |
| I5 | A push that cannot be validated or indexed is refused or flagged stale; the broker refuses to mint against a stale index (§9). |
| C34 | Audit rows are written through `api`, so the per-unit hash chain has one writer. |
| C35 | Reach is decided here and in `api`; no provider is involved. |
| C36 | Amended: **`api` is the only client of records; `definitions` is the only writer of the index.** Its Postgres role owns `idx_*` and nothing else (D40). |

## 3. Contracts used

`Chain`, `ChainNode`, `Sidecar`, `Composed`, `ComposedAsset`, `Conflict`,
`Grant`, `SecurityGroup`, `Boundary`, `HarnessDef`, `HarnessProvider`,
`ModelProvider`, `Routing`, `Blocker` — all from `00 §4`, none redeclared.
`compose(chain, reader)` and `Reader` from `@harness/compose` (00 §4.4).

---

## 4. Service layout

```
engine/definitions/
  src/
    index.ts         listen; route smart-HTTP and /internal; own the unix socket the hooks call back on
    auth.ts          token → { principal, chain } via api, cached ≤ 30 s
    transport.ts     spawn `git http-backend` with the per-request environment (§6)
    hooks/
      pre-receive    #!/usr/bin/env node — shim: forwards stdin + env to main over the socket, exits with its answer
      post-receive   same shim
    reader.ts        the `Reader` (00 §4.4) over a bare repo: ls = `ls-tree`, cat = one long-lived
                     `cat-file --batch`, write = `hash-object -w --stdin`, mktree = `mktree` — memoised by oid per request
    validate.ts      the pre-receive rules (§7): runs compose() over the pushed chain and maps Conflicts to codes
    index.ts         compose affected chains and upsert idx_* (§8)
    internal.ts      /internal/* handlers (§5.3)
    git.ts           the one place `git` is spawned; every call carries the flags in §6.4
    migrate/         the one-shot exporter (§11); deleted after cutover
  fixtures/          → symlink to engine/compose/fixtures (T2/T4 conformance)
```

Storage: `$DEFINITIONS_ROOT/<org-id>.git`, bare, `core.sharedRepository=group`,
`receive.denyNonFastForwards=true`, `receive.fsckObjects=true`,
`core.hooksPath=$DEFINITIONS_HOOKS` set *per process* (§6.4), never in the
repo's config file — so a repo restored from a bundle behaves identically.

Zero runtime dependencies. `node:http`, `node:child_process`, `node:net`,
`node:crypto`; Postgres over a minimal wire client we write? **No** — that
would exceed the budget. `definitions` speaks to Postgres through `psql` is
also wrong (a process per upsert). Decision D41: the index is written by
calling `api`'s **internal index endpoint** with the composed result, and
`api` performs the upsert under a role limited to `idx_*`. This keeps the
zero-dependency rule, keeps one Postgres client library in the system, and
still satisfies amended C36 because the endpoint accepts only index rows and
is reachable only with the service token. The role split is enforced in
Postgres regardless of which process holds the connection.

### 4.1 Environment

| Variable | Meaning |
| --- | --- |
| `DEFINITIONS_ROOT` | directory of bare repos |
| `DEFINITIONS_HOOKS` | directory containing the two shims |
| `DEFINITIONS_SOCK` | unix socket the shims call back on; created 0600 at start |
| `DEFINITIONS_LISTEN` | `host:port` for smart-HTTP and `/internal` |
| `API_URL`, `HARNESS_SERVICE_TOKEN` | how `definitions` reaches `api`; the same token is accepted inbound on `/internal` |
| `DEFINITIONS_QUOTA_BYTES` | per-repo ceiling (default 2 GiB) |

Service-to-service authentication is a **shared bearer token over a private
network** (D42). mTLS is Later; the token is rotated like any key and never
appears in a repo or a log.

---

## 5. HTTP surface

### 5.1 Smart-HTTP (people, via the CLI)

```
GET  /<org-id>.git/info/refs?service=git-upload-pack
POST /<org-id>.git/git-upload-pack
GET  /<org-id>.git/info/refs?service=git-receive-pack
POST /<org-id>.git/git-receive-pack
```

Credential: `Authorization: Bearer <login token>` — the token
`~/.config/harness/credentials.json` holds. The CLI sends it per invocation
with `-c http.extraHeader=Authorization: Bearer …` (01 D36), so it is never
written to `assets.git/config` or a remote URL. HTTP Basic (`harness` /
token) is also accepted, for a person running `git` by hand against their
clone. Either way the token never appears in a log line (§12).

### 5.2 Authentication and the chain

```
1. token := Bearer from `Authorization`, else the Basic password. Missing → 401,
   WWW-Authenticate: Bearer realm="harness", Basic realm="harness".
2. key := sha256(token). Cache hit (≤ 30 s old) → step 5.
3. GET {API_URL}/v1/internal/principal   Authorization: Bearer {SERVICE_TOKEN}
                                        X-Harness-Token: {token}
   → 200 { user_id, org_id, chain: ChainNode[] (commit fields empty), readable: string[] }
       readable = further refs this person may fetch: for a team admin, refs/heads/users/<id> of every
       member of a team at or under role.at (prd-v2 §18 "read a member's branch"; 08 `--as`). Empty for a member.
   → 401 → respond 401 to the client
   → 5xx / timeout → respond 503 "definitions.api_unreachable"; never fall back to a stale cache entry older than 30 s
4. Cache { user_id, org_id, chain } under key for 30 s.
5. org_id must equal the <org-id> in the path → else 404 (not 403: the repo's existence is not confirmed to outsiders).
```

`api`'s `GET /v1/internal/principal` is `api`'s to build (it owns
`org_unit_members` and `org_unit_admins`); the chain it returns is the
person's own: `[org, team…, user]` root first (00 §4.1). **`definitions` has
no chain endpoint of its own** — the directive's `GET /internal/chain/{user}`
is served by `api`, because membership is a record (C36).

### 5.3 Internal endpoints (`api` → `definitions`, service token)

| Method | Path | Body → Response | Used for |
| --- | --- | --- | --- |
| `POST` | `/internal/orgs` | `{ org_id, node_path }` → 201 | create the bare repo and `refs/heads/org` (orphan, empty tree); `node_path` is the dotted org path, recorded in the root commit |
| `POST` | `/internal/orgs` then `/internal/branches` | one sign-up sequence → 201, 201 | personal edition (engine 00 D30f, prd-v2 §12.1): `api` creates the org repo and the person's user ref in one call sequence; there is no team ref. The chain is `org · user`; nothing else differs. |
| — | `platform.git` | — | one reserved repository, created empty at M2 (engine 00 D30g, prd-v2 §12.2): assets under `assets/`, no `policy/`, no `harnesses/`. Never advertised to a customer; read only by `api`'s `/v1/platform/*` (not built) and by the `publish` request flow, which commits into a customer's ref through `/internal/commit` after that org's admin accepts — never directly. |
| `POST` | `/internal/branches` | `{ org_id, ref, node_path }` → 201 | create a team or user branch: **orphan commit, empty tree** (D43), message `created <node_path>` |
| `POST` | `/internal/commit` | `CommitRequest` → `{ commit }` \| 409 `{ head }` | promote, accept, rollback, admin edits, revoking a grant — every write that is not a person's own push |
| `GET` | `/internal/tree/{org}/{commit}/{path}` | → tree listing or blob (base64) | the console's file views |
| `GET` | `/internal/log/{org}/{ref}?path=&limit=` | → commits with author, time, message, paths | History panels (prd-v2 §17.2) |
| `GET` | `/internal/diff/{org}/{a}/{b}?path=` | → unified hunks | Differences, requests, conflicts |
| `POST` | `/internal/reindex/{org}` | → `{ chains, ms }` | rebuild the index from the repo (§8.5) |

```ts
interface CommitRequest {
  org_id: string;
  ref: string;                       // refs/heads/org | refs/heads/teams/<path> | refs/heads/users/<id>
  expectedHead: string | null;       // compare-and-swap; null only when creating
  author: { userId: string; name: string; email: string };
  message: string;
  changes: Array<
    | { path: string; from: { commit: string; path: string } }   // copy a tree or blob from another commit (promote)
    | { path: string; blob: string }                             // base64 (admin edit of a policy file)
    | { path: string; delete: true }
  >;
  reason: { kind: "promote" | "accept" | "rollback" | "admin-edit" | "grant" | "revoke"; request?: string };
}
```

`/internal/commit` runs the **same** validate → update-ref → index sequence
as a push (§7, §8), through one function, `applyRefUpdate(org, ref, old,
new, actor)`. There are two callers and one implementation; a hook and an
internal commit cannot diverge.

**Why `api` never runs git (D2).** `api` would need a checkout, a git binary,
and a second copy of the composition and validation rules. Every such copy
is a place for the two to disagree about what a person may see. `api` asks;
`definitions` answers; the answer is derived from the same code the CLI
runs.

---

## 6. Per-ref authorisation

### 6.1 The mechanism

Every smart-HTTP request spawns `git http-backend` as a CGI child with an
environment computed *for this request*:

```
GIT_PROJECT_ROOT   = $DEFINITIONS_ROOT
GIT_HTTP_EXPORT_ALL= 1
PATH_INFO          = /<org-id>.git/<rest>
REQUEST_METHOD, QUERY_STRING, CONTENT_TYPE, CONTENT_LENGTH  (from the request)
REMOTE_USER        = <user_id>
HARNESS_ACTOR      = <user_id>            read by the hooks
HARNESS_CHAIN      = <json ChainNode[]>   read by the hooks
GIT_CONFIG_COUNT   = N
GIT_CONFIG_KEY_0   = transfer.hideRefs        GIT_CONFIG_VALUE_0 = refs
GIT_CONFIG_KEY_1   = transfer.hideRefs        GIT_CONFIG_VALUE_1 = !refs/heads/org
GIT_CONFIG_KEY_2   = transfer.hideRefs        GIT_CONFIG_VALUE_2 = !refs/heads/teams/acme.marketing
GIT_CONFIG_KEY_3   = transfer.hideRefs        GIT_CONFIG_VALUE_3 = !refs/heads/users/<user_id>
GIT_CONFIG_KEY_4   = uploadpack.allowAnySHA1InWant       = false
GIT_CONFIG_KEY_5   = uploadpack.allowTipSHA1InWant       = false
GIT_CONFIG_KEY_6   = uploadpack.allowReachableSHA1InWant = false
GIT_CONFIG_KEY_7   = receive.hideRefs                    = refs      (+ the same ! entries)
GIT_CONFIG_KEY_8   = core.hooksPath                      = $DEFINITIONS_HOOKS
GIT_CONFIG_KEY_9   = receive.denyNonFastForwards         = true
GIT_CONFIG_KEY_10  = receive.fsckObjects                 = true
GIT_CONFIG_KEY_11  = receive.maxInputSize                = $DEFINITIONS_QUOTA_BYTES
```

**Protocol v0 only.** Git protocol v2's `fetch` accepts a `want` for any
object the server has, which defeats `hideRefs` regardless of the
`allow*SHA1InWant` settings. The transport never sets `GIT_PROTOCOL` or
`HTTP_GIT_PROTOCOL`, so upload-pack runs v0;
`hidden_ref_object_not_fetchable_by_sha` runs under both versions and both
must refuse.

`GIT_CONFIG_COUNT`/`KEY`/`VALUE` is the environment form of `-c`, honoured
by `http-backend` and inherited by the `upload-pack` and `receive-pack` it
spawns. `transfer.hideRefs=refs` hides everything; each `!` entry un-hides
one ref. The chain **plus `readable`** is the un-hide list — a team admin
therefore also fetches their members' user refs, and nobody else's. **The three `allow*SHA1InWant`
settings are `false`, so a client may only `want` a commit that was
advertised.** A hidden ref's tip is not advertised, therefore not wantable,
therefore its objects are not sent — unless the same object is reachable
from an advertised ref, in which case the person may have it anyway. That is
the whole argument, and it is git's own, used by gitolite for a decade.

Test T4 `user_cannot_fetch_sibling_team_ref`: as a Marketing user, `git
fetch` advertises `org`, `teams/acme.marketing`, `users/<me>` and nothing
else; `git fetch origin <sha-of-engineering-tip>` fails with `not our ref`.

### 6.2 Push

A person may push exactly one ref: their own, fast-forward only. Enforced in
the `update` phase of our pre-receive (§7 step 1), not by client convention.
Every other write is an internal commit by `api` on the person's behalf,
which is what gives promote, accept and rollback an audit row, a request id
and a decision record (prd-v2 §13).

Tests T4: `user_cannot_push_team_ref` (refused, message §10 row 2);
`admin_promote_goes_through_internal_commit_not_push` (a team admin's raw
push to `teams/<path>` is refused identically; the same change via
`/internal/commit` succeeds and produces one `definitions.commit` audit row
with `reason.kind = "promote"`).

### 6.3 Hooks are ours

C30 disables hooks **in the person's clone**, because the jail can write that
work tree. The server's hooks live in `$DEFINITIONS_HOOKS`, outside any repo,
owned by the service, and are the enforcement point for validation. They are
two 20-line shims that connect to `DEFINITIONS_SOCK`, forward `stdin` (the
`old new ref` lines) and `HARNESS_ACTOR`/`HARNESS_CHAIN`/`GIT_DIR`/
`GIT_QUARANTINE_PATH`, and exit with the code the service returns — so the
rules live in `validate.ts`, tested at T1, not in a shell script.

### 6.4 Every git invocation

```
git -c core.hooksPath=<hooks or /dev/null> -c core.fsmonitor=false -c gc.auto=0 \
    --git-dir=$DEFINITIONS_ROOT/<org>.git <command…>
```

`gc.auto=0` because maintenance runs on our schedule (§12), never inside a
request. All object reads in validation and indexing go through the one
`Reader` in `reader.ts` (00 §4.4) — the same interface the CLI implements over
`~/.harness/assets.git` — so `compose()` is byte-for-byte the same code on
both sides.

---

## 7. Pre-receive validation

Runs once per push (or internal commit) with the new objects readable from
`GIT_QUARANTINE_PATH`. Input: lines `old new ref`; the chain; the actor.
**Any refusal refuses the whole push** and prints the messages below,
prefixed `remote:`, which the CLI shows verbatim and the console shows in
the request. Numbered; the code cites the numbers.

**Steps 5–7, 9 and 11–14 are not re-implemented here.** `validate.ts` runs
`compose()` (00 §4.4) over the pushed chain — for a push to a team or org
ref, over every chain through that node is unnecessary: one chain ending at
the pushed node suffices, because every content fault on the pushed ref
surfaces on that chain — and refuses if any `Conflict` has `from` = the
pushed node. `compose()` never throws for content faults (00 §4.4); the
mapping from `Conflict.kind` to refusal code is §7.1. Steps 1, 2, 8, 10 and
15 are transport rules `compose()` does not know about and are checked
directly.

```
1.  Ref ownership.  Push (not internal): every ref must be refs/heads/users/<actor>.
                    Internal: any ref; the actor's right was checked by api.
2.  Fast-forward.   old must be an ancestor of new (or old = 0…0 only on /internal/branches).
3.  Load the org branch head's policy/kinds.json, policy/groups.json, policy/grants.json,
    policy/harness-providers.json, policy/model-providers.json, policy/routing.json, policy/always-loaded.json
                    (`always-loaded.json` is normalised into `{ required, recommended }` on the
                    way in, so every reader of the index sees one shape — W5-D10)
    — from the *new* org commit if this push is to org, else from the current head.
4.  Enumerate asset directories on `new`: every directory <kind>/<name>/ under assets/ (01 §4.2).
5.  Sidecar.        Each has asset.json parsing as Sidecar; id is a uuid; kind matches the directory's <kind>.
6.  Kind.           kind ∈ policy/kinds.json.
7.  Unique id.      No id appears twice on this branch.
8.  No secrets.     No file matches the secret patterns, owned here: `secret://[a-z0-9./-]+`, `AKIA[0-9A-Z]{16}`, This check applies to files under `assets/**` only: `policy/groups.json` legitimately holds `SecretRef`s.
                    `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `sk-[A-Za-z0-9]{20,}`, `ghp_[A-Za-z0-9]{36}`, `xox[bp]-`.
                    A group's entries hold SecretRef {vault, ref}, never a value.
9.  Same path, different id (D3).  For each asset at <kind>/<name>/ on new, if any wider node in the chain
                    holds <kind>/<name>/ with a different id → refuse.  (A narrower node is not consulted:
                    a team push cannot be refused because one member has a stray file.)
10. Branch kind rules.
      user branch:  may hold assets/ and harnesses/<own>.json only. Any policy/ file → refuse.
      team branch:  assets/, harnesses/, policy/boundaries.json, policy/grants.json (narrowed only).
      org branch:   everything in 01 §4.2, and only the org branch may hold policy/kinds.json,
                    policy/groups.json, policy/harness-providers.json, policy/model-providers.json,
                    policy/routing.json, policy/always-loaded.json and un-narrowed grants.
11. Policy shape.   Each present policy file parses to its 00 §4.3 type; unknown fields → refuse.
                    A SecurityGroup entry carries alias, secret {vault, ref}, upstream and attach:
                    `upstream` is an origin — scheme https, host, optional port, no path or query;
                    `attach.header` is an RFC 7230 token; aliases are unique within a group. `secret.vault` is
                    not checked here (vaults are `api` configuration, 04 §7); an unknown one is refused at mint.
                    (00 §4.3; the proxy relies on all three — 05.)
12. Narrowed grants.  Every Grant on a team branch has narrowedFrom; the source grant exists on org
                    or on an ancestor team; its scope.teams covers this node or an ancestor; aliases ⊆ the
                    source group's entry aliases; scope.teams ⊆ this node's subtree; harnesses, if given,
                    ⊆ harnesses owned in that subtree.  (prd-v2 §6.4, tighten only.)
13. Boundaries on a team branch: scope.teams ⊆ this node's subtree; holds is a declared value.
14. Harness files.  Each harnesses/<id>.json parses to HarnessDef, its filename equals its id, ids are
                    uuids; contents are not resolved here (an id that resolves to nothing is allowed — C18).
15. Quota.          Repo size after the push ≤ DEFINITIONS_QUOTA_BYTES.
```

### 7.1 Conflict → refusal

| `Conflict.kind` | Code |
| --- | --- |
| `same-path-different-id` | `definitions.id_conflict` |
| `duplicate-id-on-one-branch` | `definitions.duplicate_id` |
| `unknown-kind` | `definitions.unknown_kind` |
| `malformed` (sidecar) | `definitions.sidecar_missing` / `definitions.sidecar_invalid` by `why` |
| `malformed` (policy or harness file) | `definitions.policy_invalid` |
| `invalid-grant` | `definitions.grant_widens` / `definitions.grant_outside_subtree` by `why` |
| `reach-widened` | `definitions.reach_widens` |
| `reach-grant-retired` | `definitions.reach_grant_retired` |

Step 9 is the load-bearing one for the whole plan: it is what lets the
harness key on ids (prd-v2 §4.2) without re-creating the failure
`harnesses.md` §14 found. Tests T2 `prereceive_refuses_new_id_at_existing_path`
and `prereceive_accepts_override_with_team_id` (a user branch holding
`<kind>/<name>/` with the team's id is accepted, and composes as an override
with `shadows` set).

---

## 8. The index

### 8.1 What it is for

The console asks relational questions across every branch — *rotate this and
what breaks?*, *which teams does this reach?*, *what does Jo actually get?* —
and the broker asks *which grants cover this harness for this person right
now?* Git answers none of them without walking every ref. The index is those
answers, precomputed by the same `compose()` the CLI runs, and **rebuildable
from the repos alone** (`prd-v2.md` §3).

### 8.2 Schema

Owned by role `harness_index`; `api`'s record role has `SELECT` only.

```sql
create table idx_refs (
  org uuid not null, ref text not null, commit text not null,
  indexed_at timestamptz not null default now(),
  primary key (org, ref));

create table idx_stale (                              -- a ref whose index write failed; the broker refuses the org while any row exists
  org uuid not null, ref text not null, commit text not null,
  error text not null, at timestamptz not null default now(),
  primary key (org, ref));

create table idx_nodes (
  org uuid not null, path text not null, kind text not null check (kind in ('org','team','user')),
  ref text not null, parent_path text,
  primary key (org, path));

create table idx_assets (                             -- one row per (node, asset): placement
  org uuid not null, node_path text not null, id uuid not null,
  kind text not null, name text not null, tree text not null, sidecar jsonb not null,
  primary key (org, node_path, id));
create index on idx_assets (org, id);

create table idx_harnesses (
  org uuid not null, node_path text not null, id uuid not null,
  name text not null, def jsonb not null,
  primary key (org, id));

create table idx_policy (                             -- the parsed policy files per node, verbatim
  org uuid not null, node_path text not null, file text not null, body jsonb not null,
  primary key (org, node_path, file));

create table idx_effective (                          -- per person: the winning copy of each id
  org uuid not null, user_id uuid not null, asset_id uuid not null,
  from_path text not null, shadows_path text,
  primary key (org, user_id, asset_id));

create table idx_edges (                              -- the relationships; both directions are one row
  org uuid not null,
  from_kind text not null, from_id text not null,
  rel text not null,
  to_kind text not null, to_id text not null,
  primary key (org, from_kind, from_id, rel, to_kind, to_id));
create index on idx_edges (org, to_kind, to_id, rel);
```

Edge vocabulary (`from_kind rel to_kind`), the complete list:

| rel | from → to | Answers |
| --- | --- | --- |
| `placed_on` | asset → node | which teams an asset reaches (node + subtree) |
| `includes` | harness → asset | what a harness loads; which harnesses include an asset |
| `needs_alias` | asset → alias | which groups an asset can be satisfied by |
| `entry` | group → alias | compatible groups |
| `entry_secret` | group → secret (`vault:ref`) | rotate this secret → which groups |
| `entry_upstream` | group → origin | which groups (and so teams) reach this host |
| `grants` | grant → group | |
| `scoped_to` | grant → team · boundary → team · harness_provider → team | granted to teams / applies to |
| `only_for` | grant → harness · boundary → harness | narrowed to harnesses |
| `narrowed_from` | grant → grant | the sub-granting trail |
| `credential` | model_provider → alias | |
| `default_for` | model_provider → team / harness / harness_provider | routing |
| `approved_for` | model_provider → team / harness / harness_provider | routing |
| `speaks` | harness_provider → wire_format | `canRunOn` |
| `exposes` | model_provider → wire_format | `canRunOn` |

Two hops are joins on this table; the console never walks a repo.

`reach` was a rel and is not one now: 01 D132 retired the grant it came off.
Reach is `policy/reach.json`, read into `idx_policy` by the same walk over
`policy/` as every other file — per node, like `boundaries.json`, so a team's
row sits beside the organisation's and `api` narrows the two the way
`compose()` does (`console_index.narrow_reach`, one rule in two languages).

### 8.3 Indexing a push

Post-receive, **synchronous**: the push does not return success until the
index is written (D44). The person sees `remote: indexing… done (412 ms)`.

```
1.  Affected chains := every user whose chain contains the pushed ref
        org ref  → all users;  team ref → users in that subtree;  user ref → that user.
2.  read := memoised `git cat-file --batch` over the repo.
3.  For each affected user: composed := compose(chain(user), read).
4.  Rows := from composed and from the pushed ref's own trees:
        idx_refs (this ref), idx_assets (placements on this ref), idx_harnesses, idx_policy,
        idx_effective (per user), idx_edges (derived from policy + sidecars + harness defs).
5.  POST {API_URL}/v1/internal/index  { org, ref, commit, rows }   — one transaction in api:
        delete rows keyed by this ref/these users, insert the new set, delete any idx_stale row for this ref.
5b. If the push changed any path under policy/ or harnesses/ on an org or team ref:
        POST {API_URL}/v1/internal/policy-changed  { org, refs: [{ ref, commit, paths }] }   (00 §4.10)
        api revokes every active session whose chain includes the ref (04; C33 "a policy change ends the
        session"). A user-ref push never revokes: a person's own assets are not policy.
6.  On any failure in 3–5b: insert idx_stale (via the same endpoint's `stale` form), exit non-zero so the
    person sees `remote: index failed; an operator has been paged`, and the reconciler (§8.4) retries.
    The ref update has already happened — git semantics — which is why the broker consults idx_stale.
```

Performance target: an org-branch push in an org of 5,000 users indexes in
≤ 5 s. `compose()` over a memoised reader is dominated by tree reads, and
every team tree is read once per push, not once per user; measured at T4
`org_push_indexes_5000_users_under_5s` with synthetic repos.

### 8.4 Reconciler

Every 10 s: for each `idx_stale` row, re-run §8.3 steps 2–5 for that ref.
Success deletes the row. The broker refuses to mint for an org with any
`idx_stale` row (`broker.index_stale`, see 04) — a stale index fails closed,
never open.

### 8.5 Rebuild

`POST /internal/reindex/{org}` (and the CLI operator command `definitions
reindex <org>`): truncate the org's `idx_*` rows and run §8.3 for every ref.
Test T4 `reindex_equals_fresh_index`: index an org by a sequence of pushes,
snapshot `idx_*`; reindex; the snapshot is identical row for row.

### 8.6 What the broker reads

Three query functions in `api` (Python, over `idx_*`, read-only), named
here so 04 can cite them:

| Function | Returns | From |
| --- | --- | --- |
| `org_policy(org_id) -> EffectivePolicy` | the org's groups, providers, routing, kinds, always-loaded, org-level grants and boundaries — composed for the org node alone | `idx_policy` at `node_path = <org>` |
| `harness(org_id, harness_id) -> HarnessDef \| None` | the selected harness, or `None` if no node holds it | `idx_harnesses` |
| `effective_for(org_id, user_id) -> { chain, grants, boundaries, assets }` | the person's chain; every grant and boundary on it (narrowed grants included, already validated at push); the winning asset per id with its sidecar | `idx_nodes`, `idx_policy` for each node, `idx_effective` ⋈ `idx_assets` |

Each raises `IndexStale` if `idx_stale` has any row for the org; the broker
turns that into `broker.index_stale` and refuses to mint (04). The broker
re-derives *grants covering this harness for this person* itself from
`effective_for` — it does not trust the CLI's `Choices` (I4). The guarantee:
`idx_refs.commit` for `refs/heads/org` equals the org branch head, or an
`idx_stale` row exists. There is no third state.

---

## 9. Staleness, precisely

| Moment | What the broker sees |
| --- | --- |
| before a push returns | the previous head, consistently |
| after a push returns success | the new head |
| after a push whose indexing failed | `idx_stale` row → mint refused for the org until the reconciler clears it |

An admin narrowing a grant therefore cannot mint the wider one *after* the
narrowing push succeeded. There is no window in which a revoked grant mints.

---

## 10. Failure modes

| Code | When | Message (verbatim) | Remedy |
| --- | --- | --- | --- |
| `definitions.unauthenticated` | no or bad token | `Sign in first: harness login.` | `harness login` |
| `definitions.api_unreachable` | principal lookup failed | `The Harness API did not answer, so your identity could not be checked. Try again in a moment.` | retry |
| `definitions.not_your_ref` | push to any ref but own | `You can only push to your own version. Offering a change to the team is \`harness offer\`; promoting one is done in the console.` | `harness offer` |
| `definitions.not_fast_forward` | history rewrite | `Your version's history has diverged from what the server holds. Run \`harness pull\` and try again.` | `harness pull` |
| `definitions.sidecar_missing` | dir without asset.json | `<kind>/<name> has no asset.json. \`harness adopt <path>\` creates one.` | `harness adopt` |
| `definitions.sidecar_invalid` | bad id/kind | `<kind>/<name>/asset.json: <reason>.` | fix the file |
| `definitions.unknown_kind` | not in kinds.json | `"<kind>" is not a kind this organisation uses. Kinds: <list>.` | ask an org admin |
| `definitions.duplicate_id` | id twice on a branch | `Two directories carry the same id <id>: <a> and <b>. One of them needs a new one — \`harness adopt --new-id <path>\`.` | |
| `definitions.secret_in_tree` | secret pattern | `<path> looks like it contains a secret. Definitions never hold secret values; put it in a key vault and reference it from a security group.` | |
| `definitions.id_conflict` | step 9 | `<kind>/<name> already exists on <node> with a different id. To override the team's, keep its id (\`harness reset <kind>/<name>\` then edit); to add a new thing, give it a new name.` | |
| `definitions.policy_on_user_branch` | step 10 | `Policy files belong to teams and the organisation, not to a personal version.` | |
| `definitions.policy_invalid` | step 11 | `policy/<file>: <field> <reason>.` — e.g. `policy/groups.json: entries[2].upstream "https://api.stripe.com/v1" has a path; give the origin only.` | |
| `definitions.grant_widens` | step 12 | `The grant "<name>" would give <sub-team> "<alias>", which <team> does not hold. A narrowed grant can only remove entries.` | |
| `definitions.grant_outside_subtree` | step 12/13 | `"<scope>" is not inside <team>. A team admin may only grant or bound within their own team.` | |
| `definitions.reach_widens` | step 12 (01 D131) | `The reach at <node> would give more than it inherits: <why>. Reach only ever narrows on the way down.` | set it at the node above |
| `definitions.reach_grant_retired` | step 12 (01 D132) | `The grant "<id>" gives outside endpoints, which is no longer how reach is set. Remove it and set reach on Boundaries → Reach; it writes policy/reach.json.` | remove the grant |
| `definitions.quota` | step 15 | `This organisation's definitions exceed <n> GiB. Remove large files, or ask us to raise the limit.` | |
| `definitions.head_moved` | `/internal/commit` CAS | `The branch moved while this change waited.` (409 with `{ head }`; `api` re-reads and retries or reports *stale* on the request — prd-v2 §17.3) | |
| `definitions.index_failed` | §8.3 step 6 | `remote: index failed; an operator has been paged. Your push is saved; the console will catch up.` | reconciler |

---

## 11. Migration from Postgres (D6)

A one-shot exporter, `backend/app/migration/` (it reads Postgres, so it lives with the only Postgres client, C36), deleted after cutover.

### 11.1 Mapping

| Today | Becomes | Rule |
| --- | --- | --- |
| `org_units` row | a branch | org → `refs/heads/org`; team → `refs/heads/teams/<path>`; user → `refs/heads/users/<auth_user_id>` (from `org_unit_members`) |
| `assets` head version (skipping `pending_review`) | `assets/<kind>/<name>/` + `asset.json` | `id` = `assets.id` **unless re-id'd below** |
| a user-owned asset whose `(kind,name)` an ancestor also owns | the same directory **with the ancestor's id** (D3) | provenance `override_of` names the ancestor when the collision flow was used; otherwise the nearest ancestor by `resolve.py`'s own order. Recorded as `reid: old → new` |
| `asset_scopes` | placement | asset A owned by U, scoped to S₁…Sₙ: commit A onto each Sᵢ's branch. Commit onto U's branch **only if U is a user unit or U ∈ scopes**. If Sᵢ already owns the same `(kind,name)`, skip Sᵢ (A never resolved there — nearest wins — and placing it would be an id conflict); record `shadowed_by_owner`. A user-unit scope target is a user branch. |
| team-owned asset with **no** scopes | nowhere | it resolved for nobody (backend survey §2); recorded `unreached`, and listed for the admin to place |
| `harness_assets(kind,name)` | `HarnessDef.assets` ids | resolve `(kind,name)` at the harness's unit by the pre-migration rule; take the (mapped) id. Unresolvable → dropped, recorded `assignment_unresolved` |
| `harnesses` row | `harnesses/<id>.json` on its unit's branch | icon verbatim; `id` = the row's uuid |
| `org_unit_boundaries.policy.allowed_tools` (intersected) | `Boundary{kind:"capability"}` per fixed capability **absent** from the list | `tool.<name>` entries → nothing (read geometry is per harness now); recorded |
| `.egress_allowlist`, `.connector_allowlist` | nothing | reach is derived (prd-v2 §8); recorded so an admin can add boundaries if the intent was denial |
| `.deploy_tools`, `.approvals.deploy`, `.build_policy.push_review`, `.budget.*`, `.load_policy` | nothing | Later or dropped (prd-v2 §22, §25); recorded |
| `.model_policy` | D9 mapping | `user_credentials: forbidden` → legacy model group `sources: "vault"`; `allowed`/`required` → `"vault-or-local"`; `source: none` → no routing default for that scope |
| `api_keys` + active `api_key_versions` | `SecurityGroup "legacy-<slug>"` with one entry `{ alias: <slug>, secret: { vault: "bundled", ref: <api_keys.ref> } }` and a `Grant` scoped to the owning unit's team (org unit → `teams: "all"`) | user-owned keys: no scope target exists → recorded `user_key_needs_owner`; the value stays in the vault |
| `connection/model-default` asset (JSON) | `ModelProvider` in `policy/model-providers.json` + `routing.defaultFor.teams[<path>]` | `wire_format`/`endpoints` → `endpoints`; `key_ref` → `credential.alias` = that key's legacy alias; the legacy group's entry gets `upstream` = the model base URL's origin and `attach` per wire format |
| `asset_kinds` | `policy/kinds.json` | verbatim |
| `org_unit_admins` | untouched | records |

### 11.2 Sequence

```
1. Freeze: api refuses writes to assets/harnesses/boundaries/api-keys (503 "migrating"). Sessions continue.
2. Baseline: for every user, capture GET /v1/resolve → { assets: [{ asset_id, kind, name, files: {path: sha256} }] } → baseline/<user>.json.
3. Export per org into a scratch DEFINITIONS_ROOT; write migration-report.json with every recorded row above.
4. Reindex every org into scratch idx_* tables.
5. Acceptance (D6): for every user, { (mapped id, kind, name, sorted file hashes) } from baseline == the same set from compose().
   One mismatch → stop; print the user and the asset; nothing is switched. Test T4 `migration_is_byte_identical`
   runs this against a fixture database that exercises every row of §11.1.
6. Cutover: point definitions at the new root; api serves the index; release the CLI that fetches (09).
7. Unfreeze.
8. Rollback, any time before step 9: api flips back to the old tables (untouched); the CLI release is withdrawn.
9. Two weeks later: drop assets, asset_versions, asset_files, asset_scopes, harness_assets, api_keys' env_var column
   (the value tables stay: the bundled vault is still Postgres until OpenBao — prd-v2 §22).
```

---

## 12. Operations

| Concern | Decision |
| --- | --- |
| Backup | nightly `git bundle --all` per org to object storage, plus volume snapshots; a bundle restores with `git clone --mirror` |
| Restore order | repos → `reindex` every org → records. No moment where two stores must agree (prd-v2 §3) |
| Maintenance | `git gc --auto` disabled per request; `git maintenance run --task=gc` weekly per repo, off-peak, holding the repo's push lock |
| Sharding | one instance at launch; `DEFINITIONS_SHARDS` maps `org_id` → instance by consistent hash behind the path router; a repo moves by bundle + reindex |
| Quotas | `receive.maxInputSize` per push and §7 step 15 per repo |
| `api` internal endpoints this service calls | `GET /v1/internal/principal` (§5.2), `POST /v1/internal/index` (§8.3), `POST /v1/internal/policy-changed` (§8.3 step 5b), `POST /v1/internal/audit` (below). All four are in `00 §4.10` |
| Audit | `definitions` posts authoritative events to `api` `POST /v1/internal/audit`: `definitions.push` (ref, old, new, actor, paths), `definitions.commit` (+ reason, request), `definitions.refused` (code), `definitions.reindex`. One writer of the chain (C34) |
| Locks | one push at a time per repo — an in-process mutex per repo held from `git-receive-pack` to response close (one instance per shard, §12; not `flock`); a second push waits ≤ 30 s then `definitions.busy`: *Another change to this organisation is being saved. Try again in a moment.* |
| Health | `GET /health` checks the socket, the root is writable, and `api` answers |

---

## 13. Tests

| Tier | Name | Asserts |
| --- | --- | --- |
| T1 | `validate_rules_1_to_15` | one fixture per rule refuses with the named code; a clean push passes |
| T1 | `edges_are_complete` | every rel in §8.2 is produced from the conformance fixtures, both directions queryable |
| T2 | `prereceive_accepts_override_with_team_id` | user branch with team's id at same path → accepted; composes with `shadows` (the compose-side twin is 01's `override_keeps_id`) |
| T2 | `prereceive_refuses_new_id_at_existing_path` | rule 9 (compose-side twin: 01's `new_id_at_existing_path_is_refused`) |
| T4 | `promote_reaches_members` | after `/internal/commit` with `reason.kind = "promote"` onto a team ref, every member of that team composes the promoted id (the survey found today's promote reached nobody) |
| T2 | `narrowed_grant_subset_only` | rule 12, all four sub-rules |
| T4 | `user_cannot_fetch_sibling_team_ref` | §6.1 |
| T4 | `user_cannot_push_team_ref` | §6.2 |
| T4 | `admin_promote_goes_through_internal_commit_not_push` | §6.2 |
| T4 | `hidden_ref_object_not_fetchable_by_sha` | `fetch <sha>` of a hidden tip → `not our ref` |
| T4 | `reindex_equals_fresh_index` | §8.5 |
| T4 | `index_failure_marks_stale_and_reconciler_clears` | §8.3 step 6, §8.4 |
| T4 | `org_push_indexes_5000_users_under_5s` | §8.3 |
| T4 | `migration_is_byte_identical` | §11.2 step 5 over the fixture database |
| T4 | `internal_commit_cas` | two concurrent promotes: one 200, one 409 with the new head |
| T4 | `policy_push_revokes_sessions_in_subtree` | a team boundary push → `policy-changed` called with that ref; a user-asset push → not called |
| T1 | `validate_is_compose` | every §7.1 mapping: a fixture producing that `Conflict` refuses with that code, and `validate.ts` contains no second implementation of the rule |

---

## 14. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D40 | C36 amended: `api` is the only client of **records**; the index has its own role; `api`'s record role reads the index | giving `definitions` a Postgres client (adds a dependency) |
| D41 | `definitions` writes the index **through `api`'s internal index endpoint**, keeping zero runtime deps and one Postgres library | a wire client in `definitions` |
| D42 | Service-to-service auth is a shared bearer token on a private network; mTLS Later | mTLS |
| D43 | A new branch is an **orphan commit with an empty tree**. Composition needs no ancestry; a hand merge uses `--allow-unrelated-histories` | parent = parent node's head (would show every parent file as "deleted") |
| D44 | Indexing is synchronous inside post-receive; failure marks `idx_stale`; the broker fails closed on it | asynchronous indexing with a version check at mint |
| D45 | Hooks are shims calling back into the service; rules live in `validate.ts` | rules in shell |
| D46 | Overrides are re-id'd at migration to the ancestor's id (D3 applied retroactively) | keep old ids and accept a same-path-different-id conflict for every legacy override |
| D47 | Team-owned, unscoped assets migrate **nowhere** and are reported | place them on the owner's branch (would grant what nobody had) |
| D48 | One push at a time per repo | per-ref locks |

## 15. Out of scope

Cross-organisation publishing (prd-v2 §22 Later); `git merge` server-side
(never); mTLS; multi-region; a web UI for the repos (the console is it).

## 16. Definition of done

- A fresh `definitions` serves an org created by `/internal/orgs`; a user can `git fetch` exactly their chain and push exactly their ref.
- Every rule in §7 has a T1 fixture and every code in §10 appears in exactly one place in the code.
- `reindex_equals_fresh_index` and `migration_is_byte_identical` pass in CI against a scratch Postgres.
- The broker (04) refuses to mint for an org with an `idx_stale` row, and a T4 test proves it.
- `enforcement-architecture.md`, `asset-sync.md` §9 and `harnesses.md` §5 carry a one-line banner pointing here.


> **Construction note (25 Sep, cutover dry run):** `api` must issue every `definitions:/internal/*` call **before** `append_event` in the same request — `append_event` holds the org's `audit_log_latest_hashes` row `for update`, and `/internal/branches` calls `api` back on that chain, which deadlocked until the calls were reordered. The exporter's root-commit message is `created <node_path>`, the same string `repos.ts` reads.
