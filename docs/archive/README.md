# Archive

Documents the build superseded. They are kept because the plans cite them
as *sources* — the surveys and constraints the engine and console plans were
written from — and because code comments still point at a few of their
sections. Nothing here is normative; where one of these disagrees with
`docs/prd-v2.md`, `docs/engine/` or `docs/console/`, the plan wins.
`docs/engine/00-overview.md` §9 lists the supersessions one by one.

| File | What it was | Superseded by |
| --- | --- | --- |
| `prd.md` | product requirements v1 | `prd-v2.md` |
| `plan-improvement.md` | the architecture critique that produced v2 | `prd-v2.md`, engine D1 (its Postgres-CAS decision was reversed) |
| `scoping.md` | the asset-scopes model (Postgres) | `prd-v2.md` §21; engine 01/02 |
| `harnesses.md` | harness schema, `(kind, name)` keying | engine 01 (D3), D8 |
| `agents.md` | the first adapter interface, preferences, `allowed_agents` | engine 00 §4.8, 07 |
| `asset-sync.md` | client sync before git was the definition plane | engine 02 |
| `enforcement-architecture.md`, `enforcement-gaps.md` | the pre-plan enforcement design and its gap list | engine 03, 05, 06 — each gap is marked closed by the doc that closes it |
| `sandbox-notes.md`, `claude-code-notes.md`, `pi-extension-notes.md` | spikes and provider notes | engine 06, 07 |
| `build-plan.md` | the phased plan before sequencing | engine 09, console 06 |
| `v3.md` | an interim plan | engine 09 |
