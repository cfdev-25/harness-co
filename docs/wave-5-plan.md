# Wave 5 — reach, simplification, lifecycle, launch, store

*Plan written 30 Sep 2026 from the discussion of that day. Each workstream
names its decisions (W5-D*n*), the contracts it changes, the files it lands
in, and the rows that prove it. Builders record their own decisions into the
engine and console docs the way earlier waves did (`docs/build-log.md`,
`docs/build-decisions.md`); this file is the plan, not the record.*

Standing rules for every workstream: no line of code that does not earn its
keep; test what you build; look at the UI you build; never `git commit` — stage
and report. Backend suite must stay green (`backend/.venv/bin/python -m pytest`),
so must compose, definitions, CLI, the Pi extension, and the web suites
(`npm test` at the root and in `web/`).

## Why this wave

Three days of the endpoint log say the fence held: every search engine,
package registry and source host the agent tried was refused, and the only
host reached was the model provider's. Yet fresh web content still arrived,
because a model request can ask the provider to browse on its own servers.
Reach is therefore two policies, not one: which hosts the machine may reach,
and what a model request may ask the provider to do. Today the first is a
binary grant nobody can find and the second is a terminal notice nobody can
read later.

The rest of the wave is what a person meets in order: a sidebar that only
shows what they manage, one place to pick a level, harnesses and assets that
read the same at every level, a session whose start and end look like ours,
a card that opens a terminal, and a store to build from.

## Order and ownership

| Phase | Workstream | Model | Touches |
| --- | --- | --- | --- |
| 1 | WS1 reach policy, request-shape policy, endpoint reasons (engine + backend) | opus | compose contracts, definitions indexer, CLI proxy + preflight, backend writes + console + tests, docs 01/05/00 |
| 2 | WS1w reach in the console: Boundaries → Reach, Endpoints attempts with Allow | opus | web boundaries + logs/endpoints, after WS2's tab frame |
| 1 | WS2 console by role: sidebar, Logs tabs, harness page "applies here", header tree + level chip | opus | web shell + logs + harness page, backend nav facts, console docs |
| 1 | WS3a asset row edit and delete (API) | sonnet | backend writes + tests, openapi |
| 2 | WS3b Harnesses and Assets pages at every level | opus | web harnesses + assets pages, backend console listings |
| 2 | WS4 session lifecycle: boot screen, exit review, system prompt delivery, required vs recommended | opus | CLI run/review/adapters, Pi extension, compose, backend seed + console labels, docs 07/08 |
| 2 | WS5a `harness://` scheme, `harness open`, installer registration, workspace in the session record | opus | CLI setup + new command, backend sessions, docs guide |
| 3 | WS5b launch buttons and breadcrumb on cards | opus | web harnesses page |
| 3 | WS6 store: browse, multi-select, add to harness | opus | web assets page, backend console + writes, compose |

Phase 1 workstreams are disjoint in files. Phase 2 starts when phase 1 is
staged and green. WS3b owns `web/app/(console)/console/[scope]/{harnesses,assets}`
in phase 2; WS5b and WS6 build on it in phase 3. WS1w owns
`boundaries/` and `logs/endpoints/` in phase 2.

## Ground rules for builders

- Work in place, in this tree. Never `EnterWorktree`, never `git stash`,
  `checkout`, `reset` or `commit`. The tree holds hundreds of staged,
  uncommitted files that are the product. At the end, `git add` the files
  you changed and stop.
- Never run `npm run dev`: it reclaims the ports the person is using. The
  backend reloads by itself; the web dev server recompiles by itself.
- Do not regenerate `web/openapi.json` or `web/lib/api.generated.ts`; the
  coordinator regenerates once after every workstream that changed the API
  is staged. Write the TypeScript types you need by hand in `lib/views/`
  meanwhile, and say so in your report.
- A file another workstream also touches is edited with `Edit`, never
  rewritten with `Write`, and re-read first.
