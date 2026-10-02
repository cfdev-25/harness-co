# Pi Upstream Patch Log

Changes to files inherited from upstream Pi must be recorded here.

## 2026-09-15 — Initial vendoring

- Source: `https://github.com/earendil-works/pi.git`
- Upstream commit: `60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759`
- Import method: `git subtree add --prefix=pi --squash`
- No upstream files modified.

## 2026-09-15 — Harness workspace registration

- `pi/package.json` already registers `packages/*`, so no workspace-list change was necessary.
- `pi/package-lock.json`: regenerated workspace metadata to register the new
  `@harness/pi-harness` and `@harness/pi-harness-cli` packages. No upstream
  dependency versions or source files were intentionally changed.

- **2026-09-28** `package.json` `build:offline` now also builds `packages/harness` (the extension). It was only in `build`, which the root build never runs (it rewrites tracked files), so `pi/packages/harness/dist` went stale behind its source and every session read `policy.json` from the old path and disabled every tool.
