# The Harness Company

Secure enterprise AI harness management built on an owned copy of the Pi agent harness.

- Product requirements: [`docs/prd.md`](docs/prd.md)
- Architecture critique: [`docs/plan-improvement.md`](docs/plan-improvement.md)
- Build decisions: [`docs/build-decisions.md`](docs/build-decisions.md)
- Upstream Pi patch log: [`docs/pi-patches.md`](docs/pi-patches.md)

## Getting started

Requires Node 22.19+ (see `.nvmrc`) and [uv](https://docs.astral.sh/uv/).

```bash
npm install                     # dev orchestration only
cd backend && uv sync --all-groups && cd ..
npm run dev
```

`backend/.env` and `web/.env` hold the Supabase credentials and are not in git;
`docs/supabase-migration-plan.md` §7.1 lists which key belongs in which file.

`npm run dev` starts the whole stack in one terminal with per-service log prefixes:

| Prefix  | Service                      | Address                 |
| ------- | ---------------------------- | ----------------------- |
| `[api]` | FastAPI backend (`--reload`) | `http://127.0.0.1:8400` |
| `[web]` | Next.js web console          | `http://localhost:3000` |

Ctrl-C stops both. The ports are fixed, so `npm run dev` reclaims them on
startup — anything already listening on 8400 or 3000 is terminated first.
Override with `BACKEND_PORT` or `WEB_PORT` to leave a neighbouring project alone:

```bash
WEB_PORT=3010 npm run dev
```

Individual services: `npm run dev:api`, `npm run dev:web`.
End-to-end flow: `npm run e2e`. It additionally needs `SEED_USER_PASSWORD`,
`PROVIDER_BASE_URL`, `PROVIDER_MODEL_ID`, and `PROVIDER_API_KEY` in
`backend/.env` — it seeds a real provider connection and runs the CLI against it.