- The web suites start a test stack on fixed ports (8411/8412/3011). Only
  one agent runs them at a time; the coordinator says who.
- Suites at dispatch: backend 296 · compose 71 · definitions 39 · CLI 258 ·
  Pi extension 12 · web unit 147 · web component 50. Report each before and
  after; a count that went down needs a sentence.
- Done includes the docs rows in the plan docs the change belongs to and one
  ledger row in `docs/build-log.md` under a *Wave 5* heading (create it the
  first time, after Wave 4's agents section).
- Report: what changed, the counts, what is staged, what you could not
  finish and exactly why.

---

## WS1 — Reach

### Decisions

**W5-D1 Reach is a policy file.** `policy/reach.json` on the org node and on
team nodes (01 §4.2 already ignores `policy/` on user branches). Shape:

```json
{ "mode": "off" | "allow" | "on", "hosts": ["pypi.org", "*.githubusercontent.com"] }
```

For `allow`, `hosts` is the allow-list. For `on`, `hosts` is the deny-list.
For `off`, `hosts` is ignored. A harness definition may carry `reach` of the
same shape. Absent everywhere means `off`.

**W5-D1a Narrowing only.** Composition walks org → team → sub-team → harness.
Each step may keep the parent's mode, or move `on` → `allow` → `off`, add
hosts to a deny-list, or remove hosts from an allow-list. A step that widens
(`off` → anything, `allow` → `on`, a new allow-list host the parent lacks, a
deny-list host removed) is a `Conflict` of kind `reach-widened` naming the
node, and the parent stands. `EffectivePolicy.reach` is
`{ mode, hosts, setBy: string }` where `setBy` is the path of the last node
that narrowed (or the harness id, prefixed `harness:`).

**W5-D1c Personal accounts start with the suggested allow-list.** The
personal seed writes `policy/reach.json` with mode `allow` and the suggested
list, so a hobby user's first `pip install` works and the Boundaries screen
shows what is allowed. The enterprise seed writes `off`; an org admin turns
it on from the same screen.

**W5-D1b The reach grant is retired.** `Grant.reach: "outside-endpoints"`
composes to a `Conflict` of kind `reach-grant-retired` and is otherwise
ignored. `choices.outsideEndpoints` goes away; everything that read it reads
`plan.reach.mode === "on"`. The seed writes no reach grants. Record the
retirement in 01 and 05.

**W5-D2 The tunnel decides by rule, and says which.** `SpawnPlan.hosts` stays
the credentialed hosts plus the model endpoint host. `SpawnPlan.reach` is the
effective reach. One function, `routable(plan, host, port)`, returns
`{ ok: true }` or `{ ok: false, reason }` with reason one of `port`,
`reach.off`, `reach.not-listed`, `reach.denied`. A host in `plan.hosts` is
always routable on 443. Host matching: exact, or `*.` prefix matching any
subdomain. `EndpointEvent` gains `reason?: string` and `setBy?: string`; the
tally (`EndpointTally`) gains `stripped: number` and `reasons: Record<string, number>`.

**W5-D3 A model request is shaped, not just routed.** When `reach.mode` is not
`on`, inject strips every capability that makes the provider browse or
execute on its side, for every wire format the proxy speaks:

| Wire format | Stripped |
| --- | --- |
| anthropic-messages | tools of type `web_search_*`, `web_fetch_*`, `code_execution_*`; top-level `mcp_servers`; top-level `container` |
| openai-completions / responses | tools of type `web_search`, `web_search_preview`, `mcp`, `code_interpreter`; `web_search_options` |
| openrouter (openai shape) | model suffix `:online`; `plugins[]` entries with `id: "web"` |

`allow` strips too: provider-side browsing cannot be held to a list, so only
`on` permits it. Each strip is logged as an `EndpointEvent` with
`mode: "inject"`, the model host, `status: "stripped"`, and
`reason: "stripped:<comma-separated names>"`. The terminal notice stays.

**W5-D4 Every refusal is explained and actionable.** The console's Endpoints
tab (under Logs, WS2 owns the tab frame; WS1 owns its content) lists
attempts: one row per (host, outcome, reason), with counts, first and last,
the sessions, `setBy`, and for a refused row an **Allow** action for a
viewer who administers the node in `setBy` (org admin for the org, team
admin for that team). Allow adds the host to that node's allow-list (mode
`allow`) or removes it from the deny-list (mode `on`); with mode `off` the
action is disabled with the sentence *Reach is off for {node}; turn it on
under Boundaries → Reach.*

