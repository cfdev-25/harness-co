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

## 2026-09-17 — Development seed removed

`backend/supabase/seed/` (651-line `seed_dev.py` plus its README) was deleted.
Nothing in `backend/app/` or `backend/tests/` imported it — the 35 backend tests
pass without it — so it only ever served local database setup. Development data
is now inserted by hand after applying `backend/supabase/migrations/`.

`scripts/e2e.sh` and the root `e2e` npm script went with it: the golden flow
shelled out to `seed_dev.py` and parsed `ANA_PAT=` from its output for the CLI
login, so it was inert once the seed was gone. Both are recoverable from history
(`df34212b0` for the flow, `55658fe6b^` for the last working seed).

`docs/supabase-migration-plan.md` §4 still describes the seed; it is kept as the
historical record of what was planned, not as a description of the tree.

## 2026-09-18 — Harnesses

Design and tasks: [`harnesses.md`](harnesses.md). These decisions will be
re-litigated by anyone who did not read it, so they are recorded here too.

**A harness holds only what is put in it.** A new harness is empty, and
nothing joins it later by default. It shipped the other way first — "in every
harness unless narrowed", with an `assets.harness_scope` column defaulting to
`all` — and that was wrong: a default that fills a harness means you cannot
tell what a harness is *for* by looking at it, and every asset published
afterwards silently joins every job. The column is gone.

**A harness names `(kind, name)`, never an asset id.** This is what makes
empty-by-default safe, and it is the decision most likely to be "simplified"
by someone later. With ids: the team puts its `house-style` prompt in Support,
a user pushes their own copy to extend it, resolution hands them theirs,
theirs has no assignment, and Support silently loses the prompt. With names:
the harness names the thing, the tree picks the version, and the user keeps
their copy inside the harness. It also means promotion needs no harness
bookkeeping at all — the copy has the same name — and that there is no
cross-unit rule to enforce, because naming something grants nothing.

**No harness is not an empty harness.** With nothing selected a session loads
everything the user resolves, exactly as before harnesses existed. The absence
of a harness is the absence of a filter, which is what keeps `harness run`
working for anyone who has not adopted them.

**Resolve, then filter — on the client.** `/v1/resolve` returns the whole
resolved set plus the harness's list of names, and `materializeManifest` keeps
the intersection. Filtering inside the resolution query is wrong because there
is one work tree per user: hydration handed a per-harness set would delete
clean asset directories on every switch and fetch them back on the next,
reporting each as "no longer provided by your team". The filter therefore
lives in `byKind`, where every kind inherits it from one line.

**Harness names do not shadow.** Assets resolve nearest-ancestor-wins; two
harnesses called "Support" at different heights are two harnesses, told apart
by their owning unit. A harness is a workspace you choose, not a capability
that overrides, and silently replacing the team's with a personal one would be
a surprise with no upside. `harness switch <unit-path>/<name>` disambiguates.

**The selection is local.** `$HARNESS_HOME/harness.json`, beside the git
directory and outside the agent-writable `assets/`, so the agent cannot change
which harness its user is in. A server-side per-user selection would add a
table and an endpoint to answer a question the machine already knows, and the
rest of the loop (`login`, `pull`, `status`) is local state plus a stateless
server. Revisit if people switch machines often.

**Deleting a harness deletes only the harness.** Its assignments go with it;
every asset it named still exists, still has its history, and still resolves
for everyone it resolved for. `DELETE` is a 204, and the audit event records
what the harness held.

**Boundaries and the model are not per harness.** `policy.json` is identical
in every harness except `allowed_tools`, which is derived from the tools the
harness contains and can only narrow — tighten-only with no new mechanism. The
model comes from `model-default` resolved over the whole set, because it is
wiring rather than context, which is also why an empty harness can still
start.
