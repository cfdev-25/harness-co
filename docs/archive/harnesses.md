# Harnesses

A harness is the job you sit down to do: a named selection of the team's
assets, with a description and a small pixel drawing, that a person switches
into before starting a session. The Harnesses tab is the first tab in the
console, and `harness switch` is how the CLI picks one.

This document is the design and the build plan. §1–§10 are normative: if code
and this document disagree, the code is wrong. §11 lists the tasks in build
order, in the format of [`build-plan.md`](build-plan.md).

Related: [`asset-sync.md`](asset-sync.md) (the work tree this must not
disturb), [`prd.md`](prd.md) §1.1 (the harness as the unit of work),
[`build-plan.md`](build-plan.md) Phase 2.1 (amended by §10 here).

## 0. The one rule

> **A harness holds only what is put in it. The tree still decides whose copy
> of each thing you get.**

A harness is a list of names — this prompt, that skill, those tools. Switching
harnesses swaps the agent's working context: which system prompts and memories
make up its standing brief, which skills it can pick up, which saved prompts
appear under `/`, which tools it may run. That is the point of the feature,
and it is not a security control — it is a context selector, and it can only
ever take away.

A new harness is **empty**. Nothing arrives in it by default, on the day it is
made or later, so what a harness contains is always a decision somebody took.

What a harness does **not** change is the three layers underneath the session.
Resolution stays nearest-ancestor-wins per `(kind, name)`, so *whose* version
of a name you get is the tree's decision, not the harness's. The boundary
stays per org unit, so no harness reaches further than another. The work tree
stays the user's whole library, so switching never deletes or re-downloads a
file.

**No harness is not an empty harness.** With nothing selected a session loads
everything the user resolves, exactly as sessions behaved before harnesses
existed. The absence of a harness is the absence of a filter, which is what
keeps `harness run` working for anyone who has not adopted them.

## 1. What a harness is

| A harness has | A harness does not have |
| --- | --- |
| a name and a description | a boundary of its own — boundaries and connectors are shared by every harness |
| a 16×16 pixel drawing | a model of its own — the model resolves the same way in every harness |
| an owning org unit, like every asset | versions, promotion, or rollback (v1) |
| a list of `(kind, name)` pairs: its contents | any claim on *which* asset answers a name |

**Boundaries, in one line.** `policy.json` is byte-identical across harnesses
except `allowed_tools`, which is derived from the tools the harness contains
and can therefore only *narrow*. That is the tighten-only rule of `prd.md`
§1.3 holding without any new mechanism.

**The model, in one line.** A session's model comes from the connection named
`model-default` resolved over the **whole** set, not the harness's contents,
because it is wiring rather than context. So an empty harness still starts.

## 2. What a harness contains

A row in `harness_assets` is `(harness_id, kind, name)`. That is the whole
definition of a harness's contents.

**It names a `(kind, name)`, never an asset id.** This is the load-bearing
choice, and it is what makes "empty by default" safe:

- The team puts `system_prompt/house-style` in Support.
- A user pushes their own `house-style` to extend it. Resolution hands them
  theirs — that is the point of a personal branch (`asset-sync.md` §1).
- Because Support names `house-style` rather than the team's row, the user
  gets **their** version, in Support, and nobody reassigns anything.

Pinning by row would instead have dropped the prompt out of Support the moment
they pushed, silently, which would make the product's core improvement loop
unsafe. Promotion gets the same property for free: a promoted copy carries the
same name, so it is already in whatever harnesses named it, and there is
nothing to copy and nothing to leave behind.

**A name with nothing behind it is allowed.** It loads nothing and is shown as
such. An assignment is a declaration of intent, so it survives an asset being
archived, or names something a team is about to create. It also means a team
harness may name something only some members have — each member gets whatever
resolves for them, including nothing.

## 3. Resolution, then the harness

Per `(kind, name)` the winner is chosen exactly as today, ignoring harnesses.
The harness is applied afterwards, on the client:

```
loads(asset, harness) :=
    harness is null                                    -- no filter at all
    or (asset.kind, asset.name) ∈ harness.assets
```

The predicate lives once, in the CLI's `core.ts`, because the client is the
only thing that applies it. The server never filters a session: it returns the
full resolved set and the harness's list of names, and the client keeps the
intersection.

**Why not filter on the server?** Because there is one work tree per user
(`asset-sync.md` §1). Hydration must be given the full resolved set; if it
were given a per-harness set, switching harnesses would delete clean
directories with a false "no longer provided by your team" notice, and
switching back would re-deliver them. Filtering after resolution keeps one
manifest, one work tree, and one notion of "what I have". Do not "fix" this.

## 4. Where harnesses live, and invariants

