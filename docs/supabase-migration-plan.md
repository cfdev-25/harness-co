# Supabase Cloud Migration Plan

**Status:** Ready for implementation handoff.

**Goal:** Move the database from local PostgreSQL to a cloud-hosted Supabase project, and
replace token-paste web authentication with organization login built on Supabase Auth
(`auth.users`). Users authenticate with email and password; membership in an organization
is what grants access, resolved through the existing `org_unit_members` / `org_unit_admins`
tables keyed by `auth.users.id`.

**Read first:** `docs/prd.md` §1.2 (tree), `docs/plan-improvement.md` F1/F2 (enforcement
matrix, auth direction), `backend/app/identity.py` (a `SupabaseJwtProvider` skeleton already
exists), `backend/supabase/migrations/0001_org_units.sql` (membership tables already key on
`auth_user_id uuid`).

---

## 0. Decisions (do not relitigate)

- **D1 — The backend remains the only database client.** The web app and CLI never talk to
  Supabase PostgREST. Supabase provides hosted Postgres and Auth; everything else stays as
  it is. RLS is enabled defensively (§3.5) but the API surface is FastAPI only.
- **D2 — Two credential paths remain.** Supabase JWTs are the primary credential for the
  web app. Personal access tokens (`hpat_`) remain the credential for the CLI and future
  runners, and are minted from the web app *after* a Supabase login. Both already verify in
  `verify_authorization`; this plan tightens JWT verification and changes who mints PATs.
- **D3 — Membership stays in our tables.** `auth.users` is the identity record only. We add
  foreign keys from `org_unit_members.auth_user_id`, `org_unit_admins.auth_user_id`, and
  `personal_access_tokens.auth_user_id` to `auth.users(id)`. We do **not** add FKs from
  history tables (`asset_versions.author_auth_user_id`, `api_keys.created_by`,
  `audit_log.actor_id`, `harness_sessions.owner_auth_user_id`) — offboarding a login must
  never delete or block history.
- **D4 — Onboarding is invite-first, with self-serve org creation.** Admins invite an email
  to a team; a database trigger links the new `auth.users` row to the invite at signup. A
  signed-in user with no workspace may instead create a brand-new organization
  (`POST /v1/orgs`), becoming its platform admin.
- **D5 — Migrations stay plain SQL in `backend/supabase/migrations/`**, renamed to the
  Supabase CLI's `<14-digit-timestamp>_name.sql` convention so `supabase db push` can deploy
  them. Local CI keeps applying them with the existing `psql` loop (order is lexicographic
  either way). An `auth.users` shim migration makes the same files run on plain PostgreSQL.
- **D6 — App traffic uses the Supavisor transaction pooler (port 6543)** with asyncpg's
  statement cache disabled. Migrations and seed use the session pooler (port 5432).

---

## 1. Supabase project provisioning (manual, dashboard)

One-time setup by a human; record outcomes in `docs/build-decisions.md`.

1. Create project `harness-co-staging` (region `us-east-1` or nearest; note region — it
   appears in the pooler hostname). Save the database password in the team password manager.
2. Auth settings: enable the **Email** provider (password sign-in **and** sign-up enabled);
   disable all social providers; leave "Confirm email" **on**.
3. Enable **JWT signing keys** (asymmetric) under Project Settings → API → JWT keys, so
   tokens are ES256-signed and verifiable via JWKS without sharing a secret.
4. Collect and distribute as environment/secrets (never commit):
   - `SUPABASE_URL` — `https://<project-ref>.supabase.co`
   - `SUPABASE_ANON_KEY` — web app (public, but keep out of the repo anyway)
   - `SUPABASE_SERVICE_ROLE_KEY` — backend + seed only. **Never** in `web/`.
   - `SUPABASE_JWKS_URL` — `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`
   - `DATABASE_URL` (API) — `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
   - `MIGRATE_DATABASE_URL` (migrations/seed) — same host, port `5432`

---

## 2. Migration file plan

All files live in `backend/supabase/migrations/`. Rename the existing eight files without
changing one byte of their contents (safe: no environment tracks applied filenames — CI
recreates the database every run, the cloud project is fresh, and local dev databases are
disposable):

| Current name | New name |
|---|---|
| `0001_org_units.sql` | `20260916000001_org_units.sql` |
| `0002_org_unit_boundaries.sql` | `20260916000002_org_unit_boundaries.sql` |
| `0003_assets.sql` | `20260916000003_assets.sql` |
| `0004_api_keys.sql` | `20260916000004_api_keys.sql` |
| `0005_automation_runners.sql` | `20260916000005_automation_runners.sql` |
| `0006_audit_log.sql` | `20260916000006_audit_log.sql` |
| `0007_harness_sessions.sql` | `20260916000007_harness_sessions.sql` |
| `0008_personal_access_tokens.sql` | `20260916000008_personal_access_tokens.sql` |

Then add four new migrations, verbatim below.

### 2.1 `20260916000000_auth_users_shim.sql` (sorts first)

On hosted Supabase, `auth.users` already exists and this whole file is a no-op. On plain
PostgreSQL (CI service container, local Homebrew Postgres, the e2e script) it creates the
minimal shape our foreign keys and trigger reference.

```sql
-- No-op on hosted Supabase, where the auth schema is managed by GoTrue.
-- On plain PostgreSQL this creates the minimal auth.users shape the app references.
do $$
begin
  if to_regclass('auth.users') is null then
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  end if;
end
$$;
```

### 2.2 `20260916000009_auth_user_links.sql`

```sql
-- Login-lifecycle tables cascade when a login is deleted. History tables are
-- deliberately NOT constrained (see plan D3): offboarding must not touch history.
alter table org_unit_members
  add constraint org_unit_members_auth_user_fk
  foreign key (auth_user_id) references auth.users(id) on delete cascade;

