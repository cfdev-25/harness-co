# Cutover runbook (02 §11.2, 09 M2 step 4)

This is the migration from Postgres-as-truth to git-as-truth, written as it was
**executed as a dry run** against the development records on 25 September 2026,
with every command, count and timing from that run. Nothing was cut over and
nothing was deleted: the dry run stops at 02 §11.2 step 5, which is the gate.

The contract being proved is **D6** — *every manifest that resolved before the
migration composes byte-identically after it, for every user*. The dry run
proves it end to end: not against the exported repositories on disk, but
against the repositories **as `definitions` serves them**, reached by a real
`git fetch` over smart-HTTP authenticated as each person.

---

## 1. What the dry run established

| | |
| --- | --- |
| **D6** | **0 mismatches.** 1 user, 5 assets, compared by mapped id, kind, name and the sha256 of every file's bytes |
| Per-ref authorisation | the fetch advertised exactly that person's chain — `refs/heads/org`, `refs/heads/teams/test-org-1.marketing`, `refs/heads/users/<id>` — and nothing else (02 §6.1) |
| Export | 1 organisation, 3 branches, 2 recorded rows, 0.88 s |
| Reindex | `{ "chains": 1, "ms": 938 }`; `idx_effective` = 5, matching D6's asset count exactly |
| Audit | `definitions.reindex` reached the org's chain through `api` `POST /v1/internal/audit` (C34) |
| Findings | six (§5). **§5.1 blocks the migration outright** — every migrated person loses reach, silently. §5.5 blocks personal accounts. The rest are one-line fixes outside the migration's own code |

The development database is small (3 org units, 1 member, 5 assets, 1 harness,
1 api key). It is a real proof of the mechanism, not of scale; 02 §13's
`org_push_indexes_5000_users_under_5s` is still the load gate.

---

## 2. Preconditions

- `npm run build -w engine/compose -w engine/definitions` — the exporter's
  acceptance test and the dry run both spawn `engine/compose`'s `compose-chain`
  binary, because composition has one implementation and it is TypeScript (D2).
- A local Postgres for the scratch database (`postgresql://127.0.0.1:5432`).
- `backend/.env` carrying `DATABASE_URL` (the hosted development database),
  `HARNESS_SERVICE_TOKEN`, and — new, and required from now on —
  `DEFINITIONS_URL`. Without it every org, team and user creation is refused
  with `definitions_unconfigured`: fail closed is the rule, because **a node
  that has no branch must not exist**.
- `scripts/dev-definitions.sh` for the service. It is not yet in `npm run dev`;
  `package.json` needs `"dev:definitions": "bash scripts/dev-definitions.sh"`
  and that name added to the `dev` line's `--names`/`--prefix-colors`.

**The hosted development database has never had migration `0022_asset_scopes`
applied.** The exporter reads `asset_scopes`, and `resolve.py` cannot run
without it, so the exporter cannot be pointed at that database at all:

```
$ .venv/bin/python -m app.migration.export_to_git --out ~/.harness-dev/definitions
asyncpg.exceptions.UndefinedTableError: relation "asset_scopes" does not exist
```

The dry run therefore does what `test_migration_export.py`'s development-records
test does: it **mirrors the rows into a scratch database read-only, applies the
migrations including 0022, and runs 0022's backfill there** (`insert into
asset_scopes(asset_id, org_unit_id, granted_by) select id, org_unit_id,
org_unit_id from assets` — every asset reaches its owner and everything beneath
it, which is what the backfill would have done had it run when the migration
landed). Nothing is written to the hosted database at any point: the connection
is opened `default_transaction_read_only`, so a write is refused by Postgres
rather than caught by review.

**The real cutover must apply 0022 to the hosted database first**, or run from
the same mirror. It is the first item of §4.

---

## 3. The dry run, command by command

Steps 1 and 7 of 02 §11.2 (freeze and unfreeze) are not exercised: `api` has no
`503 "migrating"` switch yet. That is an item for the real cutover (§4).

### 3.1 Build (0.9 s)

```
npm run build -w engine/compose -w engine/definitions
```

### 3.2 Mirror the hosted records into scratch, read-only (4.2 s)

`/tmp/cutover-dryrun/mirror.py` — written outside the checkout because it is an
operator's script for one window, not product code. It copies twelve tables,
drops `org_units.path` (the `org_units_role_order` trigger computes it) and
`assets.head_version_id` (a foreign-key cycle with `asset_versions`, set in a
second pass), applies 0022's backfill, and mints one `hpat_` personal access
token per member so the dry run can fetch and resolve as each person.

```
source rows: {'org_units': 3, 'org_unit_members': 1, 'org_unit_admins': 1,
              'asset_kinds': 5, 'assets': 5, 'asset_versions': 5,
              'asset_files': 10, 'harnesses': 1, 'harness_assets': 1,
              'api_keys': 1, 'api_key_versions': 1, 'org_unit_boundaries': 1}