Harnesses are rows attached to an org unit, like assets. A user sees the
harnesses on their chain: their own, their team's, their org's. **Names do not
shadow.** Two harnesses called "Support" at different levels are two
harnesses, told apart by their owning unit. Identity is the id; the name is a
label. This is a deliberate departure from asset resolution, because a harness
is a workspace to pick, not a capability to override, and silently replacing
the team's "Support" with a personal one would be a surprise with no upside.

Invariants, enforced by the API:

1. `(org_unit_id, name)` is unique. Creating a duplicate is
   `409 harness_name_taken`.
2. Writing a harness — creating, renaming, redrawing, deleting, or changing
   what it contains — requires `require_write` on its unit: your own unit, or
   a unit you administer. Any member may make personal harnesses; a team admin
   makes the team's. **The contents belong to the harness**, so adding the
   team's skill to your own harness needs write on your harness and nothing
   on the team.
3. Naming something grants nothing. A session resolves each name the way that
   user always would, so a harness can only narrow what its owner already had.
   There is therefore no cross-unit rule about what may be named, and no way
   to reach another unit's content by naming it.
4. A kind must exist in `asset_kinds`, checked before anything is written.
   Names are free text, matching `assets.name`.
5. Deleting a harness removes it and its assignments, and nothing else. Every
   asset it named still exists, still has its history, and still resolves for
   everyone it resolved for. The confirmation says how many things were in it.
6. A `harness_id` given to `/v1/resolve` or `/v1/sessions` must be on the
   caller's chain, else `404 harness_not_found`.

## 5. Schema — `0017_harnesses.sql`

```sql
create table harnesses (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org_units(id) on delete cascade,
  name text not null,
  description text not null default '',
  icon jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_unit_id, name)
);

create table harness_assets (
  harness_id uuid not null references harnesses(id) on delete cascade,
  kind text not null references asset_kinds(kind),
  name text not null,
  primary key (harness_id, kind, name)
);

alter table harness_sessions
  add column harness_id uuid references harnesses(id) on delete set null;

alter table harnesses enable row level security;
alter table harness_assets enable row level security;
```

Nothing is added to `assets`. A harness knows what it contains; an asset does
not know which harnesses name it, and the question is answered by a join.

## 6. The icon

```json
{
  "palette": ["#c8875a", "#2b211c", "#f2e8dc"],
  "rows": [
    "................",
    "....00000000....",
    "...0111111110...",
    "..."
  ]
}
```

Validated server-side by a pydantic model in `app/domain/harnesses.py`:

- `palette`: up to 16 entries, each `^#[0-9a-f]{6}$` (lower-case). Empty is
  allowed, in which case every pixel must be transparent.
- `rows`: exactly 16 strings of exactly 16 characters, each character a hex
  digit below `len(palette)` or `.` for transparent. The size is not stored
  separately: the rows are the size, and both renderers read it from them.
- An all-transparent icon is valid, and is the default when none is given.
  The console nudges; the server does not insist.

A rejection is the app's ordinary `422 invalid_request`, whose `detail.errors`
names the field and the reason in plain words — "Row 3 has 15 pixels; every
row needs 16."

### 6.1 Terminal rendering

One function, in the CLI, tested there, used by `switch`, `doctor`, and `run`
(which pre-renders for the extension — §8.3):

```ts
// pi/packages/harness-cli/src/pixels.ts
export type ColorMode = "truecolor" | "256" | "mono";
export function renderIcon(icon: Icon, mode: ColorMode): string[];
```

Each terminal cell holds two vertically stacked pixels using half-blocks, so a
16×16 icon is 8 lines by 16 columns and reads as roughly square:

| top | bottom | cell |
| --- | --- | --- |
| clear | clear | space |
| colour | clear | `▀` with fg = top |
| clear | colour | `▄` with fg = bottom |
| a | b | `▀` with fg = a, bg = b (`█` fg = a when a = b) |

Every cell restates its own colours and every line ends reset, so a line can
sit beside other text without a neighbour's background bleeding across it.
`truecolor` emits `38;2;r;g;b` / `48;2;r;g;b`; `256` maps to the nearest 6×6×6
cube colour; `mono` emits the glyphs with no colour, so the shape survives a
pipe. `style.ts` gains `colorMode(): ColorMode` — `mono` under the conditions
that already disable colour there (not a TTY, `NO_COLOR`, `TERM=dumb`, `CI`),
`truecolor` when `COLORTERM` is `truecolor` or `24bit`, otherwise `256`.

### 6.2 Web rendering

`<PixelArt icon size>` renders an inline SVG with one `<rect>` per opaque
pixel, `viewBox="0 0 16 16"`, `shape-rendering="crispEdges"`. Used at three
sizes: tile, screen header, editor preview. No canvas, no library.

## 7. API