alter table org_unit_admins
  add constraint org_unit_admins_auth_user_fk
  foreign key (auth_user_id) references auth.users(id) on delete cascade;

alter table personal_access_tokens
  add constraint personal_access_tokens_auth_user_fk
  foreign key (auth_user_id) references auth.users(id) on delete cascade;
```

Note: deleting a login leaves its `role='user'` org unit in place (name = email). That is
intentional — the unit anchors historical assets and audit rows.

### 2.3 `20260916000010_org_invites.sql`

```sql
-- An invite targets the team that will hold the person's user workspace, and may
-- optionally grant admin rights over some unit (usually the team or the org root).
create table org_invites (
  id uuid primary key default gen_random_uuid(),
  team_unit_id uuid not null references org_units(id) on delete cascade,
  admin_unit_id uuid references org_units(id) on delete cascade,
  admin_level text check (admin_level in ('admin','platform')),
  email text not null,
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_auth_user_id uuid,
  check ((admin_unit_id is null) = (admin_level is null))
);

-- One pending invite per email address, case-insensitive.
create unique index org_invites_pending_email_idx
  on org_invites (lower(email))
  where accepted_at is null;

-- Link a brand-new login to its pending invite. search_path is pinned to 'public'
-- (not '') because the nested org_units triggers reference unqualified table names.
create function public.org_invites_link_new_user()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  invite record;
  unit_id uuid;
begin
  select * into invite
    from org_invites
   where lower(email) = lower(new.email)
     and accepted_at is null
   order by created_at
   limit 1;
  if not found then
    return new;
  end if;

  -- The org_units before-insert trigger validates role order and computes path.
  insert into org_units (parent_id, role, name)
  values (invite.team_unit_id, 'user', lower(new.email))
  returning id into unit_id;

  insert into org_unit_members (auth_user_id, user_unit_id)
  values (new.id, unit_id);

  if invite.admin_unit_id is not null then
    insert into org_unit_admins (auth_user_id, org_unit_id, level)
    values (new.id, invite.admin_unit_id, invite.admin_level);
  end if;

  update org_invites
     set accepted_at = now(),
         accepted_auth_user_id = new.id
   where id = invite.id;

  return new;
end
$$;

create trigger org_invites_link_new_user
after insert on auth.users
for each row
execute function public.org_invites_link_new_user();
```

### 2.4 `20260916000011_rls_lockdown.sql`

The backend connects as the `postgres` role, which **owns** every table created by these
migrations; table owners bypass row-level security unless `force` is used, so enabling RLS
with zero policies changes nothing for the API while closing Supabase's auto-generated
PostgREST surface (`anon` / `authenticated` roles). The role checks make the same file a
no-op on plain PostgreSQL, where those roles do not exist.

```sql
-- Deny-by-default: enable RLS with no policies on every application table.
-- The backend (table owner) is unaffected; PostgREST roles are locked out.
do $$
declare
  t text;