migrations applied: 29
0022 backfill: INSERT 0 5
pats minted: 1
```

### 3.3 Export into the definitions root (0.88 s) — 02 §11.2 step 3

```
.venv/bin/python -m app.migration.export_to_git \
  --out ~/.harness-dev/definitions --database-url "$SCRATCH_DSN"
{ "orgs": 1, "recorded": 2 }
```

Three branches, each an orphan commit with the unit's whole tree (D43):

```
refs/heads/org                                          848eb522…
refs/heads/teams/test-org-1.marketing                   f4e592b3…
refs/heads/users/3f29b349-aaef-43db-9096-c4fe2758e3cb   e9b8986c…
```

`migration-report.json` recorded two rows, both expected and neither a loss of
reach: `assignment_unresolved` for the harness's `skill/triage` assignment, and
`routing_keyed_by_org_path` because the model key is owned by the organisation
and §11.1 keys routing by a team path (03 §5.2 will not find it — an admin
re-keys it after cutover).

### 3.4 Start the services

The index writes go to a **scratch** `api`, never the hosted one: a second
instance on 8401 with `DATABASE_URL` pointed at the mirror.

```
DATABASE_URL="$SCRATCH_DSN" .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8401
API_URL=http://127.0.0.1:8401 bash scripts/dev-definitions.sh          # listens on 8402
```

`GET /health` → `{"ok":true,"api":true,"root":true,"socket":true}`. Starting the
service also created `platform.git`, empty and never advertised (D30g).

### 3.5 Reindex — 02 §11.2 step 4

```
curl -X POST -H "Authorization: Bearer $HARNESS_SERVICE_TOKEN" \
  http://127.0.0.1:8402/internal/reindex/b120b8d0-0f44-4939-abad-f66a6df2035b
{"chains":1,"ms":938}
```

| table | rows |
| --- | --- |
| `idx_nodes` | 3 |
| `idx_refs` | 3 |
| `idx_assets` | 5 |
| `idx_effective` | 5 |
| `idx_harnesses` | 1 |
| `idx_policy` | 5 |
| `idx_edges` | 14 |
| `idx_stale` | **0** |

This is the result **after** the defect in §5.1 was worked around. On the first
run `idx_effective` was `0` and every user asset was indexed under an empty
`node_path`; §5.1 says why and what the fix is.

### 3.6 Acceptance — 02 §11.2 step 5, D6

`/tmp/cutover-dryrun/d6.py`. For every user in the export report: `git ls-remote`
and `git fetch` through `definitions` with that person's token, `compose()` over
the fetched repository, `GET /v1/resolve` from `api` with the same token, then
compare `{ mapped id → (kind, name, {path: sha256}) }` with the sidecar dropped
(it is the migration's own file; `resolve.py` never returned it).

```
user 3f29b349-aaef-43db-9096-c4fe2758e3cb
  advertised refs : ['refs/heads/org', 'refs/heads/teams/test-org-1.marketing',
                     'refs/heads/users/3f29b349-aaef-43db-9096-c4fe2758e3cb']
  fetched refs    : ['refs/heads/org', 'refs/heads/teams/test-org-1.marketing',
                     'refs/heads/users/3f29b349-aaef-43db-9096-c4fe2758e3cb']
  resolve assets  : 5  compose assets: 5
  MATCH