New router `app/api/routes_harnesses.py`, tag `harnesses`, mounted under `/v1`
like the others. Every mutation appends an authoritative audit event on the
harness's unit.

| Method and path | Access | Behaviour |
| --- | --- | --- |
| `GET /org-units/{id}/harnesses` | `can_read` on the unit | The harnesses **visible at** that unit: its own and its ancestors'. Each row: the `harnesses` columns plus `org_unit_path` and `assigned_assets` (how many things it contains). Whether a row is inherited is `org_unit_id` against the unit asked for, so it is derived rather than sent. |
| `POST /harnesses` | `require_write` on `org_unit_id` | Body `{org_unit_id, name, description?, icon?}`. `name` 1–60 characters, trimmed; `description` ≤ 2000; a missing icon is blank. `201` with the row, which contains nothing. Duplicate name → `409 harness_name_taken`. Audit `harness.create`. |
| `GET /harnesses/{id}` | `can_read` on the harness's unit | The row plus `assets`: **one list** of every name that resolves at the harness's own unit, each with `kind`, `name`, `assigned`, and the `asset_id` / `org_unit_path` that answers it there. A name that is assigned but resolves to nothing is included with `asset_id: null`, so an assignment can never be silently invisible. One list is both "what is in this" and "what you can add", which is why the console needs one request and one checkbox list. |
| `PUT /harnesses/{id}/assets` | `require_write` | Body `{assets: [{kind, name}]}`, ≤ 500, replacing the set outright. Unknown kinds are `422 unknown_asset_kind`, checked before any write. Audit `harness.assets`. |
| `PATCH /harnesses/{id}` | `require_write` | Any of `name`, `description`, `icon`. Sets `updated_at`. Audit `harness.update`. |
| `DELETE /harnesses/{id}` | `require_write` | `204`. Removes the harness and its assignments; nothing else. Audit `harness.delete` records what it held. |
| `PUT /assets/{id}/harnesses` | read on the asset, `require_write` on each harness added or removed | Body `{harness_ids: [...]}` — the same table from the other side, for the asset's Manage pane. Sets which harnesses name this asset's `(kind, name)`. An id not visible to the caller is `404 harness_not_found`. Audit `asset.harnesses`. |

Existing endpoints change shape:

- `GET /org-units/{id}/assets` and `GET /assets/{id}` gain `harness_ids`: the
  harnesses **at or above** the asset's unit that name it, because those are
  the harnesses whose audience this asset can reach. Someone's personal
  harness may also name it; that is their business and appears on their own
  harness screen.
- `GET /resolve` gains `?harness_id=` — §7.1.
- `POST /sessions` accepts `harness_id` (nullable); the row stores it.
- `POST /assets/{id}/promote` is unchanged apart from losing the column it
  never needed. Harnesses hold names, and the name does not change.

### 7.1 The manifest — version 4

```jsonc
{
  "manifest_version": 4,
  "harness": null | {
    "id", "name", "description", "icon", "org_unit_path",
    "assets": [ { "kind", "name" } ]      // what it contains
  },
  "harnesses": [ { "id", "name", "org_unit_path" } ],   // every one visible
  "assets": [ ... ],    // the full resolved set, unchanged by the harness
  "boundary": { ... },  // unchanged — no harness field
  "model": { ... }      // unchanged — resolved over the whole set
}
```

`assets` is the full resolved set, as before, and carries **no** harness
fields: membership is a property of the harness, so it travels once. The
client keeps the assets whose `(kind, name)` is on `harness.assets`. The
`resolve` audit payload gains `harness_id`. The `harnesses` list is what lets
`harness run` say "you have three harnesses and none selected" without a
second request.

`resolved_assets()` is untouched by this feature.

## 8. CLI

### 8.1 Selection

The active harness is local state in `$HARNESS_HOME/harness.json`:

```json
{ "harness_id": "…", "name": "Support" }
```

It sits beside `assets.git`, outside the agent-writable `assets/` tree, so the
future jail (`build-plan.md` Phase 4) protects it for free, and so the agent
cannot change which harness its user is in. `name` is a courtesy for
`whoami`; the server's name is what sessions display. The alternative — a
per-user selection stored server-side — was considered and set aside: it adds
an endpoint and a table to answer a question the machine already knows, and
the existing loop (`login`, `pull`, `status`) is entirely local state plus a
stateless server. Revisit if people switch machines often.

### 8.2 Commands

```
harness switch                      pick from a numbered list (needs a terminal)
harness switch <name>               by name, case-insensitive
harness switch <unit-path>/<name>   when two visible harnesses share a name
harness switch --none               load everything you have
```