begin
  foreach t in array array[
    'org_units','org_unit_members','org_unit_admins','org_unit_boundaries',
    'assets','asset_versions','asset_files',
    'api_keys','api_key_versions',
    'automation_runners',
    'audit_log','audit_log_latest_hashes',
    'harness_sessions','personal_access_tokens','org_invites'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
  end if;
end
$$;
```

(`audit_log` is partitioned; enabling RLS on the parent covers partitions created later by
`ensure_audit_partitions`, because partitions inherit the parent's RLS at query time.)

### 2.5 Supabase CLI scaffolding

Run `supabase init` from inside `backend/` so the CLI adopts the existing
`backend/supabase/` directory. Commit the generated `backend/supabase/config.toml`
unchanged except `project_id = "harness-co"`. All CLI commands in this plan run with
`backend/` as the working directory.

---

## 3. Backend changes (file by file)

### 3.1 `backend/app/config.py`

Add fields (keep the existing ones):

```python
supabase_url: str | None = None            # https://<ref>.supabase.co
supabase_service_role_key: str | None = None
migrate_database_url: str | None = None    # session pooler; scripts only, unused by the app
```

### 3.2 `backend/app/db.py`

In `create_pool`, add `statement_cache_size=0` to the `asyncpg.create_pool` call. The
Supavisor transaction pooler multiplexes connections across statements, so asyncpg's
prepared-statement cache produces `prepared statement "…" does not exist` errors without
it. Harmless locally. Nothing else changes; `ensure_audit_partitions` DDL works through the
pooler.

### 3.3 `backend/app/identity.py`

Rework `SupabaseJwtProvider`:

- Build the `jwt.PyJWKClient` **once** in `__init__` (it currently constructs one per
  request, refetching JWKS every call). Module-level `@lru_cache` keyed on the URL is fine.
- JWKS path: verify with `algorithms=["ES256", "RS256"]`, `audience="authenticated"`, and
  `issuer=f"{settings.supabase_url}/auth/v1"` when `supabase_url` is set.
- HS256 fallback path: **remove** `options={"verify_aud": False}` and pass
  `audience="authenticated"` properly. Keep the fallback for projects still on the legacy
  shared secret.
- Keep returning `Principal(UUID(claims["sub"]), claims.get("email"))`.

`PatProvider` and `verify_authorization` are unchanged — D2 keeps both credential paths.

### 3.4 New endpoint: `POST /v1/orgs` (self-serve organization creation)

Add to `backend/app/api/routes_org_units.py`. Auth: `current_principal` only — do **not**
depend on `current_user_unit` (the caller has no workspace yet).

Request: `{"org_name": str (1..200), "team_name": str = "General"}`
Behavior, in one transaction:
1. 409 `already_member` if the caller has a row in `org_unit_members`.
2. Insert root org unit (`parent_id=null, role='org', name=org_name`) — direct SQL insert;
   the existing API route intentionally rejects parentless creation, this endpoint is the
   sanctioned path.
3. Insert team under it, then a `role='user'` unit named by the caller's email (fall back
   to `principal.auth_user_id` text if email is null) under the team.
4. Insert `org_unit_members(auth_user_id, user_unit_id)` and
   `org_unit_admins(auth_user_id, root_org_id, 'platform')`.
5. `append_event(action="org.create", event_class="authoritative", ...)` on the root unit.

Response 201: the root org unit row plus `{"team_id": ..., "user_unit_id": ...}`.

### 3.5 New endpoints: invites (`backend/app/api/routes_org_units.py`)

- `POST /v1/org-units/{org_unit_id}/invites` — `require_admin` on `{org_unit_id}`, which
  must be a `role='team'` unit (422 `invite_target_not_team` otherwise). Body:
  `{"email": str, "admin_level": "admin"|"platform"|null, "admin_unit_id": uuid|null}`;
  when `admin_level` is set, `require_admin` on `admin_unit_id` too. Inserts `org_invites`
  (email lowercased; 409 `invite_pending` on the partial-unique-index conflict). Then, if
  `settings.supabase_service_role_key` is set, call GoTrue
  `POST {supabase_url}/auth/v1/invite` with headers
  `apikey: <service_role>` / `Authorization: Bearer <service_role>` and body
  `{"email": ...}` via the existing `httpx` dependency so Supabase sends the invite email.
  **Ordering is load-bearing:** GoTrue's invite creates the `auth.users` row immediately,
  which fires the §2.3 trigger on a different connection — so the invite row must be
  **committed first**. Commit the `org_invites` insert (and its `member.invite` audit
  event) in its own transaction, and only then make the GoTrue call outside any
  transaction. A GoTrue failure logs a warning and returns 201 anyway — the trigger links
  the user whether they arrive via the invite email or plain signup.
- `GET /v1/org-units/{org_unit_id}/invites` — `require_admin`; returns pending and
  accepted invites for the unit.
- `DELETE /v1/invites/{invite_id}` — `require_admin` on the invite's `team_unit_id`;
  only while `accepted_at is null`; audit `member.invite_revoke`.
- **Lazy link for pre-existing logins.** The trigger only fires on `auth.users` inserts, so
  a login that already existed before being invited would never link. In the `GET /v1/me`
  handler (`routes_auth.py`), before raising 404 `no_workspace`: if `principal.email` has a
  pending invite, perform the same inserts as the trigger (user unit, membership, optional
  admin row, mark accepted) in one transaction with audit `member.invite_accept`, then
  return the new workspace. Add a shared helper `accept_pending_invite(connection,
  auth_user_id, email)` in `backend/app/domain/org_tree.py` and use it from this handler
  (the SQL trigger remains the signup-time path; do not try to unify them).

### 3.6 Tests (`backend/tests/`)

Extend the existing live-Postgres-optional pattern: unit tests for the new request/response
shapes DB-free, plus (where `TEST_DATABASE_URL` is set, as in CI) integration tests that
(a) insert a shim `auth.users` row then an invite, simulate signup by inserting a second
`auth.users` row with the invited email, and assert the trigger created the user unit,
membership, and admin rows; (b) exercise `POST /v1/orgs` including the `already_member`
409; (c) assert the FK cascade: deleting a shim `auth.users` row removes membership and
PATs but leaves `asset_versions` and `audit_log` rows intact.

---

## 4. Seed changes (`backend/supabase/seed/seed_dev.py`)

The new FKs mean membership rows now require real `auth.users` rows. Make the seed
dual-mode, keyed on whether `SUPABASE_URL` **and** `SUPABASE_SERVICE_ROLE_KEY` are set:

- **Cloud mode:** for each of `ana@acme.test`, `cass@acme.test`, `root@acme.test`, create
  the login via GoTrue admin API `POST {SUPABASE_URL}/auth/v1/admin/users` (headers
  `apikey` + `Authorization: Bearer` with the service-role key) and body
  `{"email": ..., "password": <from env SEED_USER_PASSWORD, required in this mode>,
  "email_confirm": true}`. On 422 "already registered", look the user up via
  `GET /auth/v1/admin/users?page=1&per_page=1000` filtered by email. Replace the
  `AUTH_USERS` uuid5 constants with the **returned ids** for every downstream insert.
  Important: the signup trigger will have auto-linked users if pending invites exist; the
  seed's own `on conflict (auth_user_id) do update` upserts remain correct either way.
- **Local mode (default, used by CI and `scripts/e2e.sh`):** before `upsert_org_units`,
  insert the three uuid5 ids into the shim:
  `insert into auth.users (id, email) values ($1,$2) on conflict (id) do nothing` — keeping
  today's deterministic ids so nothing else in the seed or e2e assertions changes.

Print the PATs exactly as today; in cloud mode also print `SEED_USER_PASSWORD` guidance.

---

## 5. Web app changes (`web/`)

1. Add dependency `@supabase/supabase-js@^2`. New file `web/src/supabase.ts`:
   `createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)`.
   Add `web/.env.example` with both `VITE_` vars. Vite statically inlines them — they are
   public by design; the anon key is not a secret. The service-role key must never appear
   anywhere under `web/`.
2. Replace the PAT `Login` component in `web/src/main.tsx` with email + password sign-in
   and a sign-up tab (`supabase.auth.signInWithPassword`, `supabase.auth.signUp`). Delete
   the `harness_admin_pat` localStorage usage. Source the bearer token per request from
   `(await supabase.auth.getSession()).data.session?.access_token` inside the existing
   `request()` helper so supabase-js's automatic refresh is always honored; on a 401 after
   refresh, `supabase.auth.signOut()` and show the login screen.
3. Onboarding: when `GET /v1/me` returns 404 `no_workspace`, render a screen with two
   paths — "Create an organization" (org name + first team name → `POST /v1/orgs`, then
   reload) and static text "or ask your admin to invite this email address".
4. Invites UI: on a selected `role='team'` unit, a "Members" panel with an invite form
   (email, optional admin checkbox → `admin_level='admin'`, `admin_unit_id=<team id>`)
   posting to `POST /v1/org-units/{id}/invites`, plus the pending-invite list from the GET
   endpoint with a revoke button.
5. CLI tokens: a user-menu "CLI access" modal that calls the existing
   `POST /v1/personal-access-tokens` (name + optional expiry) and displays the `hpat_`
   token exactly once with copy button — this is now the **only** place PATs are minted for
   humans. `harness login` (token paste) is unchanged.

The dev proxy in `web/vite.config.ts` stays: `/v1` → the local backend; supabase-js talks
to `VITE_SUPABASE_URL` directly.

---

## 6. CLI and Pi packages

**No changes this phase.** The CLI keeps PAT paste (`harness login`), and the extension
keeps `HARNESS_API_TOKEN`. Direction note for a later phase: a device-code login
(`harness login --sso`) that opens the web app and exchanges the Supabase session for a
scoped PAT server-side.

---

## 7. Environments, scripts, and CI

### 7.1 Environment matrix

| Variable | Local dev / CI | Cloud (staging/prod) |
|---|---|---|
| `DATABASE_URL` | local Postgres | transaction pooler, port 6543 |
| `MIGRATE_DATABASE_URL` | same as `DATABASE_URL` | session pooler, port 5432 |
| `HARNESS_MASTER_KEY` | throwaway base64 key | secret manager |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | unset (local mode) | set (backend + seed) |
| `SUPABASE_JWKS_URL` | unset (PAT-only tests) | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_JWT_SECRET` | unset | only if signing keys stay legacy HS256 |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | staging project (web dev) | project values |