D6: users=1 assets=5 mismatches=0
```

`/v1/resolve` was served by the **scratch** `api` on 8401, not the hosted one.
It could not have been served by the hosted one: without 0022 that database has
no `asset_scopes`, so `resolved_assets` cannot run there at all. The rows behind
both sides of the comparison are the hosted database's own rows, mirrored
unchanged, which is what makes it a proof about the real records.

The advertised-refs line is 02 §6.1 for free: the transport offered exactly the
person's chain.

### 3.7 The wiring, against the real service

`POST /v1/orgs` on the scratch `api`, with `DEFINITIONS_URL` pointed at the
running `definitions` — the whole path a person signing up takes, with no fake
anywhere in it:

```
curl -X POST http://127.0.0.1:8401/v1/orgs -H "Authorization: Bearer hpat_…" \
  -d '{"org_name":"Newco Two","team_name":"Ops"}'
{"id":"2cbd7259-…","role":"org","path":"newco-two","team_id":"3d0b0999-…",
 "user_unit_id":"ff68f277-…"}                                        0.32 s
```

One repository, three refs, `idx_nodes` correct for all three, and the org's
chain carrying `org.create` plus two `definitions.push` events. The first
attempt returned `503 definitions_unreachable` after ten seconds; §5.6 says why.

---

## 4. What the real cutover does that the dry run did not

1. **Apply `0022_asset_scopes` to the hosted database**, with its backfill.
   Nothing else can run until it has. (Or: run the export from a mirror, and
   accept that the baseline is a copy.)
2. **Freeze** (02 §11.2 step 1): `api` refuses writes to assets, harnesses,
   boundaries and api-keys with `503 "migrating"`. Sessions continue. **This
   switch does not exist yet** — it is unbuilt work, not a runbook step.
3. **Baseline** (step 2): capture `GET /v1/resolve` per user to
   `baseline/<user>.json` before the freeze lifts, so the comparison is against
   what people actually had, not against a re-derivation.
4. Export, reindex and run D6 **against the production root**, not a scratch
   one. One mismatch stops everything; nothing is switched.
5. **Flip** (step 6): point `definitions` at the new root, `api` serves the
   index, release the CLI that fetches. Set the repository config the exporter
   does not write — `createRepo` in `engine/definitions/src/repos.ts` sets
   `core.sharedRepository=group`, `receive.denyNonFastForwards=true` and
   `receive.fsckObjects=true`, and an exported repo has none of them. For a
   fetch-only dry run that does not matter; for a root people push to it does.
6. **Unfreeze** (step 7).
7. **The deletions of 09 M2 step 4 — not this document's to perform.** They are
   `GET /v1/resolve`; `asset_scopes` (table, endpoints, predicate);
   `harness_assets`' `(kind, name)` keying in favour of ids; Postgres as the
   definition source of truth; `identify()` by shape for `push`; the dead
   `automation_runners` table and the three dead functions (00 §6). They happen
   only after the byte-identical test has run against production data and the
   replacement's tests have passed, and they are the one irreversible step in
   the plan.
8. **Two weeks later** (step 9): drop `assets`, `asset_versions`, `asset_files`,
   `asset_scopes`, `harness_assets`, and `api_keys.env_var`. The value tables
   stay — the bundled vault is still Postgres until OpenBao.

---

## 5. Defects the dry run found

### 5.1 The exporter's root-commit message is not the one `definitions` reads

`export_to_git.py`'s `write_branch` commits with `-m "branch <path>"`.
`engine/definitions/src/repos.ts`'s `branchPath()` reads a branch's node path
out of its root commit subject and accepts only `created <path>` — 02 §5.3's
wording, and what `createBranch` writes. Anything else yields `""`.

A user's dotted path exists **nowhere else**: `refs/heads/users/<id>` carries an
id, no body in 00 §4.10 carries the path back, and `nodes()` reads it from the
commit message for exactly that reason. So on an exported repository every user
node indexes as:

```
 path | kind |                    ref                                | parent_path
------+------+-------------------------------------------------------+-------------
      | user | refs/heads/users/3f29b349-aaef-43db-9096-c4fe2758e3cb |