`switch` calls `/v1/me` then `GET /v1/org-units/{own}/harnesses`. An ambiguous
name lists the candidates in `<unit-path>/<name>` form and exits 1. Without a
terminal and without an argument it lists the names and exits 1 — the same
"never decide for them" rule as `push` on a `409`. On success it writes the
selection, then prints the icon (§6.1) beside the name, the owning unit, and
the description, and ends with `` `harness run` to start. ``

`harness run`:

1. Reads the selection. Calls `GET /v1/resolve?harness_id=…` (or plain
   `/v1/resolve`).
2. `404 harness_not_found` → deletes `harness.json`, prints *Your harness
   "Support" no longer exists, or is no longer shared with you. Run `harness
   switch` to pick another.*, exits 1. It does not fall back silently: the
   user asked for a specific working context and is not getting it.
3. Hydrates with the **full** manifest, unchanged.
4. Materializes only what the harness contains (§8.4). With no selection and
   `manifest.harnesses` non-empty, prints one line first: *3 harnesses are
   available to you; `harness switch` picks one. Loading everything you have.*
5. `POST /v1/sessions` with `harness_id`.
6. Writes `sessions/<id>/harness.json` when a harness is selected — §8.3.

`harness doctor` gains a section `harness`: the card, and how many names the
harness contains (`nothing yet` when empty). The `assets` section marks each
asset `not in this harness` when one is selected. `harness whoami` appends
`harness: Support` or `harness: none — everything you have is loaded`. `pull`,
`status`, `reset`, `adopt`, and `push` do not read the selection and do not
change: the work tree is the same in every harness.

`--help` and `man` gain the command and a HARNESSES section in the voice of
the existing text.

### 8.3 What the extension is given

`sessions/<id>/harness.json`, written by `run` beside `policy.json`:

```json
{ "id": "…", "name": "Support", "description": "…", "org_unit_path": "…", "lines": ["…"] }
```

`lines` are pre-rendered by the CLI with `colorMode()`. The CLI and Pi share a
terminal, so the parent's capability detection is the right one, and the
extension stays what it is: a reader of small JSON files with no rendering
logic and no new dependency.

### 8.4 Materialization

`materializeManifest` filters with `inHarness(asset, manifest.harness)` inside
`byKind`, so every kind the session lays out inherits the filter from one
line. Concretely: a skill the harness does not contain is not written, a
system prompt or memory it does not contain is not rendered into `AGENTS.md`,
a saved prompt it does not contain is not written, and `allowed_tools` is the
builtins plus `boundary.allowed_tools` plus only the tools the harness
contains. `manifest.json` is still written whole: a session records everything
it was offered, not only what it used. The signature does not change; the
harness is in the manifest.

## 9. The Pi extension

On `session_start`, after `loadPolicy`: read
`${HARNESS_SESSION_DIR}/harness.json`. If present and `ctx.mode === "tui"`,
call `ctx.ui.setHeader` with a factory returning a component whose lines are
the icon lines on the left and, on the right, the name in the accent colour,
the owning unit dimmed, and the description wrapped to the remaining width.
Eight lines tall; a description that needs more is cut with `…`. Composition
is a pure function in `core.ts`,
`headerLines(icon, name, unit, description, width): string[]`, so it is
unit-tested without a terminal.

A Pi `Component` is `render(width): string[]` and `invalidate()` plus optional
input handlers, so the factory returns `{ invalidate, render }` —
`headerLines` already has the shape `render` wants, and `invalidate` is a
no-op because nothing is cached. No `@earendil-works/pi-tui` import and no
second dependency. With no `harness.json`, the built-in header stays. A
malformed file is ignored — a header is decoration and must never stop a
session.

Nothing else in the extension changes. Tool gating still reads `policy.json`,
which already reflects the narrowed `allowed_tools`.

## 10. Amendment to `build-plan.md` Phase 2.1

Phase 2.1 says `settings.json.skills` is `[assetsRoot + "/skill"]` — the whole
directory. That would load every skill in the work tree regardless of harness.
Amend: `skills` lists `assetsRoot/skill/<name>` for the skills the harness
contains. Pi's `skills` setting accepts individual skill directories (a
directory containing `SKILL.md` is a skill root — `settings-manager.ts:133`,
`skills.ts:164`), so this is a list, not a copy. The same rule applies to the
prompts directory and to the tool index rendered into `AGENTS.md`. The
principle of 2.1 — point, do not copy — is untouched; only the pointer set is
per-harness.

## 11. Web console

- **Tabs.** `Tab` gains `"harness"`; `TABS` puts `{ id: "harness", label:
  "Harnesses" }` first and it is the default tab, with a divider after it.
  `groupOf("harness")` is `"harness"` and its path is
  `/v1/org-units/{unit}/harnesses`. `HELP` gains a `harness` entry — the type
  forces it.