Update `backend/.env.example` and add `web/.env.example` accordingly.

### 7.2 Scripts

- `scripts/e2e.sh` and `scripts/dev.sh`: the `backend/supabase/migrations/*.sql` globs keep
  working (timestamped names sort correctly). No changes required beyond re-running.
- `.github/workflows/backend.yml`: no changes — the psql loop and Postgres 15 service
  exercise the shim/RLS no-op paths exactly as production Postgres would.

### 7.3 New workflow: `.github/workflows/deploy-db.yml`

Triggers: `workflow_dispatch`, and `push` to `main` filtered to
`backend/supabase/migrations/**`. Single job:

```yaml
- uses: actions/checkout@v4
- uses: supabase/setup-cli@v1
- run: supabase link --project-ref "$SUPABASE_PROJECT_REF"
  working-directory: backend
- run: supabase db push
  working-directory: backend
```

with `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` as repository secrets and
`SUPABASE_PROJECT_REF` as a repository variable. `permissions: contents: read`,
concurrency-group the workflow so pushes serialize.

---

## 8. Task breakdown (order matters)

**S1 — Provision Supabase project** (human, §1). Acceptance: all §1 values recorded in the
secret store; a `psql` connection over the session pooler succeeds.

**S2 — Migrations.** Rename the eight files; add the four new migrations verbatim (§2);
`supabase init` scaffolding (§2.5). Acceptance: (a) fresh local Postgres — psql loop applies
all twelve files cleanly, full backend test suite passes; (b) trigger test from §3.6 passes;
(c) `supabase db push` against the cloud project applies cleanly; (d)
`select relrowsecurity from pg_class where relname='assets'` is true in the cloud DB.

