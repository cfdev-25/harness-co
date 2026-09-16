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