- **Tiles** (`harness-tiles.tsx`). A grid, not a table. Each tile: the
  drawing, the name, the owning unit when inherited, the description clamped
  to two lines, and how many things it holds (`empty` when none). Own
  harnesses first. *New harness* opens a dialog — name, description, drawing
  — which says the harness starts empty. Search matches name and description.
  Listing inherited harnesses departs from the asset tabs, which list own
  assets only; that is deliberate, because "which harnesses can this team
  use" is the question the tab exists to answer.
- **Screen** (`harness-screen.tsx`). The drawing, name, unit, description,
  *Edit* and *Delete*. Then **one checkbox list** of everything that resolves
  at the harness's unit, grouped by kind, ticked where the harness contains
  it, with a count, *Add all*, and *Empty it*. A row assigned but with nothing
  answering its name is badged. Each change sends the whole list to
  `PUT /harnesses/{id}/assets`; contents are a set, so replacing it outright
  is one request with no ordering to get wrong.
- **Pixel editor** (`pixel-editor.tsx`). Exports `PixelArt` and `PixelEditor`.
  A 16×16 grid; click or drag to paint; sixteen swatches from the brand
  tokens; an eraser; *Clear*. The icon keeps only the colours it uses and a
  swatch is appended on first use, so one made through the API with its own
  palette still edits correctly.
- **Manage pane** (`asset-manage.tsx`). A *Harnesses* section: a checkbox per
  harness that reaches this asset's unit, and a line saying that no harness
  loads it yet when none is ticked.
- **Asset tables.** A *Harnesses* column: a count, or a `warn` badge `none`.
- **Types.** `Harness`, `PixelIcon`, `HarnessAssetRow`, `HarnessDetail`;
  `Asset` gains `harness_ids`.

## 12. What v1 deliberately does not do

- Per-harness boundaries or connectors. Shared, by design.
- Per-harness models. One model per resolved set; a second model is a second
  connection name, which is a different feature.
- Switching inside a running session (`/harness`). Switch, then `run`.
- Versioning, promotion, or rollback of harnesses. `updated_at` and the audit
  trail record changes; history can come later without a schema change.
- Name shadowing between levels (§4).
- Server-side selection (§8.1).
- `harness push --harness <name>`. A pushed asset is in whatever harnesses
  already named it; anything else is done in the console.
- Copying a harness, or harness templates. Worth having once people have
  several; nothing here blocks it.
- Icon sizes other than 16×16, or palette colours outside the fixed sixteen.

## 13. Build tasks

**Historical.** This is the plan as written before the build, and it describes
the earlier "in every harness by default" model that §0–§12 no longer
describe: an `assets.harness_scope` column, assignment by asset id, and the
cross-unit rule that went with it. §14 records what was actually built and
why the model changed. Kept because the order of work and the test list held
up; read §0–§12 for the design.

Rules are those of `build-plan.md`: do not commit; least code that meets the
acceptance; acceptance is literal; fail closed. Backend tests
`cd backend && .venv/bin/uv run pytest -q`; CLI `cd pi && npm test
--workspace=@harness/cli`; extension `--workspace=@harness/pi-harness`; web
`cd web && npm run build && npx eslint app lib`.

Order: **H1 → H2 → H3 → H4 ∥ H5 → H6.** Functionality first: the data model,
resolution, and the TUI render land before any editor UI. Nothing in H1–H3
depends on the console.

### H1 — Schema, domain, resolution — §5, §6, §7.1

**Files.** new `backend/supabase/migrations/0017_harnesses.sql`; new
`backend/app/domain/harnesses.py`; `backend/app/domain/resolve.py`;
`backend/app/api/routes_resolve.py`; `backend/app/api/routes_sessions.py`;
`backend/tests/test_resolve.py`; new `backend/tests/test_harnesses.py`.

**Signatures.**
```python
# app/domain/harnesses.py
class Icon(BaseModel): ...                      # §6 validation; extra="forbid"
def in_harness(asset: dict, harness_id: UUID | None) -> bool
async def visible_harnesses(conn, org_unit_id) -> list[dict]           # own + ancestors, with org_unit_path
async def visible_harness(conn, org_unit_id, harness_id) -> dict       # 404 harness_not_found
async def harness_covers_unit(conn, harness: dict, org_unit_id) -> bool  # invariant 3
```

**Behaviour.** As §5–§7.1. `resolve()` accepts `harness_id: UUID | None`
as a query parameter, validates it with `visible_harness`, and emits manifest
version 4. `SessionCreate` gains `harness_id: UUID | None = None`, validated
the same way, stored on the row.

**Acceptance.**
- `test_harnesses.py`: a valid icon passes, and each way of describing a
  drawing that could not be rendered is refused — 17 palette entries, an
  upper-case hex, a colour without its hash, 15 rows, a short row, a long
  row, an index past the end of the palette, an index with no palette at
  all, a non-hex character, and an unknown field. The membership truth table
  lives with the code that uses it, in H3.
