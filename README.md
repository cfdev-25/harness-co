# The Harness Company

Secure enterprise AI harness management built on an owned copy of the Pi agent harness.

**Where to read.**

- Product requirements (normative): [`docs/prd-v2.md`](docs/prd-v2.md)
- Engine plan — the CLI, `definitions`, broker, proxy, sandbox, adapters: [`docs/engine/00-overview.md`](docs/engine/00-overview.md) (spine) and `docs/engine/01`–`11`
- Console plan — the web app and its API: [`docs/console/00-overview.md`](docs/console/00-overview.md) and `docs/console/01`–`08`
- **What to do next:** [`docs/next-steps.md`](docs/next-steps.md)
- How it was built, wave by wave, with what was verified: [`docs/build-log.md`](docs/build-log.md); the traps: [`docs/build-decisions.md`](docs/build-decisions.md)
- **Install and first run:** [`docs/guide/install.md`](docs/guide/install.md), then an admin's [first hour](docs/guide/first-hour-admin.md) or a member's [first session](docs/guide/first-session.md)
- The cutover runbook (dev cutover done 26 Sep): [`backend/app/migration/cutover.md`](backend/app/migration/cutover.md)
- What the public site claims and what backs it: [`docs/homepage-promises.md`](docs/homepage-promises.md); the security claim itself: [`docs/enforcement-philosophy.md`](docs/enforcement-philosophy.md)
- Upstream Pi patch log: [`docs/pi-patches.md`](docs/pi-patches.md); Supabase set-up and which env key lives where: [`docs/supabase-migration-plan.md`](docs/supabase-migration-plan.md) §7.1
- Superseded documents, kept as sources: [`docs/archive/`](docs/archive/README.md)

## Getting started

The full path — CLI on your `PATH`, stack running, first token — is
[`docs/guide/install.md`](docs/guide/install.md). The short form:

Requires Node 22.19+ (see `.nvmrc`) and [uv](https://docs.astral.sh/uv/).

```bash
npm install                     # dev orchestration only
cd backend && uv sync --all-groups && cd ..
npm run dev
```

`backend/.env` and `web/.env` hold the Supabase credentials and are not in git;
`docs/supabase-migration-plan.md` §7.1 lists which key belongs in which file.

`npm run dev` starts the whole stack in one terminal with per-service log prefixes:

| Prefix           | Service                                   | Address                 |
| ---------------- | ----------------------------------------- | ----------------------- |
| `[api]`          | FastAPI backend (`--reload`)              | `http://127.0.0.1:8400` |
| `[definitions]`  | the git definition plane (no reload — restart after `npm run build -w engine/definitions`) | `http://127.0.0.1:8402` |
| `[web]`          | Next.js web console                       | `http://localhost:3000` |

Ctrl-C stops all three. The ports are fixed, so `npm run dev` reclaims them on
startup — anything already listening on 8400, 8402 or 3000 is terminated first.
Override with `BACKEND_PORT` or `WEB_PORT` to leave a neighbouring project alone:

```bash
WEB_PORT=3010 npm run dev
```

Individual services: `npm run dev:api`, `npm run dev:web`.

The database is populated by hand — apply `backend/supabase/migrations/` and
insert the rows you need. There is no seed script.