```

`lineage()` then returns a one-node chain, `idx_effective` comes back **empty**,
and the broker has nothing to mint against — a silent, total loss of reach for
every migrated person. `reindex` still answered `{"chains":1}`, so the failure
is invisible from the outside.

Proved by rewriting the three root commits to `created <path>` and reindexing
again: `idx_nodes` filled correctly, `idx_effective` went `0 → 5`, and D6 still
returned 0 mismatches.

**Fix:** one word in `export_to_git.py`'s `write_branch` — `f"created
{branch.unit['path']}"`. The exporter is not this document's to edit, so the fix
is recorded here and not applied.

### 5.2 `POST /internal/orgs` ignores `node_path`

02 §5.3 and 00 §4.10 both give the body as `{ org_id, node_path }`, and the
build log records the correction as applied. `engine/definitions/src/internal.ts`
still destructures only `org_id` and passes it as the node path:

```ts
const { org_id } = await body<{ org_id: string }>(request);
const repo = await createRepo(config.root, org_id);
await createBranch(repo, "refs/heads/org", org_id);
```

So `refs/heads/org`'s root commit says `created <uuid>` instead of `created
<org-path>`. Observed, on an organisation created through the wired `POST
/v1/orgs` against the real service (§3.7):

```
refs/heads/org                    created 2cbd7259-18b7-4f7f-930f-b1770fa5254b
refs/heads/teams/newco-two.ops    created newco-two.ops
refs/heads/users/25ec85cc-…       created newco-two.ops.newco2examplecom
```

`nodes()` masks it as long as the repository holds one other branch — it takes
the org's path from the first segment of a child's path rather than from the
org's own commit — so `idx_nodes` came out right. It is wrong between
`/internal/orgs` and the first `/internal/branches`, where the org indexes under
a uuid, and it is wrong as a contract: the field 02 §5.3 and 00 §4.10 both
specify is read by nobody, and the org's own path is recorded nowhere. `api`
sends it correctly (`app/domain/definitions_client.py`); only the reader is
wrong.

### 5.3 `reindex` leaves rows written under a stale node path

`POST /v1/internal/index` replaces `idx_assets`, `idx_harnesses` and `idx_policy`
**by `node_path`**, so when §5.1's empty path was corrected the three rows
written under `''` stayed behind: after the fix the table held eight rows for
five assets. 02 §8.5's `reindex_equals_fresh_index` cannot hold across a change
of node path without a truncate form. The `definitions` wave already flagged
that `POST /v1/internal/index` has no truncate form for reindex; this is that
gap, observed.

Operationally, until it is closed: `delete from idx_* where org = <org>` before
a reindex that could move a node.

### 5.4 `email_label` never reaches the database

`org_tree.py`'s `email_label` replaces `@` and `.` so that `a.b@x.com` and
`ab@x.com` do not collide in `org_units_path_idx` — its docstring says so. But
`org_units_role_order` (0001, unchanged by 0027) is a `before insert` trigger
that assigns `new.path := parent_path || '.' || org_units_slugify(new.name)`
unconditionally, and `org_units_slugify` deletes every symbol. The path Python
computes is discarded; the dev user is `corbfurrergmailcom`. The collision the
function was written to prevent is still live.

This matters to the definition plane because a node path is a branch's identity.
`definitions_client` therefore always sends `unit["path"]` as returned by the
insert, never a recomputed one.

### 5.5 D30f cannot be fully honoured while the trigger stands

02 §5.3's personal-edition row and D30f want an org with **no team**: the chain
is `org · user`. The same trigger refuses a user whose parent is not a team, so
the records must hold one. `POST /v1/orgs` with `{"personal": true}` therefore
creates org, team and user in Postgres but calls `definitions` twice only —
`/internal/orgs`, then the user's ref with a `node_path` of `<org>.<user>` — so
the repository's chain is `org · user` as specified.

The consequence, which must be closed before a personal account is offered:
`broker.chain_for` derives the chain from `org_units`, so it would return the
records' three nodes including a team ref that has no branch. Either the trigger
learns that a user may sit under an org, or `chain_for` learns to drop a node
with no ref. Until one of them lands, `personal: true` is not a shape to sell.

### 5.6 Creating a branch inside the creating transaction deadlocks `api` against `definitions`

Found by running the wired sign-up against the real service rather than a fake,
and fixed in `api`'s ordering. It is recorded here because the shape of it will
recur for every future writer.

`append_event` holds an organisation's `audit_log_latest_hashes` row `for
update` until its transaction ends — C34's one-writer chain, working as
designed. `POST /internal/branches` makes `definitions` call `api` straight back
with `definitions.push` on that same chain (02 §12), synchronously, before it
answers. So a handler that appends its own event and *then* creates the branch
is waiting on `definitions`, which is waiting on a lock the waiting handler
holds. Nothing resolves it but the HTTP client's timeout:

```
POST /v1/orgs → 503 definitions_unreachable        (after the 10 s timeout)
```

The fix in `routes_org_units.py` and `routes_auth.py` is ordering: **every
`definitions` call is made before this transaction's `append_event`**, so the
chain row is untaken when `definitions` reaches back for it. `append_event`'s
`ensure_partition_for` is the same hazard by another route — it is DDL on
`audit_log`, and an open transaction that has already inserted there blocks it —
and the same ordering closes both.

This is a constraint on `api`, not a defect in `definitions`, but it is not
written down anywhere: any future handler that creates a node and audits it in
one transaction will rediscover it. It belongs in 02 §5.3 or 00 §4.10 as a
sentence — *an internal endpoint that audits may not be called from a
transaction holding that org's chain.*

---

## 6. Rollback

Before the flip there is nothing to roll back: both stores are alive and
`definitions` is shadowing (09 M2's cut line — ship-safe after step 3 without
step 4).

After the flip and before the deletions:

1. Point `api` back at the old tables and withdraw the CLI release. The records
   are untouched by everything above — the exporter reads read-only and the
   index lives in `idx_*`, which nothing else reads.
2. `delete from idx_* where org = <org>` if the index is to be rebuilt from
   scratch later. Leaving it costs nothing; the broker refuses to mint against
   an `idx_stale` row either way (D44).
3. The definition root can be kept: it is derived, and a second export
   overwrites it.

After the deletions the rollback is the pre-window Postgres snapshot, restored
in 02 §12's order — **repos → reindex every org → records** — which is the order
that has no moment where two stores must agree. That order is itself a gate: if
the restore test does not yield an identical index, M2 does not cut over.

---

## 7. Reproducing the dry run

```
npm run build -w engine/compose -w engine/definitions
cd backend && set -a && . ./.env && set +a
export MIGRATION_DEV_DATABASE_URL="$DATABASE_URL"        # read-only, always
.venv/bin/python /tmp/cutover-dryrun/mirror.py           # → /tmp/cutover-dryrun/{dsn,tokens.json}
rm -rf ~/.harness-dev/definitions
.venv/bin/python -m app.migration.export_to_git \
  --out ~/.harness-dev/definitions --database-url "$(cat /tmp/cutover-dryrun/dsn)"