- `test_resolve.py`: FakeConnection rows carrying `harness_scope` and
  `harness_ids` come through on each result unchanged; a row without a
  `harness_ids` key is not tolerated (the query must supply it).
- `test_api_shapes.py`: `/v1/resolve` still present; sessions unchanged.
- Manual, against the live database in a rolled-back transaction: the
  candidate query with the two new columns runs and returns `{}` for an
  unpinned asset.

**Out of scope.** Any route in H2; the CLI.

### H2 — Harness API and asset scope — §4, §7

**Files.** new `backend/app/api/routes_harnesses.py`;
`backend/app/api/routes_assets.py` (list/get shape, `PUT …/harnesses`,
promote invariant 6); `backend/app/main.py`; `backend/tests/test_api_shapes.py`;
`backend/tests/test_harnesses.py`.

**Behaviour.** The §7 table, with the §4 invariants and the audit actions
named there. `PUT /assets/{id}/harnesses` runs in one transaction: verify
every id with `harness_covers_unit`, `delete` then `insert`, `update
assets set harness_scope`. Promotion: when the target asset is *created*,
copy `harness_scope` and the subset of `asset_harnesses` whose harness covers
the target unit; the promote response carries the resulting `harness_scope`
and `harness_ids` so the console can say when the list is empty (§4
invariant 6).

**Acceptance.**
- `test_api_shapes.py` expects `/v1/harnesses`, `/v1/harnesses/{harness_id}`,
  `/v1/org-units/{org_unit_id}/harnesses`, `/v1/assets/{asset_id}/harnesses`.
- `test_harnesses.py`: the pure part of the scope update — the pin subset kept
  by promotion given a fake chain; the `422 harness_out_of_scope` message
  names the harness.
- Manual, live stack via curl: create a team harness; pin a team skill to it;
  `GET /v1/harnesses/{id}` lists the skill `assigned` and `model-default`
  `shared`; pin a team asset to a *user's* harness → `422`; delete the
  harness → `204`, the skill now has `harness_scope: selected` and
  `harness_ids: []`, and the audit event lists its id.

**Out of scope.** The console; any CLI change.

### H3 — CLI: renderer, selection, `switch`, `run`, `doctor` — §6.1, §8

**Files.** new `pi/packages/harness-cli/src/pixels.ts`; new `src/harness.ts`
(selection read/write, `switchHarness`); `src/style.ts` (`colorMode`);
`src/core.ts` (`Manifest` type, `in_harness`, materialize filter);
`src/index.ts` (`run`, `whoami`, dispatcher); `src/doctor.ts`; `src/help.ts`;
new `test/pixels.test.ts`; new `test/switch.test.ts`; `test/core.test.ts`.

**Signatures.**
```ts
// pixels.ts
export interface Icon { w: number; h: number; palette: string[]; rows: string[] }
export function renderIcon(icon: Icon, mode: ColorMode): string[];
// harness.ts
export interface Selection { harness_id: string; name: string }
export function selectionPath(): string;                       // harnessHome()/harness.json
export async function readSelection(): Promise<Selection | undefined>;
export async function writeSelection(s: Selection | undefined): Promise<void>;  // undefined removes
export async function switchHarness(args: string[]): Promise<number>;
// core.ts
export function inHarness(asset: ManifestAsset, harnessId: string | null): boolean;
```

**Behaviour.** As §6.1 and §8. `run` must hydrate before it filters, and must
delete the selection on `404 harness_not_found` before it throws.

**Acceptance.**
- `pixels.test.ts`: a 16×16 icon renders 8 lines of 16 cells (visible width
  after stripping escapes); a fully transparent icon is 8 lines of spaces;
  `truecolor` lines contain `38;2;`; `256` lines contain `38;5;` and no
  `38;2;`; `mono` lines contain no escape at all; a cell with top and bottom
  the same colour is `█`; every coloured line ends in `\x1b[0m`.
- `core.test.ts`: a manifest with `harness: {id: "h1"}` and three assets —
  skill `all`, skill `selected [h1]`, skill `selected [h2]` — writes the first
  two skill directories and not the third; a tool `selected [h2]` is absent
  from `allowed_tools` while a tool `all` is present; a memory `selected [h2]`
  is absent from `AGENTS.md`. With `harness: null`, `selected [h1]` assets
  are **not** written and `all` assets are.
- `switch.test.ts` (mocked `api`, temp `HARNESS_HOME`): `switch support`
  writes the selection with the matching id; two visible "Support" harnesses →
  exit 1 and both `<unit-path>/<name>` forms printed; `switch
  acme.support/Support` resolves the ambiguity; `switch --none` removes the
  file; no argument and no TTY → exit 1 listing names; output after a
  successful switch contains the name and 8 icon lines.
