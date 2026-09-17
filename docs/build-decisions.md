# Build Decisions

Decisions made where the implementation plan is silent are recorded here.

## 2026-09-15 — Repository scope

The project is a standalone Git repository rooted at `/Users/cf/projects/harness-co`.
Its private GitHub remote is `cfdev-25/harness-co`, and its local commit identity is
`cfdev-25 <cfdev-25@users.noreply.github.com>`.

## 2026-09-15 — Initial Pi build

Pi is pinned at `60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759`. `npm ci` and
`npm run build` completed successfully with Node 22.23.2. npm emitted a non-blocking
engine warning for the optional Gondolin example, which requests Node 23.6 or newer.
The coding-agent executable is `pi/packages/coding-agent/dist/bundle/cli.js`.

The full upstream test command completed all workspaces but exited 1 because 39
`pi-ai` provider E2E tests attempted unauthenticated network calls (reported as
connection errors and missing fixtures). Local package tests continued to run;
for example, the SQLite session backend completed 105/105 tests. Per the plan,
provider-credential failures do not block the pinned upstream build.

## 2026-09-17 — Single dev entrypoint

A root `package.json` (private, not an npm workspaces root — `pi/` and `web/` keep
their own lockfiles) runs the stack with `concurrently` pinned at 10.0.5:
`npm run dev` starts `[api]` on 8400 and `[web]` on 3000 with per-service log
prefixes, and Ctrl-C stops both. `predev` runs `scripts/dev-preflight.sh`, which
checks `backend/.env`, `backend/.venv`, and `web/node_modules`, then **reclaims**
the two fixed ports: SIGTERM the listener, then its supervisor, then SIGKILL,
with the script's own process chain excluded. Fixed ports were chosen over
auto-increment so the app always answers on 3000; `BACKEND_PORT` / `WEB_PORT`
override. `scripts/dev.sh` was removed in favour of this.

Verified: both services healthy (200 on `/health` and `/`), prefixes applied,
SIGINT leaves no listener on either port, and a second `npm run dev` starts
clean. Reclaim was exercised against a stale `uvicorn --reload` supervisor and
worker pair.

## 2026-09-17 — Mock provider removed

The deterministic local provider (`scripts/mock-provider/`) and the spike
artifacts behind `docs/pi-extension-notes.md` (`scripts/spike-headless/`,
`scripts/spike-gating/`) were deleted. `harness-cli` hardcodes
`api: "openai-completions"` (`pi/packages/harness-cli/src/core.ts`), so the
replacement must serve `/chat/completions`; rather than pick a provider, the seed
now requires `PROVIDER_BASE_URL`, `PROVIDER_MODEL_ID`, and `PROVIDER_API_KEY`
with no defaults. The seeded credential is `Default Provider` /
`secret://acme/default-provider` / `PROVIDER_API_KEY`, and a changed
`PROVIDER_API_KEY` now rotates (old version → `grace`, new `max+1` → `active`)
the same way `app.domain.api_keys.rotate` does, instead of failing as an
immutable value. `scripts/e2e.sh` no longer starts a provider or greps for
`MOCK_PROVIDER_OK`; it asserts a non-empty reply plus the two authoritative
database checks.