**W5-D5 Reach is set on the Boundaries screen.** Boundaries gains a *Reach*
section for the scope: mode as three radio choices with one sentence each,
the host list with add and remove, the inherited setting above it, and the
suggested starter list (`engine/compose/presets/reach-suggested.json`:
package registries, source hosts, and the harness providers' own update
hosts, e.g. `pypi.org`, `files.pythonhosted.org`, `registry.npmjs.org`,
`github.com`, `api.github.com`, `objects.githubusercontent.com`,
`codeload.github.com`, `crates.io`, `static.crates.io`, `proxy.golang.org`,
`rubygems.org`, `downloads.claude.ai`) shown as one-click adds when the mode
is `allow`.

### Contracts

- `engine/compose/src/contracts.ts`: `Reach`, `EffectiveReach`,
  `EffectivePolicy.reach`, `HarnessDef.reach?`, `SpawnPlan.reach`,
  `EndpointEvent.reason/setBy`, `EndpointTally.stripped/reasons`,
  `Conflict` kinds `reach-widened`, `reach-grant-retired`; remove
  `Choices.outsideEndpoints` and `Grant.reach`.
- `engine/definitions/src/indexer.ts`: read `reach.json` into `idx_policy`
  like the others; `backend/app/domain/console_index.py` `_ORG_FILES` gains
  it (note it is per node, like boundaries, not org-only).
- API: `GET /v1/console/reach?scope=` → `{ effective, chain: [{ node, mode, hosts }], suggested }`;
  `PUT /v1/reach?scope=` `{ mode, hosts }`; `POST /v1/reach/hosts?scope=` `{ host }`;
  `DELETE /v1/reach/hosts/{host}?scope=`. Admin of the scope's node. Sentences
  `reach.set`, `reach.allow_host`, `reach.deny_host`. OpenAPI regenerated
  (`web/openapi.json`, `web/lib/api.generated.ts`).
- `POST /v1/sessions/{id}/endpoints` accepts the new fields; `session.endpoint`
  audit payload carries `reason` and `setBy`; `endpoint_rows` groups by them.

### Files

CLI: `proxy/tunnel.ts`, `proxy/inject.ts` (`stripBrowsingTools` becomes
`shapeModelRequest(wireFormat, body, reach)`), `preflight/preflight.ts`
(plan), `preflight/choose.ts`, `adapters/layout.ts` (`denyPatterns` and the
brief's reach sentence), `adapters/claude/launch.ts` (WebSearch/WebFetch deny
keyed on reach). Compose: `compose.ts` reach walk + tests + fixtures
(`reach-narrows`, `reach-widened-conflict`, `reach-grant-retired`). Backend:
`routes_writes.py`, `routes_console.py`, `console.py` (`reach_view`,
`endpoint_rows`), `sentences.py`, tests beside the existing boundary tests.
Web (WS1w, phase 2): `boundaries/_reach.tsx` (+ writes proved at the
network like `test/components/*-writes.spec.tsx`), `logs/endpoints` content
with the Allow action, `content/screens/{boundaries,logs}.ts` strings.