- `run` path: with a selection whose resolve returns `404 harness_not_found`,
  the selection file is gone and the error names the harness (mocked `api`,
  as in `push.test.ts`).
- Existing tests unchanged and green; `hydrate.test.ts` in particular, which
  proves the work tree ignores the harness.

**Out of scope.** The extension header (H4); any `/harness` slash command.

### H4 — Extension header — §9  ∥ H5

**Files.** `pi/packages/harness/src/index.ts`; `src/core.ts` (`headerLines`);
`test/header.test.ts`. No change to `package.json`.

**Acceptance.** `headerLines` with 8 icon lines, a name, a unit, and a long
description at width 80 returns exactly 8 lines, each beginning with the icon
line, the first carrying the name, the second the unit, and the last ending in
`…` when the description overflows; at width 30 the description is wrapped
narrower and still 8 lines. `index.ts` reads the file only when
`ctx.mode === "tui"` and never throws on a malformed one (test with a bad
file: `notify` is not called with an error, `setHeader` is not called).
`grep -c fetch src/index.ts` is still `0`; `grep -c pi-tui src/index.ts` is
`0`; `dependencies` in `package.json` still has one entry.

### H5 — Web console — §11  ∥ H4

**Files.** `web/lib/types.ts`; `web/app/help.ts`; `web/app/admin.tsx`; new
`web/app/harness-tiles.tsx`, `web/app/harness-screen.tsx`,
`web/app/pixel-editor.tsx`; `web/app/asset-manage.tsx`.

**Acceptance.** `npm run build` and `npx eslint app lib` clean. Manually on the
live stack: Harnesses is the first tab and the default; a new harness drawn in
the editor appears as a tile with the drawing; opening it lists
`model-default` as `shared`; pinning a skill from the Manage pane shows it as
`assigned`; the delete confirmation states the `only here` count; the asset
table shows the Harnesses column; `harness switch` in a terminal then shows
the same drawing.

### H6 — Docs

**Files.** `docs/build-plan.md` (the §10 amendment to 2.1, as a dated note);
`docs/build-decisions.md` (one dated entry recording resolve-then-filter, no
name shadowing, local selection, and 204-with-audit on delete — the four
decisions someone will otherwise re-litigate). The README lists services, not
commands, so it does not change; `help.ts` in H3 is the command text.

## 14. Built — 2026-09-18

Backend 53 tests, CLI 57, extension 10, all green. `web` builds and lints
clean. **Migration 0017 is applied to the development database.**

### The model was inverted mid-build

It shipped first as "in every harness unless narrowed", with an
`assets.harness_scope` column defaulting to `all`. That was wrong, and the
correction is §0–§12: **a harness holds only what is put in it.** A default
that fills a harness means nobody can tell what a harness is *for* by looking
at it, and every new asset silently joins every job.

Inverting the default forced a second change, which is the more interesting
one. With harnesses empty by default, assignment **by asset id** breaks the
product's core loop: the team puts its `house-style` prompt in Support, a user
pushes their own copy to extend it, resolution hands them theirs, theirs has
no assignment, and Support silently loses the prompt altogether. Assignment is
therefore by `(kind, name)` — the harness names the thing, the tree picks the
version. Verified live: with a personal override of an assigned name, `doctor`
showed the override in the harness and the session laid out the user's own
text.

That change **deleted** more than it added: the `harness_scope` column, the
rule that an asset could only go in a harness at or above its own unit, the
promotion logic that copied assignments and the notice for when it could not,
the per-asset harness fields on every resolved asset in the manifest, and the
`only_here` bookkeeping that existed to warn about assets being switched off —
which can no longer happen, because deleting a harness now only deletes
assignments. The console's harness screen collapsed from two lists into one
checkbox list, and the asset Manage pane from a two-mode radio into a plain
checkbox list.

### Verified against the live stack

Re-run in full after the inversion.

**Empty by default.** A newly created harness reported no contents and
offered the names resolvable at its unit. `409 harness_name_taken` on a
duplicate name, and a 422 naming the offending row for a 1-row drawing.

**Contents.** `PUT /harnesses/{id}/assets` set two names; the detail endpoint
came back with them ticked. One of them resolved to nothing at the harness's
own unit and was reported as such — honest rather than hidden — while still
loading for the user who does have it.

**The override case, which is the reason for the name-based design.** A
personal `prompt/house-style` was created under a team harness that named
`house-style`. `doctor` showed the user's own copy *in* the harness, and the
materialised session contained the user's text. The two names the harness did
not hold were marked `not in this harness` and were absent from the session.

**The three session shapes.** In the harness: only its contents, and only its
tools in `allowed_tools`. With `--none`: everything the user resolves, which
is how sessions behaved before harnesses. In an empty harness: no skills, no
prompts, an empty instruction file, and builtin tools only.