DATABASE_URL="$(cat /tmp/cutover-dryrun/dsn)" \
  .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8401 &
API_URL=http://127.0.0.1:8401 bash ../scripts/dev-definitions.sh &
curl -X POST -H "Authorization: Bearer $HARNESS_SERVICE_TOKEN" \
  http://127.0.0.1:8402/internal/reindex/<org>
.venv/bin/python /tmp/cutover-dryrun/d6.py
```

The same acceptance, without the served-repository half, is a test:
`MIGRATION_DEV_DATABASE_URL=… .venv/bin/pytest -q tests/test_migration_export.py`.

---

## Appendix · `mirror.py`

The operator's script §3.2 runs, in full, so the window does not depend on a
file in `/tmp`. It is not product code and does not belong in the tree: it
exists because the hosted database is missing 0022 (§2), and it goes away with
the exporter after cutover.

```python
"""Cutover dry run, step 1: mirror the hosted development records into a local
scratch database, apply 0022 (never applied there), and mint a PAT per member.

Read-only against the hosted database: the session is opened
`default_transaction_read_only`, so a write is refused by Postgres, not by
review. Nothing here writes to the hosted database.
"""

import asyncio
import hashlib
import json
import os
import secrets
from pathlib import Path

import asyncpg

SOURCE = os.environ["MIGRATION_DEV_DATABASE_URL"]
ADMIN = os.environ.get("TEST_POSTGRES_DSN", "postgresql://127.0.0.1:5432/postgres")
NAME = os.environ.get("SCRATCH_DB", "harness_cutover_dryrun")
MIGRATIONS = sorted(
    Path("/Users/cf/projects/harness-co/backend/supabase/migrations").glob("*.sql")
)