Retiring the reach grant reaches 36 files; budget for it. Engine:
`compose/src/{policy,contracts}.ts`, `compose/test/compose.test.ts`, the
three `narrowed-grant-*` fixtures, `definitions/test/service.test.ts`,
`cli/src/{proxy/inject,proxy/tunnel,adapters/claude/render,preflight/report,preflight/enforcers/network,preflight/choose}.ts`,
`cli/test/{boot,adapters/render,adapters/fixture,preflight/support,preflight/choose,preflight/enforcers}.test.ts`.
Backend: `routes_writes.py`, `console.py`, `console_models.py`. Web:
`lib/views/{session,groups,harness}.ts` and their tests, `groups/{_table,page}.tsx`,
`sessions/[id]/_report.tsx`. Docs: engine 00, 01, 02, 03, 05, 08.

### Proof

- Compose: org `on` + team `allow [pypi]` → `allow [pypi]` set by team; team
  `on` under org `allow` → conflict, org stands; harness `off` under anything
  → `off` set by `harness:<id>`.
- Tunnel: `pypi.org` under `allow [pypi.org]` → ok; `files.pythonhosted.org`
  → refused `reach.not-listed`; under `on ["*.example.com"]`, `a.example.com`
  → refused `reach.denied`; model host always ok.
- Inject: an anthropic-messages body with `web_search_20250305`, `mcp_servers`
  and `container` under `allow` → all three gone, one `stripped` event naming
  them; under `on` → untouched. Same for the openai shape and `:online`.
- Live: `harness run pi --test-harness-1` with the org at `allow [pypi.org, files.pythonhosted.org]`
  installs a package; the console's Endpoints tab shows the attempts with
  reasons; clicking **Allow** on a refused `registry.npmjs.org` row writes the
  host and the next run reaches it.
- Docs: 05 §6a rewritten around W5-D2/W5-D3; 01 §4.2 row for `reach.json`; 00
  §4 contracts; console 04 Boundaries → Reach and Logs → Endpoints.

---

## WS2 — The console by role

### Decisions

**W5-D6 The sidebar shows what you manage.** `navFor(scope, viewer)`:

| Scope | Everyone on it | Only if `adminHere` |
| --- | --- | --- |
| me | Harnesses, Assets, Logs, Account | — |
| team | Harnesses, Assets, Logs, People | Security groups, Boundaries, Providers, Teams |
| org | Harnesses, Assets, Logs, People | Security groups, Boundaries, Providers, Key vaults, Teams |