**Both assignment directions agree.** `PUT /assets/{id}/harnesses` added and
removed a name, and the harness detail and the asset row matched after each.
A harness id the caller cannot see is a `404`.

**Delete.** 204, and the four assets that harness had named were untouched:
still active, still resolving, simply in no harness.

`harness switch` drew the icon, wrote the selection, refused an ambiguous
name, and listed the alternatives for a name that was not there. Colour fell
back to mono on a pipe, keeping the shape. A selection whose harness had been
deleted was cleared on the next command with an explanation.

Test data and the temporary access token were removed afterwards; the
database's four pre-existing assets are untouched.

### A bug this found

`PUT /harnesses/{id}/assets` first caught the foreign-key violation from an
unknown kind and then queried `asset_kinds` to list the valid ones — inside
the same transaction, which Postgres had already aborted. The result was a
500 instead of a 422. Kinds are now checked before anything is written, which
is the pattern `create_asset` already used. Confirmed live: an unknown kind
is a `422 unknown_asset_kind` naming the known kinds, and the harness is left
exactly as it was.

### Not exercised

Three things are built and type-checked but were not run:

1. **The console was never opened in a browser.** `npm run build` and
   `eslint` pass, which catches types and imports, not React at runtime. The
   click-through is: open Harnesses (it is the first tab and the default),
   create one, draw on the grid, open the tile, assign an asset from the
   unit, then check the Harnesses column on an asset tab and the Harnesses
   section of its Manage pane.
2. **`harness run` and `POST /v1/sessions` with a `harness_id`.** The
   development database has no `connection/model-default`, so `run` cannot
   start. Materialisation — everything `run` does with the manifest — was
   verified directly from the live manifest instead, but the session row was
   not.
3. **The header inside Pi.** `headerLines` is unit-tested and the extension
   reads the file only in TUI mode, but no Pi session has drawn it, for the
   same missing-model reason.

### Deviations

Each of these is less code than the plan called for, and the plan was wrong
rather than the code. The first two now follow from the inversion above.

1. **No membership predicate on the server.** Planned for both sides. The
   server never filters a session, and the harness screen answers membership
   in SQL, so the predicate exists once, in `core.ts`, where materialization
   needs it.
2. **No cross-unit assignment rule, and no helper for it.** With names rather
   than rows there is nothing to constrain: naming something grants nothing,
   because resolution is unchanged. `harness_covers_unit` was written, used
   twice, then deleted along with the rule.
3. **Icon validation is pydantic-native, so the code is `invalid_request`,
   not `invalid_icon`.** The app's existing handler already returns 422 with
   the failing field and a plain-language reason ("Row 3 has 15 pixels; every
   row needs 16."). A custom code would have required hand-rolling validation
   outside the model for no gain to the reader.
4. **The icon has no `w`/`h`.** They were stored but had to equal 16, so they
   described nothing the rows did not. `renderIcon` and `PixelArt` read the
   row count and row length, which is equally general.
5. **No `inherited` flag on a harness row.** The client has the unit it asked
   about and the row's `org_unit_id`, so it derives it.
6. **The editor's palette grows instead of being fixed.** Planned as a fixed
   16 stored whole. Instead the icon keeps only the colours it uses and a
   swatch is appended on first use, which also means a harness created through
   the API with its own palette still edits correctly. Same code, no
   normalisation step.
7. **Promotion needs no harness logic at all.** It briefly carried
   assignments and reported a copy that arrived in none. Both were deleted
   when assignment moved to names: the copy has the same name, so it is
   already wherever the original was.
8. **`resolveForSession` is shared, and lives in `harness.ts`.** `doctor` and
   `resolve --json` originally called `/v1/resolve` bare, so both reported "no
   harness selected" while one was — found by running `doctor` against the
   live stack. All three commands now resolve through one function, which is
   also the only place the stale-selection 404 is handled.
9. **The header component needs `invalidate()`.** Pi's `Component` requires
   it alongside `render`. It is a no-op: nothing is cached. Still no
   `@earendil-works/pi-tui` import and still one dependency.
10. **`api()` now carries the error `code`.** Two lines, so the stale-harness
   path keys on `harness_not_found` rather than on a bare 404, which
   `/v1/resolve` also returns for a missing workspace.

### Still true of the environment

`system_prompt` is not in this database's `asset_kinds`: migration
`0016_system_prompt_kind.sql` is staged but has never been applied, so the
kind that the console's first tab is named for does not exist here and
`prompt/house-style` still carries the old kind. Nothing in this feature
depends on it — harnesses take any kind in the table — but the harness screen
will not offer system prompts on this machine until 0016 is applied. That is
pre-existing and was left alone.