TABLES = [
    "org_units",
    "org_unit_members",
    "org_unit_admins",
    "asset_kinds",
    "assets",
    "asset_versions",
    "asset_files",
    "harnesses",
    "harness_assets",
    "api_keys",
    "api_key_versions",
    "org_unit_boundaries",
]


def codec(connection):
    return connection.set_type_codec(
        "jsonb",
        schema="pg_catalog",
        encoder=lambda v: v if isinstance(v, str) else json.dumps(v),
        decoder=json.loads,
    )


async def main():
    source = await asyncpg.connect(
        SOURCE,
        statement_cache_size=0,
        server_settings={"default_transaction_read_only": "on"},
    )
    await codec(source)
    try:
        rows = {t: await source.fetch(f"select * from {t}") for t in TABLES}
    finally:
        await source.close()
    print("source rows:", {t: len(r) for t, r in rows.items()})

    admin = await asyncpg.connect(ADMIN)
    await admin.execute(f'drop database if exists "{NAME}" with (force)')
    await admin.execute(f'create database "{NAME}"')
    await admin.close()
    dsn = f"{ADMIN.rsplit('/', 1)[0]}/{NAME}"
    c = await asyncpg.connect(dsn)
    await codec(c)
    await c.execute("create schema auth; create table auth.users(id uuid primary key, email text);")
    for path in MIGRATIONS:
        await c.execute(path.read_text())
    print("migrations applied:", len(MIGRATIONS))

    await c.execute("delete from asset_kinds")
    for table in TABLES:
        for row in rows[table]:
            for column in ("auth_user_id", "created_by", "author_auth_user_id"):
                if column in row.keys() and row[column] is not None:
                    await c.execute(
                        "insert into auth.users(id) values ($1) on conflict do nothing",
                        row[column],
                    )
            cols = list(row.keys())
            if table == "org_units":
                cols = [k for k in cols if k != "path"]  # the trigger computes it
            if table == "assets":
                cols = [k for k in cols if k != "head_version_id"]  # FK cycle; set below
            vals = [
                json.dumps(row[k]) if isinstance(row[k], dict | list) else row[k] for k in cols
            ]
            await c.execute(
                f"insert into {table}({','.join(cols)}) values "
                f"({','.join(f'${i + 1}' for i in range(len(cols)))})",
                *vals,
            )
    for row in rows["assets"]:
        await c.execute(
            "update assets set head_version_id=$1 where id=$2", row["head_version_id"], row["id"]
        )
    # 0022's backfill, which ran against an empty table at migration time.
    print("0022 backfill:", await c.execute(
        "insert into asset_scopes(asset_id, org_unit_id, granted_by)"
        " select id, org_unit_id, org_unit_id from assets"
    ))

    tokens = {}
    for row in await c.fetch("select auth_user_id, user_unit_id from org_unit_members"):
        raw = secrets.token_urlsafe(32)
        await c.execute(
            "insert into personal_access_tokens(auth_user_id, token_hash, name)"
            " values ($1,$2,'cutover-dry-run')",
            row["auth_user_id"],
            hashlib.sha256(raw.encode()).hexdigest(),
        )
        tokens[str(row["auth_user_id"])] = {
            "token": f"hpat_{raw}",
            "unit": str(row["user_unit_id"]),
        }
    print("pats minted:", len(tokens))
    Path("/tmp/cutover-dryrun/tokens.json").write_text(json.dumps(tokens, indent=2))
    Path("/tmp/cutover-dryrun/dsn").write_text(dsn)
    await c.close()