**S3 — Seed dual-mode** (§4). Acceptance: local mode leaves `scripts/e2e.sh` green
end-to-end; cloud mode run twice in a row is idempotent and prints working PATs;
`ana@acme.test` can sign in with `SEED_USER_PASSWORD` on the hosted Auth endpoint.

**S4 — Backend** (§3). Acceptance: existing 35 tests plus new tests pass; with the backend
pointed at the cloud `DATABASE_URL` (transaction pooler), `/health`, `/v1/me` (PAT), and
`/v1/resolve` all succeed — this specifically proves `statement_cache_size=0`; a Supabase
JWT minted by password sign-in authenticates `/v1/me` with the correct `auth_user_id`.

**S5 — Web** (§5). Acceptance: sign-up of a fresh email with a pending invite lands in the
tree with a workspace (trigger path); an already-registered login invited afterward gets
linked on its next `GET /v1/me` (lazy-link path); sign-up without an invite shows
onboarding and `POST /v1/orgs` produces a working org; a PAT minted from the CLI-access
modal works with `harness login` against the same backend.

**S6 — Deploy workflow** (§7.3). Acceptance: `workflow_dispatch` run is green and
`supabase migration list` shows all twelve migrations applied.

**S7 — Cloud golden flow.** Run the backend against the cloud database, seed in cloud mode,
then: web sign-in as ana → mint PAT → `harness login` → `harness run -p "say hello"`
against the mock provider → verify `harness_sessions` row closed and
`GET /v1/org-units/{finance}/audit/verify` returns `{"intact": true}`. Record the runbook
output in `docs/build-decisions.md`.

## 9. Non-goals (this phase)

- No PostgREST/`supabase-js` database access from any client; no Realtime, Storage, or Edge
  Functions.
- No social/OIDC SSO providers (Supabase makes these a config flip later; the connection
  grant broker of `docs/plan-improvement.md` F2 is a separate module).
- No CLI device-flow login; no PAT deprecation.
- No RLS policy modeling — RLS here is a lockout, not an authorization layer; authorization
  stays in `backend/app/api/deps.py`.
