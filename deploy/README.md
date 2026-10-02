# Deploying the API and the definitions service to Fly.io

Two Fly apps, built from the two Dockerfiles beside this file. The web app
stays on Vercel; Postgres and Auth stay on Supabase (the same project the
development stack uses — its schema is already migrated).

| App | Image | Public hostname | Holds |
| --- | --- | --- | --- |
| `harness-co-api` | `deploy/api.Dockerfile` | `https://harness-co-api.fly.dev` | nothing (Postgres is Supabase) |
| `harness-co-definitions` | `deploy/definitions.Dockerfile` | `https://harness-co-definitions.fly.dev` | the organisations' git repositories, on the volume `definitions_data` at `/data` |

If either name is taken on Fly, pick another and substitute it everywhere
below (and in the two `fly.*.toml` files' `app =` lines).

## One time, in this order (≈ 25 minutes)

All commands run from the repository root. You are already signed in to
`fly` on this machine (`fly auth whoami`).

**1. Create the two apps without deploying.**

```sh
fly apps create harness-co-api
fly apps create harness-co-definitions
```

**2. Create the volume the repositories live on** (one, in the same region
as the app; `iad` is in both toml files):

```sh
fly volumes create definitions_data --app harness-co-definitions --region iad --size 3 --yes
```

**3. Set the secrets.** Copy the real values from `backend/.env` (same
Postgres, same Supabase project, same master key — the master key must be
the one the stored API keys were encrypted with, or none of them decrypt).
`HARNESS_SERVICE_TOKEN` must be the **same** string on both apps.

```sh
fly secrets set --app harness-co-api \
  DATABASE_URL='<backend/.env DATABASE_URL>' \
  HARNESS_MASTER_KEY='<backend/.env HARNESS_MASTER_KEY>' \
  SUPABASE_URL='<backend/.env SUPABASE_URL>' \
  SUPABASE_SERVICE_ROLE_KEY='<backend/.env SUPABASE_SERVICE_ROLE_KEY>' \
  SUPABASE_JWKS_URL='<backend/.env SUPABASE_JWKS_URL>' \
  HARNESS_SERVICE_TOKEN='<backend/.env HARNESS_SERVICE_TOKEN>' \
  HARNESS_SIGNUP_CODE='<backend/.env HARNESS_SIGNUP_CODE>' \
  DEFINITIONS_URL='https://harness-co-definitions.fly.dev'

fly secrets set --app harness-co-definitions \
  HARNESS_SERVICE_TOKEN='<the same token>' \
  API_URL='https://harness-co-api.fly.dev'
```

`DEFINITIONS_URL` is both where the API calls the service and the origin the
CLI is told to push to (`/v1/me` → `definitions`), so it must be the public
hostname, never an internal one.

**4. Deploy both.**

```sh
fly deploy --config deploy/fly.api.toml
fly deploy --config deploy/fly.definitions.toml
```

Each takes a few minutes the first time (Fly builds the image remotely if
Docker is not running locally). When both finish:

```sh
curl https://harness-co-api.fly.dev/health
curl https://harness-co-definitions.fly.dev/health
```

Both answer `200`; the second also says whether it can reach the API.

**5. Point the web app at the API.** In Vercel → the project → Settings →
Environment Variables, set

```
HARNESS_API_ORIGIN = https://harness-co-api.fly.dev
```

for Production, then redeploy the web project (Deployments → ⋯ → Redeploy).
That one variable is both the server-side origin the console fetches and
the `/v1` rewrite the browser uses; the How this works → Set up block
renders it into the login command.

**6. Supabase.** Authentication → URL Configuration → add the Vercel
domain's `/signup` and `/login` to *Redirect URLs* (the sign-up link comes
back there). Before real sign-ups, Project Settings → Auth → SMTP: the
default mailer is rate-limited.

**7. Try it as a person would.** On the deployed console: sign up with the
code, open How this works → Set up, generate a token, paste the three
commands into a terminal, open a harness from the card.

## Every later deploy

```sh
fly deploy --config deploy/fly.api.toml
fly deploy --config deploy/fly.definitions.toml
```

Only the app whose code changed needs redeploying. The definitions app runs
one machine on purpose (a git repository cannot be served from two), so a
deploy there is ten to twenty seconds of downtime for pushes; sessions
already open are not affected.

## Backups

Fly snapshots the volume daily and keeps five (`snapshot_retention` in the
toml). Add a nightly copy of `/data/definitions` to object storage before
there is anything you cannot afford to lose:

```sh
fly ssh console --app harness-co-definitions -C "tar czf - /data/definitions" > definitions-$(date +%F).tgz
```

is the manual form; a scheduled machine or a GitHub Action running the same
line into an S3 bucket is the automated one. Restore is the reverse `tar`
into a fresh volume.

## Reading logs and getting a shell

```sh
fly logs --app harness-co-api
fly logs --app harness-co-definitions
fly ssh console --app harness-co-definitions
```