asyncio.run(main())
```

---

## 8. The development cutover, run 26 September 2026

Steps 3–5 of 02 §11.2 against the **hosted development database** and the
**live development root** (`~/.harness-dev/definitions`, served by the
`definitions` that `npm run dev` starts on 8402, indexing through the
development `api` on 8400). Not a dry run: the root the CLI and console read
now holds the export. §4's items 1 (0022 applied, with its backfill — done
the day before with the other missing migrations), 4 and 5 were done; 2 and
6 (freeze/unfreeze) do not apply to a database with one active user; 7 (the
deletions) and 8 were **not** done — they remain the one irreversible step
and need their own go-ahead.

| | |
| --- | --- |
| Backup | the previous root's org repository and report copied to `~/.harness-dev/definitions.pre-cutover-2026-09-26/`; the hosted records were exported read-only (`default_transaction_read_only`) and are untouched; the per-table CSV backup from the migration pass is in the job's `tmp/devdb-backup/` |
| Export | `python -m app.migration.export_to_git --out <tmp>` → `{ "orgs": 1, "recorded": 2 }` (the same two expected rows as §3.3) |
| Swap | the live repository's three refs were **fetched** from the export (`git fetch <export> '+refs/heads/*:refs/heads/*'`) rather than the directory replaced, so `platform.git` and the service's open root were never touched and the previous commits stay reachable in the object store; root commits read `created test-org-1` · `created test-org-1.marketing` · `created test-org-1.marketing.corbfurrergmailcom` (§5.1's fix, confirmed) |
| Repo config | `core.sharedRepository=group`, `receive.denyNonFastForwards=true`, `receive.fsckObjects=true` set (§4.5) |
| Reindex | `POST /internal/reindex/<org>` → `{"chains":1,"ms":15636}` — 15.6 s against the hosted database versus 0.9 s local in §3.5: every index write is a round trip to Supabase; `idx_nodes` 3 · `idx_refs` 3 · `idx_assets` 5 · **`idx_effective` 5** · `idx_harnesses` 1 · `idx_policy` 6 · `idx_edges` 19 · **`idx_stale` 0** (the tables were empty, so §5.3's stale-row hazard did not arise) |
| D6, served | `ls-remote` and `fetch` through 8402 as the one member (a PAT named `cutover-2026-09-26`, minted for this run; its value is in the job's `tmp/`, not in the tree) advertised exactly the three refs of the chain; `compose()` over the fetched repository = `GET /v1/resolve` on 8400 for 5 assets by kind, name and every file's sha256 — **`D6: users=1 assets=5 mismatches=0`** |
| D6, records | `MIGRATION_DEV_DATABASE_URL=… pytest tests/test_migration_export.py -k development` — 1 passed |
| Console | with the same token: `/v1/console/me` 200; `harnesses?scope=org` 1 row · `sessions` 5 · `providers/harness` 2 · `providers/model` 1 · `groups` 1 · `people` 1 · `harnesses?scope=me` 1 — every screen has data |

What this run changed about the plan: the exported catalogue is the
pre-D30h shape (both runtimes `approved`, presets absent) because the
exporter ran before the seed module existed. Once `seed.py` lands the
exporter fills by id, so a second export — or the ordinary write path —
adds the preset rows without touching the migrated ones; the same pass adds
D30j's built-in `harness-authoring` skill, which the dev org has no copy of,
as an asset directory on the org branch named in `policy/always-loaded.json`.
Routing was written onto the one team (`test-org-1.marketing`), which D30i now also accepts under
the org path; both forms resolve.

**The exporter is retired for this organisation.** One further export was
run the same day (the seeded catalogue, D30h — OpenRouter and OpenAI rows
beside the migrated `anthropic`), and it was the last: from here the org
branch is the truth, and a re-export would force every ref back to what
Postgres holds, discarding every commit made since (`new --team`, the
anthropic wire-format correction, any key connected). Any further catalogue
change goes through the write path — `PUT /v1/providers/…`, `POST
…/setup`, or the console — never the exporter.

Rollback, if wanted: `git fetch ~/.harness-dev/definitions.pre-cutover-2026-09-26/<org>.git '+refs/heads/*:refs/heads/*'`
in the live repository, then the same reindex. Nothing else moved.