`Viewer` gains `adminHere: boolean` for the scope (the backend has
`ctx.admin_here`; expose it on `/v1/console/me`). Trap: `loadViewer()` in
`web/lib/views/viewer.ts` calls `/v1/console/me` with no `scope`, so
`adminHere` would be computed for *me* and always be true. Pass the scope
(`loadViewer(scope)`; React's `cache()` keys on arguments), from the layout
and from every page that calls it. Sessions and Endpoints
leave the sidebar. Personal edition: Harnesses, Assets, Logs, Account, and
Boundaries (the person is their own org admin; reach lives there).

**W5-D6a Logs is one page with tabs.** Tabs: **Changes** (today's `harness`
category, retitled: pushes and pulls on branches you can see), **Sessions**
(today's Sessions page, unchanged content), **Endpoints** (WS1's attempts),
and for `adminHere` the existing **Permissions**, **Providers**, **People**.
Routes: `/logs/changes`, `/logs/sessions`, `/logs/endpoints`, …;
`/sessions` and `/sessions/[id]` redirect to `/logs/sessions[/id]`;
`/logs/harness` redirects to `/logs/changes`. `web/lib/views/logs.ts`
`tabs()` is the one list.

**W5-D7 A harness page shows what applies to it.** A section *Applies here*
on the harness page: the reach mode and who set it, the boundaries covering
the harness, and the security groups whose grants cover it, each a link to
the screen for admins and plain text for members. `harness_view` already
computes covering grants and boundaries; add `reach`.

**W5-D8 One selector, and every page says where you are.** The header's
scope switcher becomes a tree: *You*, then each team with its sub-teams
indented, then *Organization*, in that order, current level marked. Every
screen's `PageHeader` shows a chip under the title: `{Level} · you can edit
here` when `adminHere` (and always at *me*), otherwise `{Level} · read and
use`. No page carries its own level toggle.

### Files

`web/app/(console)/shell/{nav.ts,scope-switcher.tsx,header.tsx}`,
`web/app/(console)/console/[scope]/logs/**`, `sessions/**` (redirects),
`harnesses/[id]/_applies.tsx`, `ui/page-header.tsx` (chip), `lib/views/{types,logs,viewer}.ts`,
`content/screens/{logs,harnesses}.ts`; backend `routes_console.read_viewer`
(`adminHere`), `console.harness_view` (`applies`), `console_models.py`;
tests: `web/test/unit/nav.test.ts` (one case per row of the W5-D6 table),
component tests for the switcher tree and the chip, backend test for
`adminHere` at each scope. Console docs 01 §4.4 (nav), 04 §14 (Logs), 04 §5
(harness page).

### Proof

Sign in as the dev org admin: at *You* the sidebar is four items; at
*Organization* it is the full set; the Logs page has the tabs; the old
`/console/me/sessions` lands on `/console/me/logs/sessions`. Screenshots in
the job tmp directory, looked at.

---

## WS3 — Harnesses and Assets at every level

### WS3a Asset edit and delete (API first)

- `DELETE /v1/assets/{asset_id}?scope=`: admin over the node that holds the
  copy (org admin for the org node, team admin for a team node, the person
  for their own); removes `assets/<kind>/<name>` from that node's branch
  through `POST /internal/commit` with `{ path, delete: true }`; drops the id
  from `policy/always-loaded.json` if listed (both lists after WS4's split);
  refuses `asset.required` when the id is in `required`; sentence
  `asset.delete`. If a harness on that node lists the id, the id is removed
  from that harness definition in the same commit (one message: *remove
  {kind}/{name}*).
- `PATCH /v1/assets/{asset_id}?scope=` with `{ description?: string, name?: string }`:
  description lives in the sidecar (`asset.json` gains `description`, shown
  on rows); a rename moves the directory and rewrites every harness
  definition on that node that lists the id (the id does not change);
  sentence `asset.edit`.
- Tests beside `test_always_loaded_is_the_org_nodes_assets_only` in
  `backend/tests/test_writes.py`, one per rule above, using `world()` and
  `fake_definitions`. OpenAPI regenerated.

### WS3b The pages

**W5-D9 Assets is one screen at every level.** Renamed *Assets*. At *me* it
lists the person's own copies; at a team, the team's; at the org, the
org's. Tabs across the top by kind (`policy.kinds` order; a kind with no
rows still has a tab, greyed). Rows: name, description, loads
(required/recommended/on request after WS4; today `always`/`on request`),
used by (harness links), last change. Row actions for a viewer who
administers the level: **Edit** (name, description) in a drawer, **Delete**
behind a confirming modal that names the harnesses it will leave. The org
asset `always` toggle stays where it is.

**Harnesses.** Cards at every level, no team grouping at the org level
beyond what exists; each card gains *also at* links for the other copies of
the same id (`HarnessCard.alsoAt: [{ level, name, href }]`), and the harness
page keeps its versions view. **New harness** creates at the current level
when `adminHere`, otherwise the button reads *New harness in yours* and lands
on the person's branch. Search stays.

Files: `harnesses/page.tsx`, `harnesses/_new-harness.tsx`, `assets/page.tsx`,
`assets/_table.tsx`, `assets/_tabs.tsx`, `assets/_edit.tsx`, `assets/_delete.tsx`,
`content/screens/assets.ts` (verbs `edit`, `delete`), `lib/views/{assets,harness}.ts`;
backend `console.asset_rows` (scope-aware), `cards` (`alsoAt`), models;
tests: component write tests for edit and delete at the network, backend
tests for the scoped listing and `alsoAt`.

---

## WS4 — The session's own lifecycle

### Decisions

**W5-D10 Required and recommended.** `policy/always-loaded.json` becomes
`{ "required": string[], "recommended": string[] }`; a bare array reads as
`required` (the indexer normalises). `EffectivePolicy.alwaysLoaded` becomes
`required` and `recommended`. Required assets are in every session's load
set and cannot be removed from any harness or deleted (WS3a refuses).
Recommended assets are copied into a new harness's `assets` at creation
(`harness new` and `POST /v1/harnesses`), after which they are ordinary
entries. `harness-authoring` is required; the default brief (W5-D11) is
recommended. Console file rows read `skill · required` / `· recommended`.

**W5-D11 Our brief is the system prompt.** Supersedes D91. Claude: render
writes `<agentDir>/system-prompt.md` and launch passes
`--append-system-prompt-file <that path>` (2.1.283 lists it; first step is
to prove it takes effect in an interactive session, not only `-p`, by asking
the model what it was told — if it does not, keep the CLAUDE.md section and
record why); `rendered.json` records the file's
hash and drift compares the file to the record (the objection to D91 was
that argv is not on disk; the file is). Pi: the harness extension handles
`before_agent_start` and returns `systemPrompt` as the runtime's prompt
followed by the content of `<agentDir>/system-prompt.md` when present. The
brief is the ordered `system_prompt` assets; `AGENTS.md`/`CLAUDE.md` keep
everything else. A default brief ships as a preset asset
`system_prompt/harness` (short: the seam, the kinds, *say what you made*),
listed as recommended by the seed. 07 §6 rows updated.

**W5-D12 The session has a face.** A `screens.ts` module in the CLI renders
two frames with one visual language: the **boot screen** after preflight
and before the provider spawns, and the **exit review**. Boot screen: the
harness icon (pixel rows as half-block cells, two per row, palette colours),
name and level (*your version of Marketing's Support*), one line of
delivered counts by kind, the model (provider · model), reach (*off* /
*allow-list, 6 hosts* / *on*), the workspace, then *Starting Claude Code…*.
Exit review: the same frame, the changed / made / removed table with the
`+n −m` counts, then the one prompt. Non-TTY prints the same facts as plain
lines. Fixtures in `engine/cli/test/screens.test.ts` snapshot both frames
with colours stripped. 08 §10.0 and §11 updated; the *first-session* guide
gets the new screenshots.

### Files

Compose: `compose.ts`, contracts, indexer normalisation, fixtures. CLI:
`screens.ts`, `run.ts`, `review.ts`, `preflight/loadset.ts`,
`adapters/{layout,claude/*,pi/*}.ts`, `preflight/drift.ts`, `commands/new.ts`.
Pi: `pi/packages/harness/src/index.ts` (`before_agent_start`), tests. Backend:
`seed.py` (presets, recommended list), `console.file_rows` labels,
`routes_writes.create_harness` (recommended seeding), `set_asset_loads`
(three states). Web: `harnesses/[id]/_files.tsx` label, assets loads column.
Presets: `engine/compose/presets/assets/system_prompt/harness/`.

### Proof

`harness run claude --test-harness-1` shows the boot screen, then Claude;
`claude` reports our brief in its system prompt (ask it *what were you told
before this conversation?*). Pi the same through the extension. A new harness
from the CLI and from the web both start with the recommended set. Deleting
`harness-authoring` from the org is refused with `asset.required`.

---

## WS5 — Launch from a card

### Decisions

**W5-D13 A `harness://` link opens a terminal.** The enterprise pattern
(*Open in VS Code*, JetBrains, Slack, Figma): a registered link type, no
listener on the machine. `harness setup` registers it: macOS delivers a URL to an app as an Apple
Event, never as an argument, so the handler is an AppleScript applet:
`osacompile -o ~/Applications/Harness.app` of a script whose
`on open location theURL` runs `do shell script "<absolute path to harness> open " & quoted form of theURL`,
then `CFBundleURLTypes` for `harness` is added to its `Info.plist` and
`lsregister -f` registers it; Windows writes
`HKCU\Software\Classes\harness` with a `shell\open\command`; Linux writes
`~/.local/share/applications/harness.desktop` with `MimeType=x-scheme-handler/harness`
and runs `xdg-mime default`. `harness setup --unregister` removes it.

`harness open <url>` parses `harness://run?harness=<id>&provider=<id>[&workspace=<path>]`,
checks the login, asks **Open an existing folder / Create a new workspace**
through the native picker (macOS `osascript` `choose folder` / `choose file name`,
Windows PowerShell `FolderBrowserDialog`, Linux `zenity --file-selection --directory`),
creates the folder for the second choice, then opens a terminal in it
running `harness run <provider> --harness <id>` (macOS: `open -a Terminal`
with a one-line script, honouring `$TERM_PROGRAM` for iTerm; Windows: `wt`
if present else `cmd /c start`; Linux: `x-terminal-emulator`). Refusals are
shown in a native dialog, since there is no terminal yet.

**W5-D14 The session remembers its workspace.** `POST /v1/sessions` body
gains `workspace` (the absolute path); `harness_sessions` stores it; the
card carries `lastWorkspace` and `lastHost` from the viewer's own most
recent session with that harness; the page cannot know which machine the
browser is on, so it shows both: *last opened in ~/projects/foo on
corby-mbp*. A person's workspace paths are visible to that person only;
`?as` reads do not include them. The CLI does not send the workspace today
(`run.ts` passes `process.cwd()` to preflight, not to the session body), so
the session-open body in `preflight/preflight.ts` gains `workspace` and
`hostname`.

### WS5b The buttons

On each harness card, one button per harness provider approved for that
level (from `policy.harnessProviders` and routing), labelled with the
provider's name, linking to `harness://run?harness=<id>&provider=<id>`; when
`lastWorkspace` is known, a second link *Open again in …* adds
`&workspace=`. Below the grid, one line: *Buttons open a terminal on this
machine. Nothing happens? Install the CLI — install guide.* No detection is
possible from the page; say so in the guide.

### Files

CLI: `commands/setup.ts` (registration), `commands/open.ts`, `main.ts`
(`open`, `setup --unregister`), `os/{picker,terminal}.ts`, tests with the
scripts stubbed. Backend: `routes_sessions.py`, migration
`0040_session_workspace.sql`, `console.cards` (`lastWorkspace`). Web:
`harnesses/_launch.tsx`, page. Docs: `docs/guide/install.md` (registration,
what to expect), 08 §11 verbs, 00 §4.10.

---

## WS6 — The store

**W5-D15 Browse is a tab of Assets.** *Browse* lists every asset the viewer
can use: the org's, each team's, their own, and the bundled presets, with
the kind tabs and a search box; each row has a checkbox. The bar at the
bottom offers **Add to harness** (a picker of the viewer's own harnesses)
and **New harness from selection**. Adding writes the ids into the person's
version of the harness (`harnesses/<id>.json` on their branch, the same
path `joinHarness` uses); a preset that the org does not yet hold is copied
to the person's branch first. A tool whose sidecar names
`needs: { environment: "<name>" }` brings that environment along, listed in
the confirmation. An org boundary `visibility.store: false` hides the tab
(the existing visibility mechanism); personal accounts have it on.

Files: `assets/_browse.tsx`, `assets/_selection-bar.tsx`, backend
`console.browse_rows`, `routes_writes.add_to_harness`
(`POST /v1/harnesses/{id}/assets` `{ ids }`), sidecar `needs`, tests.

---

## What the advisor and the coordinator check per workstream

1. Suites green before and after; the checker (`scripts/check-plan-docs.py`) 0/0.
2. The live dev stack shows the change (`npm run dev`, ports 8400/8402/3000),
   with a screenshot for anything visual.
3. Docs rows written in the plan docs the change belongs to, and one ledger
   row in `docs/build-log.md` under *Wave 5*.
4. Nothing committed; everything staged.
