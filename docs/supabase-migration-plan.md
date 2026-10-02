# Supabase Cloud Migration Plan

**Status:** Ready for implementation handoff.

**Goal:** Move the database from local PostgreSQL to a cloud-hosted Supabase project, and
replace token-paste web authentication with organization login built on Supabase Auth
(`auth.users`). Users authenticate with email and password; membership in an organization
is what grants access, resolved through the existing `org_unit_members` / `org_unit_admins`
tables keyed by `auth.users.id`.

**Read first:** `docs/archive/prd.md` §1.2 (tree), `docs/archive/plan-improvement.md` F1/F2 (enforcement
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
- **D5 — Hosted Supabase is the only database.** No local Postgres, no `auth.users` shim,
  no `MIGRATE_DATABASE_URL`, no dual-mode seed. CI, e2e, and local `uvicorn` all use the
  same project via `DATABASE_URL`. The eight already-applied files (`0001`–`0008`) stay
  named as they are and must not be re-run. New work is three additive files only.
- **D6 — One connection string.** `DATABASE_URL` is the Supabase **session pooler**
  (port `5432`). The API, migrations, and seed all use it. Do not add a transaction-pooler
  (6543) URL in this phase. Still set `statement_cache_size=0` on the asyncpg pool so a
  later switch to 6543 does not break prepared statements.

---

## 1. Supabase project provisioning (manual, dashboard)

One-time setup by a human; record outcomes in `docs/build-decisions.md`.

1. Create project `harness-co-staging` (region `us-east-1` or nearest; note region — it
   appears in the pooler hostname). Save the database password in the team password manager.
2. Auth settings: enable the **Email** provider (password sign-in **and** sign-up enabled);
   disable all social providers; leave "Confirm email" **on**.
3. Enable **JWT signing keys** (asymmetric) under Project Settings → API → JWT keys, so
   tokens are ES256-signed and verifiable via JWKS without sharing a secret.
4. Collect and put in local env files (never commit the real values):
   - `backend/.env` — copy `backend/.env.example`. One `DATABASE_URL` (session pooler,
     port `5432`), plus `HARNESS_MASTER_KEY`, `SUPABASE_URL`,
     `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS_URL`, `SEED_USER_PASSWORD`.
   - `web/.env.local` — copy `web/.env.example`. Only `NEXT_PUBLIC_SUPABASE_URL` and
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`. **Never** the service-role key.

---

## 2. Migration file plan

`0001`–`0008` are already applied on the hosted project. **Do not rename them. Do not
re-run them.** `auth.users` already exists on Supabase — there is no shim migration.

Add exactly three new files under `backend/supabase/migrations/`, verbatim below, and
apply them once on the same project (SQL editor or `supabase db push` after the project is
linked). If the first eight were pasted in the SQL editor rather than `db push`, do not
point the CLI at this project until those eight filenames are recorded as applied; adding
the three new files in the SQL editor is the safe path until then.

### 2.1 `0009_auth_user_links.sql`

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

### 2.2 `0010_org_invites.sql`

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

### 2.3 `0011_rls_lockdown.sql`

The backend connects as the `postgres` role, which **owns** every table created by these
migrations; table owners bypass row-level security unless `force` is used, so enabling RLS
with zero policies changes nothing for the API while closing Supabase's auto-generated
PostgREST surface (`anon` / `authenticated` roles).

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

Remove the localhost default on `database_url`. It becomes a required field. Add:

```python
supabase_url: str                          # https://<ref>.supabase.co
supabase_service_role_key: str
seed_user_password: str | None = None
```

There is no `migrate_database_url`. Keep `supabase_jwks_url`, `supabase_jwt_secret`,
`harness_master_key`, `harness_env`.

### 3.2 `backend/app/db.py`

In `create_pool`, add `statement_cache_size=0` to the `asyncpg.create_pool` call. Required
if `DATABASE_URL` is later pointed at the transaction pooler (6543); harmless on 5432.
`ensure_audit_partitions` DDL runs on the same URL.

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
  which fires the §2.2 trigger on a different connection — so the invite row must be
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

Keep the existing 35 DB-free unit tests. Add integration tests that use `DATABASE_URL`
(the hosted project) and create Auth users through GoTrue
`POST {SUPABASE_URL}/auth/v1/admin/users` — never by inserting into `auth.users` directly
(RLS/ownership and trigger behavior only match a real signup that way):

(a) create user A, invite A's email to a team, create user B with that email (or use the
invite endpoint then sign the user up), assert membership + optional admin rows; (b)
`POST /v1/orgs` including the `already_member` 409; (c) delete the Auth user via
`DELETE /auth/v1/admin/users/{id}` and assert membership/PATs cascade while
`asset_versions` and `audit_log` remain.

CI no longer starts a Postgres service. `.github/workflows/backend.yml` gets
`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `HARNESS_MASTER_KEY`
from repository secrets and runs pytest + ruff against the hosted project. The e2e job
in that workflow drops its Docker Postgres and uses the same secrets.

---

## 4. Seed changes (`backend/supabase/seed/seed_dev.py`)

Require `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`HARNESS_MASTER_KEY`, and `SEED_USER_PASSWORD`. There is no local/shim path.

For each of `ana@acme.test`, `cass@acme.test`, `root@acme.test`, create the login via
GoTrue `POST {SUPABASE_URL}/auth/v1/admin/users` with headers
`apikey` + `Authorization: Bearer` (service-role) and body
`{"email": ..., "password": $SEED_USER_PASSWORD, "email_confirm": true}`. On 422
"already registered", look the user up via
`GET /auth/v1/admin/users?page=1&per_page=1000` filtered by email. Replace the
`AUTH_USERS` uuid5 constants with the **returned ids** for every downstream insert.

The signup trigger links a user if a pending invite exists; the seed's
`on conflict (auth_user_id) do update` upserts stay correct either way. Print the PATs
exactly as today, plus a line that those emails sign in with `SEED_USER_PASSWORD`.

---

## 5. Web app changes (`web/`)

1. Add dependency `@supabase/supabase-js@^2`. New file `web/lib/supabase.ts`:
   `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)`.
   Add `web/.env.example` with both `NEXT_PUBLIC_` vars. Next.js inlines them into the
   browser bundle — they are public by design; the anon key is not a secret. The
   service-role key must never appear anywhere under `web/`.
2. Replace the PAT `Login` component in `web/app/admin.tsx` with email + password sign-in
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

The Next.js rewrite in `web/next.config.ts` stays: `/v1` → the local backend; supabase-js
talks to `NEXT_PUBLIC_SUPABASE_URL` directly.

---

## 6. CLI and Pi packages

**No changes this phase.** The CLI keeps PAT paste (`harness login`), and the extension
keeps `HARNESS_API_TOKEN`. Direction note for a later phase: a device-code login
(`harness login --sso`) that opens the web app and exchanges the Supabase session for a
scoped PAT server-side.

---

## 7. Environments, scripts, and CI

### 7.1 Environment matrix

One project, one `DATABASE_URL`. Local `.env` files and GitHub Actions secrets use the
same names.

| Variable | Where | Value |
|---|---|---|
| `DATABASE_URL` | `backend/.env`, CI | session pooler, port **5432** |
| `HARNESS_MASTER_KEY` | `backend/.env`, CI | base64 32-byte key |
| `SUPABASE_URL` | `backend/.env`, CI | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env`, CI | service_role. Never in `web/` |
| `SUPABASE_JWKS_URL` | `backend/.env`, CI | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_JWT_SECRET` | `backend/.env` | only if JWTs are still HS256 |
| `SEED_USER_PASSWORD` | `backend/.env` | password for seeded Auth users |
| `PROVIDER_BASE_URL` | `backend/.env` | OpenAI-compatible endpoint, e.g. `.../v1` |
| `PROVIDER_MODEL_ID` | `backend/.env` | model id the seeded workspace resolves to |
| `PROVIDER_API_KEY` | `backend/.env` | provider key; seeded into `api_keys` encrypted |
| `HARNESS_SIGNUP_CODE` | `backend/.env`, CI | the sign-up door's one access code (W7-D1). **Unset refuses every sign-up**, so a deployment that forgets it is closed, not open. Dev value is named in chat, not in a file |
| `NEXT_PUBLIC_SUPABASE_URL` | `web/.env.local` | same project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `web/.env.local` | anon / publishable key |

These keys live only in the real `backend/.env` and `web/.env`; there are no
`.env.example` templates in the repo.

### 7.2 Scripts

- `scripts/dev.sh`: drop the Docker/Homebrew Postgres block. Start uvicorn with
  `backend/.env` (`DATABASE_URL` already points at Supabase). Keep the web and mock
  provider processes. *(Superseded 2026-09-17: replaced by the root `npm run dev`
  and `scripts/dev-preflight.sh`; the mock provider was removed.)*
- `scripts/e2e.sh`: drop the Docker Postgres container, the schema-drop reset, and
  `HARNESS_E2E_DATABASE_URL`. Require `backend/.env` (or the same vars in the
  environment). Seed against the hosted project, then run the CLI flow.
- `.github/workflows/backend.yml`: remove the Postgres service, the `5433` port mapping,
  and the `psql` migration loop. Inject the secrets in §7.1. Run `uv sync`, ruff, pytest,
  then `bash scripts/e2e.sh`.

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

**S1 — Provision Supabase project** (human, §1). Acceptance: `backend/.env` and
`web/.env.local` filled from the dashboard; `psql "$DATABASE_URL" -c 'select count(*) from org_units'`
succeeds against the already-applied `0001`–`0008` schema.

**S2 — Migrations.** Add `0009`, `0010`, `0011` only (§2); `supabase init` scaffolding
(§2.5). Do not rename or re-apply `0001`–`0008`. Acceptance: the three new files apply
once; `select relrowsecurity from pg_class where relname='assets'` is true; a GoTrue-created
user plus an invite produces a membership row via the trigger.

**S3 — Seed** (§4). Acceptance: running the seed twice is idempotent; it prints PATs;
`ana@acme.test` can `signInWithPassword` with `SEED_USER_PASSWORD`.

**S4 — Backend** (§3). Acceptance: existing 35 tests plus new hosted integration tests
pass; `/health`, `/v1/me` (PAT), and `/v1/resolve` succeed against `DATABASE_URL`; a
Supabase JWT from password sign-in authenticates `/v1/me` with the correct `auth_user_id`.

**S5 — Web** (§5). Acceptance: sign-up of a fresh email with a pending invite lands in the
tree with a workspace (trigger path); an already-registered login invited afterward gets
linked on its next `GET /v1/me` (lazy-link path); sign-up without an invite shows
onboarding and `POST /v1/orgs` produces a working org; a PAT minted from the CLI-access
modal works with `harness login` against the same backend.

**S6 — Deploy workflow** (§7.3). Acceptance: `workflow_dispatch` is green. If the first
eight files were applied in the SQL editor, record them as already applied before the
first `db push`, or keep applying new files in the editor until that baseline exists.

**S7 — Cloud golden flow.** Seed, then:
then: web sign-in as ana → mint PAT → `harness login` → `harness run -p "say hello"`
against the provider in `PROVIDER_BASE_URL` → verify `harness_sessions` row closed and
`GET /v1/org-units/{finance}/audit/verify` returns `{"intact": true}`. Record the runbook
output in `docs/build-decisions.md`.

## 9. Non-goals (this phase)

- No PostgREST/`supabase-js` database access from any client; no Realtime, Storage, or Edge
  Functions.
- No social/OIDC SSO providers (Supabase makes these a config flip later; the connection
  grant broker of `docs/archive/plan-improvement.md` F2 is a separate module).
- No CLI device-flow login; no PAT deprecation.
- No RLS policy modeling — RLS here is a lockout, not an authorization layer; authorization
  stays in `backend/app/api/deps.py`.
- No local Postgres, `auth.users` shim, `MIGRATE_DATABASE_URL`, or transaction-pooler
  (6543) URL. One session-pooler `DATABASE_URL` only.
