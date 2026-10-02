# Console Plan — 00 · Overview, contracts, and the rules of the plan

The **console** is the web application at three scopes — organisation, team,
person — through which the engine is operated and observed. It is the
operator's instrument on the backbone: every screen is a read of the index
or of a session record, every verb is an endpoint the CLI could also call,
and nothing on it is true that the engine did not make true. This folder is
its build plan, written for engineers who did not design it, in the same
discipline as [`../engine/`](../engine/00-overview.md).

**Authority.** This plan implements [`../prd-v2.md`](../prd-v2.md) Part II
(§14–§20) on top of the engine plan. The PRD decides *what* each screen says
and why; this plan decides how it is built. Where this folder and the PRD
disagree, the PRD wins. Where this folder and `engine/` disagree on a
contract, `engine/00 §4` wins and this folder has a bug.

**What the prototypes are.** `web/app/{org,team,user}-preview` are
fixture-driven design drafts. They decided the screen inventory (now
normative in the PRD) and seeded the component set; they are not the
implementation and they are on the delete list (§7). Their flaws are listed
in §7 so nobody carries them forward by copying.

**How to read.** Read this document fully. Then the document for what you
are building, plus `02-web-standards.md`. `06-sequencing.md` says what lands
against which engine milestone and — the reason this plan exists — what the
founder can *observe and drive* at each one.

| Doc | Owns |
| --- | --- |
| **00** overview (this) | invariants, topology, the shell in one paragraph, **every contract**, the screen inventory, constraints, delete list, decisions, budgets |
| **01** shell and design system | regions and the scroll rule, tokens, type and spacing scales, the component inventory with props, states, themes, accessibility |
| **02** web standards | routes and scope, server/client split, one data path, generated types, URL as state, forms, copy, lint, tests, budgets |
| **03** data and naming | the read model per screen, the `api` console endpoints, API conventions, DB naming, UI table standards made checkable |
| **04** screens | per PRD §15–§19 section: route, endpoints, columns, scales, verbs by role, states, named tests |
| **05** in-platform docs | one content source: hover explainers, *How this works*, blocker remedies, the command sheet shared with the CLI |
| **06** sequencing | engine milestone → console milestone → what is observable → what verbs work → the test that proves it |
| **07** personal edition | what each screen shows at *n* = 0, sign-up, the personal cut that ships first |
| **08** platform panel | the reserved staff scope: what it will show, what is reserved now, what is not built |

---

## 1. Invariants

| # | Invariant | Consequence |
| --- | --- | --- |
| K1 | **Three surfaces, one application.** Org, team and person are the same screens at a narrower scope with different verbs (PRD §16). | Scope is a route segment. One component per screen, parameterised by scope; never three components. |
| K2 | **The console reads the index and session records. It never reads git, never composes, never decides.** | Every read is a `/v1/console/*` endpoint over `idx_*` tables and `harness_sessions`; file contents and history reach it through `api`, which asks `definitions`. |
| K3 | **Every fact is declared, observed or derived, and the cell says which** (PRD §14 principle 2; engine I6). | Cells carry their source; observed cells are fetched when the screen draws and stored nowhere. |
| K4 | **A scale is a column, every tag is a value on a named scale, and every tag links to the screen that defines its scale** (PRD §14 principle 3). | One `ScaleTag` component, one scale registry (§4.6), one *How this works* anchor per scale. An unregistered tag does not compile. |
| K5 | **Chrome never scrolls. Only the content region scrolls.** | The shell is a fixed grid (01 §4); a screen may add a sub-header or sub-sidebar inside the content column and may never add a second scroll container. |
| K6 | **One component per PRD §13 primitive; one implementation per idea.** | Scoping, request, decision record, two-column compare, log row, tally: each is one component consumed everywhere it appears. A second implementation is a defect. |
| K7 | **Nothing fixture-driven ships.** | Fixtures exist for tests only and are the engine's conformance JSON plus derived session fixtures; the production bundle contains none. |
| K8 | **Every verb is an endpoint the CLI could call, and the console never has a verb the model lacks.** | No console-only mutation. Accept is `promote`; narrow is a grant; invite is membership. |
| K9 | **Personal is enterprise with zero teams.** Same screens, same components; a screen or verb with no meaning at *n* = 0 is hidden, never a second implementation (07). | One codebase, one test suite; upgrading is adding a team. |

---

## 2. Topology

```
browser ── Next.js 16 (app router) ──► api (FastAPI)
              │  /v1/* rewritten            │ reads idx_* and records
              │  Supabase session → JWT     │ asks definitions for blobs/log/tree (read-only)
              ▼                             ▼
         one data path: lib/api.ts       Postgres  ◄── definitions (post-receive index)
```

| Concern | Decision |
| --- | --- |
| Framework | Next.js 16 app router, React 19, Tailwind v4 with tokens in `globals.css`. Unchanged. |
| Auth | Supabase session as an httpOnly cookie via `@supabase/ssr`, refreshed in `middleware.ts`, readable by server components; the JWT goes to `api` (`identity.py`, unchanged). `lib/supabase.ts`'s browser-only session is deleted (02 D20). The console never holds a PAT. |
| Data path | **Exactly one**: `lib/api.ts` `request<T>(path, token, init?)` — the token is passed in, never read inside, so one function serves server and client components — through the `/v1` rewrite in `next.config.ts`. `NEXT_PUBLIC_HARNESS_API_URL` and `admin.tsx`'s second path are deleted (§7). |
| Types | **Generated from `api`'s OpenAPI** into `lib/api.generated.ts` at build; `lib/types.ts` is deleted. The engine's contract types are imported by name from a published `@harness/contracts` slice of `engine/compose` (D3). |
| Reads | `/v1/console/*` (D1) — one consumer, changes with screens. |
| Writes | the shared resource endpoints — `/v1/requests`, `/v1/org-units/…`, `/v1/api-keys/…`, `/v1/sessions/{id}` (revoke), `/v1/assets/{id}/promote` → `definitions:/internal/commit`. Shared with the CLI and audited once. |
| Routing | real routes; URL is the state (02 §6). Hash routing is deleted with the prototypes. |
| Tests | vitest for pure view-model functions; Playwright for screens against a fixture index (D6). |
| Public site | shares tokens and `BrandMark`; nothing else. Out of scope here. |

---

## 3. The shell, in one paragraph

A four-region CSS grid on `100dvh`: **global header** (one row, 56px:
brand, scope switcher, search, account), **global sidebar** (one column,
248px: the navigation groups of PRD §14 — Assets · Permissions · Logs ·
People, plus Providers at the org), and the **content column**, which is
the only region with `overflow: auto`. Inside the content column a screen
may render a **sub-header** (title, lede, the page's own controls — the
harness header's two-by-three grid lives here) and a **sub-sidebar** (a
file list beside a file, a request list beside a request) — both `position:
sticky` *within the content column's own scroll*, never a second scroll
container. Below 960px the sidebar collapses to a drawer and the sub-sidebar
stacks above the content. Full specification, breakpoints, focus order and
keyboard map: 01 §4.

---

## 4. Contracts

**Every cross-document type is defined here.** Engine types are imported by
name from `engine/00 §4` and never redeclared; this section defines only
what the console adds — view models, the read endpoints, and the scale
registry. A document needing a type not here adds it here first.

### 4.1 Scope and viewer

```ts
/** The route segment. `team` carries the dotted team path; `me` is the signed-in person. */
type Scope = { kind: "org" } | { kind: "team"; path: string } | { kind: "me" } | { kind: "platform" };   // platform: staff only, reserved (08)

/** From GET /v1/console/me. `role` is engine 00 §4.10's; `teams` are the teams on the viewer's chain. */
interface Viewer {
  user: { id: string; email: string; name: string };
  chain: Chain;                                   // engine
  role: { level: "member" | "team-admin" | "org-admin"; at: string | null };
  /** prd-v2 §12.1: an org with zero teams. The console hides what has no meaning (07). */
  edition: "personal" | "enterprise";
  /** Internal staff (prd-v2 §12.2). Never an org role; grants the platform scope only. */
  staff: boolean;
  teams: Array<{ path: string; name: string; admin: boolean }>;
  /** PRD §16: an org admin may hide a person's view of boundaries/logs. Default all true. */
  visibility: { boundaries: boolean; logs: boolean };
  /** The sidebar's *work waiting* counts (PRD §16), keyed by navigation entry; absent = no count (03 §4.1). */
  waiting: Partial<Record<NavKey, number>>;
}

/** The sidebar's items, decided once by `navFor(scope, viewer)` (01 §4.4). */
type NavKey = "harnesses" | "assets" | "groups" | "boundaries" | "providers" | "vaults" | "sessions" | "logs" | "endpoints" | "people" | "teams" | "account" | "how";
```

### 4.2 Provenance on every cell

```ts
type Provenance = "declared" | "observed" | "derived";

/** Wraps any displayed value with where it came from (K3). `at` is set for observed. */
interface Fact<T> { value: T; provenance: Provenance; at?: string; by?: string }

/** P10: when an org admin has hidden a view from this viewer, the response carries the note to show
    in place of the list — never a shorter list, never silence. Keyed by the field that is hidden. */
type Hidden = Record<string, string>;

/** A table's columns, declared once per row type and consumed by `Table` (01 §7.7, 03 §10). */
interface Column<Row> {
  key: keyof Row & string;
  heading: string;
  kind: "text" | "number" | "time" | "scale" | "related" | "fact";
  unit?: Related["unit"];          // required when kind is "related"
  scale?: ScaleId;                 // required when kind is "scale"
  help?: string;                   // the (?) text, from content/
  sort?: "asc" | "desc" | false;
  width?: string;
}
```

### 4.3 Harness views (PRD §17)

```ts
/** A card (PRD §17.1): no status, no tags. */
interface HarnessCard {
  id: string; name: string; description: string; icon: Icon;
  team: { path: string; name: string };
  fileCount: number;
  /** W5-D9: the other copies of this id on the viewer's chain, in chain
   *  order. The card is the nearest copy; these link to the same harness
   *  read at that level. */
  alsoAt: Array<{ level: "org" | "team" | "me"; label: string; href: string }>;
}

/** The repository view for one viewer (PRD §17.1–17.2). Composed server-side from the index for `as`. */
interface HarnessView {
  def: HarnessDef;                                // engine
  team: { path: string; name: string };
  header: {
    preflight: Fact<"passing" | "failing">;       // derived (03 D31): the last session's report when its commits equal idx_refs now, else a dry compose
    modelProvider: Fact<string>;
    groups: Fact<string[]>;
    outsideEndpoints: Fact<"allowed" | "prohibited">;
    fileCount: number;
  };
  /** The compare control's options for this viewer (PRD §17.2, §18). */
  versions: Array<{ id: "mine" | "team" | `member:${string}`; label: string }>;
  files: HarnessFileRow[];
  groups: Array<{ name: string; grant: string }>; // sidebar reference, not repository content
  boundaries: Boundary[];                         // engine; listed in full (PRD §16)
}

interface HarnessFileRow {
  assetId: string;
  kind: AssetKind;                                // engine
  name: string;
  path: string;
  /** The branch the winning copy came from (PRD §17.1 owner): org · team · you · member:<id> */
  owner: "org" | "team" | "you" | `member:${string}`;
  lastEditor: { name: string; at: string; note: string };
  /** git tree id of the asset directory on the winning branch; the client compares `mine` and `team` rows by it (03 D32). */
  tree: string;
  /** Only meaningful in the Differences view; absent elsewhere (PRD §17.2). */
  differs?: "yours-only" | "theirs-only" | "both" | "conflict";
}

/** A file's page (PRD §17.1, §18). Content and history come from definitions via api. */
interface FileView {
  row: HarnessFileRow;
  content: { mine: string | null; team: string | null };
  /** mine against team at this path, produced by `definitions:/internal/diff` through `api` (D8); absent when a side is null. The console never diffs text itself (01 D66). */
  diff?: DiffHunk[];
  history: Array<{ commit: string; branch: "mine" | "team"; who: string; at: string; message: string }>;
  request?: { id: string; state: "open" | "closed" };
}
```

### 4.4 Requests (PRD §17.3, primitive *Request*)

```ts
interface RequestView {
  id: string;
  harness: { id: string; name: string };
  team: { path: string; name: string };
  /** PRD §13: one primitive, two subjects. A role request has no files. */
  subject: { kind: "promotion"; paths: string[]; commit: string } | { kind: "role"; level: "team-admin"; team: string };
  title: string; reasoning: string;
  author: { id: string; name: string }; at: string;
  state: "open" | "closed";
  outcome?: { decision: "accepted" | "declined" | "withdrawn"; by: string; at: string; reason: string };
  files: Array<{ assetId: string; path: string; added: number; removed: number; stale: boolean; diff: DiffHunk[] }>;
  discussion: Array<{ id: string; who: string; at: string; text: string }>;
  /** Verbs the viewer may use: computed server-side from role and authorship (K8). */
  verbs: Array<"accept" | "decline" | "withdraw" | "comment">;
}

interface DiffHunk { header: string; lines: Array<{ kind: "ctx" | "add" | "del"; text: string }> }
```

### 4.5 Sessions and slots (engine 04 §6; the founder's window on the backbone)

```ts
interface SessionRow {
  id: string; person: { id: string; name: string };
  harness: { id: string; name: string } | null;
  provider: { id: string; version: string };
  model: { provider: string; model: string };
  status: "active" | "revoked" | "closed";
  startedAt: string; lastActiveAt: string; closedAt?: string;
  endpoints: { reached: number; refused: number };
}

interface SessionView extends SessionRow {
  commits: Record<string, string>;                // ref → commit the session ran on
  slots: Slot[];                                  // engine — state, evidence, resolvedFrom, via
  preflight: PreflightReport | null;              // engine — posted by the CLI (D7); null for pre-D7 sessions
  endpointsTally: EndpointTally[];                // engine
  revokedReason?: string;
}
```

### 4.6 Scales

```ts
/** K4. Every tag on the console is one of these, and the registry is the whole list. */
type ScaleId =
  | "approval"        // approved · beta · not-approved            (PRD §9.1)
  | "source"          // vault-supplied · locally-owned            (PRD §6.5)
  | "evidence"        // verified · harness-reported · declared    (PRD §6.6)
  | "slot"            // satisfied · unsatisfied · deferred
  | "reach"           // allowed · prohibited                      (PRD §8)
  | "holds"           // enforced · intercepted                    (PRD §7)
  | "loads"           // always · when-chosen                      (PRD §5.2)
  | "role"            // member · team-admin · org-admin
  | "request"         // open · closed
  | "session"         // active · revoked · closed
  | "preflight"       // passing · failing
  | "provenance";     // declared · observed · derived

/** The five tones a tag or dot may take. Colour never carries meaning alone (01 §7); the scale's word does. */
type Tone = "ok" | "hold" | "warn" | "accent" | "neutral";

interface ScaleTag { scale: ScaleId; value: string }

/** The registry: for each scale, its values in order, a one-line meaning per value, and its How-this-works anchor. Defined once in 05 §2. */
type ScaleRegistry = Record<ScaleId, { label: string; values: Array<{ value: string; tone: Tone; meaning: string }>; href: `/console/how#${ScaleId}` }>;
```

### 4.7 Relationship columns and the edge walk (PRD §14 principles 1 and 4)

```ts
/** A relationship cell: linked values with a named unit. Never a tag. */
interface Related { unit: "teams" | "harnesses" | "groups" | "secrets" | "assets" | "providers" | "people"; items: Array<{ id: string; label: string; href: string }>; all?: true }

/** A boundary with the node that set it (PRD §16: the source of each line). */
type BoundaryRow = Boundary & { setBy: ChainNode };

/** Two hops, directed (PRD §14 principle 1). */
interface EdgeWalk {
  from: { kind: string; id: string; label: string };
  restsOn: Array<{ kind: string; id: string; label: string; via: string }>;      // what this needs to work
  restedOnBy: Array<{ kind: string; id: string; label: string; via: string }>;   // what would break
}
```

### 4.8 Logs (PRD §19)

```ts
type LogCategory = "harness" | "permission" | "provider" | "people";

interface LogRow {
  id: string; at: string;
  actor: { id: string; name: string };
  team: { path: string; name: string } | null;
  action: string;                                 // the audit action, e.g. "session.open"
  sentence: string;                               // plain words, built by 03's rule from action + payload
  diff?: DiffHunk[];                              // git-backed rows
  ref?: { ref: string; commit: string };
}

interface EndpointRow { host: string; port: number; alias?: string; count: number; refused: number; firstAt: string; lastAt: string; sessions: number; harnesses: Related }
```

### 4.9 People and teams (PRD §12, §18)

```ts
interface PersonRow { id: string; invite?: string | null; name: string; email: string; team: string; unit: string; teams: Related; role: ScaleTag; lastActive?: string; state: "active" | "invited" | "deactivated" }  // team = the direct parent node; unit = the person's own org-unit path; invite = the `org_invites` row, on an invited row only
interface TeamRow { path: string; name: string; parent: string | null; children: Related; people: number; groups: Related; admins: Related }
/** What removing a person takes with them (PRD §18). */
interface RemovalPreview { person: PersonRow; loses: Array<{ group: string; via: string }>; sharedKeysToRotate: Array<{ ref: string; group: string }> }
```

### 4.10 Console read endpoints (`api`, namespace `/v1/console/`)

All `GET`, all scoped by the caller's role and, where present, `?scope=org|team:<path>|me` and `?as=<user-id>` (a team admin reading a member's view; refused otherwise). Every response is JSON of the types above. Pagination: `?cursor=&limit=` returning `{ items, next }`. Full request/response per endpoint: 03 §4.

| Path | Returns | Screen |
| --- | --- | --- |
| `/me` | `Viewer` | shell |
| `/harnesses` | `HarnessCard[]` | Harnesses |
| `/harnesses/{id}` | `HarnessView` (with `?as`, `?version=mine\|team\|member:<id>`) | Harness |
| `/harnesses/{id}/files/{assetId}` | `FileView` | File |
| `/harnesses/{id}/requests` | `RequestView[]` (`?state=open\|closed`) | Requests panel |
| `/requests/{id}` | `RequestView` | Request |
| `/sessions` | `SessionRow[]` (`?person=&harness=&status=`) | Sessions |
| `/sessions/{id}` | `SessionView` | Session |
| `/groups` · `/groups/{name}` | group rows with `Related` teams/secrets/harnesses; `EdgeWalk` | Security groups |
| `/grants` | grant rows incl. outside-endpoints, narrowed-from | Security groups |
| `/boundaries` | `BoundaryRow[]` | Boundaries |
| `/providers/harness` · `/providers/model` · `/routing` | harness provider rows with approval, scope, pin, `speaks`, `name`; model provider rows with `status` (`providerStatus`, W6-D6) and their routing; the routing matrix with its pickable `subjects` (W6-D5 — the model tab reads it, the Routing tab is gone) | Providers |
| `/vaults` · `/vaults/{id}/secrets` | vault rows (connected · reachable now [observed] · secrets listable · hands us minted or stored — text, not a grade), secrets with `Related` groups | Key vaults |
| `/assets?scope=` · `/assets/{id}?scope=` | the scope's own node's asset rows with `loads`, description, `Related` harnesses/teams/groups, and the organisation's `kinds` beside them (W5-D9); `EdgeWalk` on the one | Assets |
| `/assets/browse?scope=` | `BrowseRow[]` — everything the viewer can use: the winning copy of every asset on their chain and the bundled presets the organisation does not hold yet, each with its kind, description, the level it comes from and whether they hold a copy (W5-D15). `hidden` when `visibility.store` is off | Assets → *Browse* |
| `/logs/{category}` · `/logs/{category}/{id}/diff` · `/endpoints` | `LogRow[]`; `DiffHunk[]` for a git-backed row, fetched on expand; `EndpointRow[]` | Logs |
| `/people` · `/people/{id}` · `/people/{id}/removal` · `/teams` | `PersonRow[]`, person detail, `RemovalPreview`, `TeamRow[]` | People |
| `/edges?kind=&id=` | `EdgeWalk` | any *What rests on this* section |
| `/how` | `ScaleRegistry` + content (05) | How this works |
| `/search?q=` | objects by name in the current scope, plus command-sheet rows — for the header palette (01 D61) | shell |

### 4.11 Writes the console uses (shared resource endpoints)

| Verb | Endpoint | Underneath |
| --- | --- | --- |
| Accept a request | `POST /v1/requests/{id}/accept { reason? }` | `definitions:/internal/commit` onto the team ref for the request's paths (engine 02 §5.3); closes the request; audit |
| Decline / comment | `POST /v1/requests/{id}/decline { reason }` · `POST /v1/requests/{id}/comments { text }` | audit |
| Promote from a read branch | `POST /v1/requests { … , as: <member> }` then accept — one flow, no second verb (PRD §18) | |
| Narrow a group | `POST /v1/grants { group, scope, narrowedFrom, aliases }` → commit on the team ref via `definitions:/internal/commit` | engine 01 §6 |
| Add / remove a boundary | `POST /v1/boundaries` · `DELETE /v1/boundaries/{id}` (own scope only) | commit on the node's ref |
| Create a sub-team; invite; remove; roles; visibility switch | existing `/v1/org-units/…`, `/v1/invites`, roles routes; `PATCH /v1/org-units/{id}/visibility { boundaries?, logs?, store? }` — `store` is the Assets screen's *Browse* tab (W5-D15) | records |
| Approve / decline a provider; add, edit or **delete** a model provider; routing | `PUT /v1/providers/harness/{id}` · `PUT /v1/providers/model/{id}` · `DELETE /v1/providers/model/{id}?scope=org` (refuses `provider.in_use`) · `PUT /v1/routing` (refuses `provider.needs_key`) → commit on the org ref | |
| Connect a vault; paste or rotate a key (bundled vault only); create or edit a group | `POST /v1/vaults` · `POST /v1/vaults/{id}/secrets` · `POST /v1/vaults/{id}/secrets/{ref}/rotate` · `POST /v1/groups` · `PATCH /v1/groups/{name}` — the existing `/v1/api-keys/…` routes re-seated | records + org ref |
| Revoke a session | `POST /v1/sessions/{id}/revoke { reason }` | engine 04 |
| Create a harness | `POST /v1/harnesses` → commit `harnesses/<id>.json` on the caller's ref; a bundled preset named in `assets` is copied onto that branch in the same commit (W5-D15) | engine 01 |
| Add assets to a harness (the store) | `POST /v1/harnesses/{id}/assets?scope=me { ids }` → the ids join **the person's version** of the harness, created from the nearest copy on their chain when their branch has none — the file `joinHarness` writes (engine 08 §10.0 step 5a). A preset is copied in the same commit; a tool's `needs.environment` comes with it; an id already listed is skipped; `asset.unknown` for one the viewer cannot use | commit on the person's ref (W5-D15) |
| Edit / delete a harness | `PATCH /v1/harnesses/{id}` · `DELETE /v1/harnesses/{id}` (own ref, or team ref as its admin) | commit |
| Remove a grant; set how an org asset loads | `DELETE /v1/grants/{id}` · `PUT /v1/assets/{id}/loads { loads }` | commit on the org/team ref |
| Edit an asset's own copy (description, rename); delete it | `PATCH /v1/assets/{id}?scope= { description?, name? }` → updated `OrgAssetRow` · `DELETE /v1/assets/{id}?scope=` → `204` (admin over the node holding the copy; a person's own copy is always theirs) | commit on that node's ref (WS3a); refused `asset.required` when the id is required, `asset.name_taken` when the new name exists there |
| Disconnect a vault | `DELETE /v1/vaults/{id}` (refused while any group references it) | records + org ref |
| Deactivate / reactivate a person; remove from a team | `PATCH /v1/people/{id} { state }` · `DELETE /v1/org-units/{team}/members/{id}` | records |
| Ask to be a team admin | `POST /v1/requests { subject: { kind: "role", … } }` | the request primitive |
| Sign up | `POST /v1/orgs { code, personal?, org_name?, team_name? }` → the org row (W7-D1, console D101). `code` is compared to `HARNESS_SIGNUP_CODE` **before the transaction opens** and refused `403 signup.code_wrong` — *That access code is not right.* — when it differs or the variable is unset, so nothing is created and the message carries no hint. `personal: true` takes the personal path (no team ref, the person's address names the organisation, `email_label` when that slug is taken) and needs no `org_name`; without it `org_name` is required (`422 org_name_required`) and the signer becomes the organisation's owner. The only write the public pages make | records + the org ref's seed commit (engine D30f, engine D30h) |

Endpoints marked "commit on … ref" are new in `api` and all go through one helper that calls `definitions:/internal/commit` and appends the audit event — one implementation (K6, engine primitive *Decision record*). The audit action strings these writes emit (`request.*`, `grant.*`, `boundary.*`, `provider.*`, `routing.change`, `vault.connect`, `group.create`, `console.read_as`) are defined once in 03 §6, and route authors use those strings.

---

## 5. Screen inventory

One row per screen; the PRD section is the design, 04 is the build. Scope
column: which scopes render it (K1).

| Route (under `/console/[scope]`) | Screen | PRD | Scopes |
| --- | --- | --- | --- |
| `/harnesses` | cards | §17.1 | org · team · me |
| `/harnesses/[id]` (+ `?version=mine\|team\|member:<id>\|differences`, `?view=files\|history\|requests`, `?as=`) | repository — `differences` is a client-side view over `mine` and `team` (03 D32), not an endpoint value | §17.1–17.3 | all |
| `/harnesses/[id]/files/[assetId]` | file, conflict, history | §17.2 | all |
| `/harnesses/[id]/requests/[rid]` | request | §17.3 | all |
| `/groups`, `/groups/[name]` | security groups, narrow | §15, §18 | org · team (narrow) · me (read) |
| `/boundaries` | boundaries, add for team and below | §15, §16 | all |
| `/providers`, `/providers/model` | approval, routing (W6-D5: a column and two verbs on the model row; `/providers/routing` redirects) | §15 | org (team: read + choose default) |
| `/vaults`, `/vaults/[id]` | key vaults, secrets | §15 | org |
| `/assets`, `/assets/[id]` | assets, one screen at every level (W5-D9) | §15 | all (the level's admin has the verbs) |
| `/sessions`, `/sessions/[id]` | sessions, slots, preflight, endpoints | engine 04 §6 | org · team (own subtree) · me (own) |
| `/logs/[category]`, `/logs/endpoints` | four logs + endpoints reached | §19 | all, filtered |
| `/people`, `/people/[id]`, `/teams` | people, teams tree, sub-team, removal, requests for role | §12, §18 | org · team · me (account) |
| `/console/how` — **outside `[scope]`**, one page for everyone, so every tag's `href` is one URL | *How this works*: every scale, every word | §14, 05 | all |
| `/account` | the person's account screen: teams, logins, honesty line, ask | §18 | me |

---

## 6. Constraints

PRD §14's nine principles and the engine constraints that bind the console,
each naming the doc that honours it.

| # | Constraint | Doc |
| --- | --- | --- |
| P1 | Every object is a destination; every relationship walks both ways; two hops shown directed | 03 §5, 04 §18 |
| P2 | Declared / observed / derived, never mixed; observed fetched at draw and stored nowhere | 01 §7.4, 03 §4 |
| P3 | A scale is a column; tags link to their scale; one word one meaning | 01 §8, 05 §4 |
| P4 | Relationships are columns with a named unit; *All teams* not a repeated list; no column without a heading | 03 §10 |
| P5 | A derived fact is not a control | 04 |
| P6 | Link to what we do not own; never a control that changes nothing there | 04 |
| P7 | Adding is part of the screen | 04 |
| P8 | Explain the vocabulary, not the screen: hover once, tooltips on buttons, pages never narrate | 05 |
| P9 | Plain words, git on demand; the two views never disagree | 04, 05 |
| P10 | Transparency default; a hidden view says so, never a shorter list (PRD §16) | 04 |
| P11 | Cards carry no status (PRD §17.1) | 04 |
| P12 | Conflict badge only in Differences; editor column follows the copy (PRD §17.2) | 04 |
| P13 | Refusing plainly beats a disabled button: *Permission not cleared* names who decides (PRD §17.3) | 01 §7.12, 05 §7 |
| P14 | The command sheet and `harness commands` render from one table (engine 08 §11.17) | 05 §6 |
| P15 | A session records everything it was offered; the console shows the report whole (engine C17) | 04 |
| P16 | Native sessions read *not metered*, never zero (engine C22) | 04 |
| P17 | A refusal you cannot look up is a bug: boundaries listed in full (PRD §16) | 04 |

---

## 7. What the console deletes

| Today | Replaced by | When (06) |
| --- | --- | --- |
| `web/app/admin.tsx` (1,702 lines, one component, tabs over the `asset_scopes` era) and its panels `scope.tsx`, `asset-*.tsx`, `model-default.tsx`, `harness-screen.tsx`, `harness-tiles.tsx` | the screens in §5 | as each screen lands; the file goes at K-M2 |
| `web/app/{org,team,user}-preview/*` (5,600 lines of fixtures and drafts) | §5 screens; their fixtures become Playwright fixtures under `web/test/fixtures/` | K-M1 (org) · K-M3 (team, me) |
| `lib/types.ts` (hand-maintained) | `lib/api.generated.ts` from OpenAPI + `@harness/contracts` | K-M2, with the last `admin.tsx` panel that reads it; the generation pipeline lands at K-M0 |
| `NEXT_PUBLIC_HARNESS_API_URL` and every direct `fetch` to it | `lib/api.ts` through the rewrite | K-M0 |
| Hash routing (`pushState` + `popstate`) | real routes | with the prototypes: K-M1 (org) · K-M3 (team, me) |
| `lib/diff.ts` and the three client diff renderers | one `Diff` over server-produced `DiffHunk[]` (`definitions:/internal/diff` via `api`, D8; 01 D66) | K-M1 |
| Themes `jade`, `leather` (D4) | `steel` (dark) and `light` | K-M0 |
| The prototypes' second `Head`/`Card`/`Line`/`Diff`/`Tally` implementations that duplicate `ui.tsx` | one component library (01 §7) | K-M0 (the library) · K-M1/K-M3 (the copies, with the prototypes) |
| Prose that narrates the screen (*your working copy, which is what runs for you*) | vocabulary hovers (P8) | as each screen lands |

**Flaws not to carry forward** (the founder's judgement, confirmed by survey
of `web/` on 24 September 2026). Each is closed by the doc named.

| Flaw | Where today | Closed by |
| --- | --- | --- |
| Chrome duplicated three ways, none of it fixed; the console header scrolls away; `min-h-screen` everywhere so the page scrolls, not the content | `admin.tsx:1201`, `preview.tsx:739`, `scope-app.tsx:121` | 01 §4 (K5) |
| No spacing, radius, shadow or type-scale tokens: 16 arbitrary font sizes, 5 bespoke shadows, 5 radii | `globals.css` defines colour only | 01 §5 |
| Same idea, divergent components: `Head` ×2, `Card` ×2, `Detail` ×2 with different props; `Heading` ×2 and `encodeText` ×2 identical; three diff renderers; segmented control inline ×3; nav item inline ×5 with two "selected" idioms | prototypes and real console | 01 §7 (K6) |
| Serif headings in the prototypes (the marketing site's voice), sans in the console | `scope-app.tsx:208`, `preview.tsx:1116` | 01 §6 (D12) |
| Zero URL state in the real console: no deep links, Back exits; hash routing in the prototypes | `admin.tsx` (20 `useState`), `scope-app.tsx:84` | 02 §6 (D2) |
| Two data paths and two env vars for one backend; `lib/supabase.ts` falls back to `"placeholder"` credentials silently | `admin.tsx:154`, `lib/supabase.ts` | 02 §4 |
| No error boundary anywhere (acknowledged in `asset-document.tsx:145`); loading is `Loading…` text | real console | 02 §3 |
| Two `onAuthStateChange` subscriptions that can bounce `/login` and `/app`; session is `localStorage` only, so no server can see it | `auth.tsx:161`, `admin.tsx:935` | 02 §3 |
| Theme flash on `/request`, `/privacy`, `/terms`: three disagreeing "public path" definitions; `isPublicPath` dead | `lib/theme.ts:36`, `public-theme.tsx` | 01 §10 (D4) |
| `SHOW_RESET` defaults on — a destructive command block ships unless an env var says otherwise | `admin.tsx:158` | deleted with `admin.tsx` |
| `request-form.tsx` bypasses `ui.tsx` with its own field, label, button and alert | public site | out of scope; noted for the site |
| Tags with scales kept in per-panel literal maps; the prototype's `SCALE_OF`/`BADGE_GUIDE` is the seed of a registry and nothing consumes it | `admin.tsx:117`, `preview.tsx` | 05 §4 (K4) |
| Fixtures leak into UI (`data.ts` imports `Tone`); prototypes import fifteen `ui.tsx` components | prototypes | K7; deleted |
| Prototype routes reachable unauthenticated and absent from `robots.ts` | `/org-preview`, `/team-preview`, `/user-preview` | deleted at K-M2/M3; until then `robots.ts` disallows them (06 K-M0) |
| Spelling mixed inside one file (`admin.tsx`: *organization tree*, *honour*) | everywhere | 02 §8 |
| `role="tab"` without `tablist`/`tabpanel`; menu opens on hover only; `Modal` has no focus trap or restore; destructive verbs use `window.confirm`; `PixelEditor` mouse-only; help text as `title=` invisible to keyboard | real console and prototypes | 01 §11 |
| No tests, no `typecheck`/`test` scripts, no CI for web; formatting matches `prettier-plugin-tailwindcss` with no config recorded | `web/package.json` | 02 §9–§10 |
| `BrandMark` lives in a `"use client"` module, dragging a client boundary into every public page | `ui.tsx:361` | 01 §7.14 (server-safe module) |
| `LEGAL.address`/`LEGAL.email` are bracketed placeholders rendered live | `legal.ts` | out of scope; the site's launch checklist |

---

## 8. Decisions

| # | Decision | Why | Reverse by |
| --- | --- | --- | --- |
| D1 | **Reads live under `/v1/console/*`; writes use the shared resource endpoints.** | Reads have one consumer and change with screens; writes are the domain, shared with the CLI, audited once. | folding console reads into resource routes |
| D2 | **Scope is one route segment** `/console/[scope]/…` with `[scope]` ∈ `org` · `me` · `<dotted team path>` (e.g. `/console/acme.marketing/boundaries`). A team path always contains a dot and `org`/`me` never do, so one `[scope]` segment carries all three and there is one route tree. | K1; shareable URLs; every tag link resolves; no duplicated tree | a `team/` prefix — costs a second tree |
| D3 | **Types are generated from `api`'s OpenAPI**; engine contract types come from `@harness/compose/contracts` (a types-only export of `engine/compose`). | one truth; `lib/types.ts` drifted from migrations. | hand-maintained types |
| D4 | **Two themes** — `steel` and `light`. `jade` and `leather` are site leftovers with no product meaning. | fewer states to test; the PRD names none. | keeping four |
| D5 | **The shell is a fixed grid with one scroll container** (K5, §3). | the founder's stated requirement; sticky chrome scrolls under long tables. | — |
| D6 | **Playwright against a fixture index** seeded from the engine's conformance fixtures plus derived session fixtures; **vitest** for view-model functions. | screens are tested against the same truth the engine is. | fixtures authored by hand |
| D7 | **The CLI posts its `PreflightReport` to the session** (`PATCH /v1/sessions/{id} { preflight }` on the first supervise tick) so the console can show it. Amends engine 08 §9 and engine 00 §4.10 by one row. A session from a CLI that predates this carries `null`, and the screen says *this session did not post its preflight report* rather than showing nothing. | the report is the backbone's main artefact and the founder's primary test surface (06). It contains no values. | showing slots only |
| D8 | **File contents, history and diffs reach the console through `api`**, which calls three read-only `definitions` internal endpoints (`/internal/tree`, `/internal/blob`, `/internal/log`). Amends engine 02 and engine 00 §4.10. | K2: the browser never speaks git; `api` remains the only client of records and the only caller of `definitions`. | a read-only git gateway the browser talks to |
| D9 | **Every "commit on a ref" write goes through one `api` helper** → `definitions:/internal/commit` + audit. | K6; engine primitive *Decision record*. | per-route commits |
| D10 | **`admin.tsx` is not migrated; it is replaced screen by screen and deleted.** | its tabs model the retired `asset_scopes` world. | incremental refactor |
| D11 | **The public site is out of scope** and shares only tokens and `BrandMark`. | different consumers, cadence and claims. | — |
| D14 | **Personal edition is a rendering of the same screens at `edition: "personal"`** (K9, 07); self-serve sign-up creates the org; there is no separate app, route group or component set. | build once | a `personal/` route group |
| D15 | **The platform scope is reserved** (`Scope.kind: "platform"`, `Viewer.staff`, `/console/platform/…`, `/v1/platform/*`) and its screens are specified but not built (08). | a retrofit would touch every screen's scope handling | — |
| D12 | **Console typography is sans throughout; serif is the marketing site's voice and appears nowhere in the console.** The prototypes' serif headings are not carried. | one voice per surface; the console is an instrument, not a brochure. | serif for page titles only |
| D13 | **`globals.css` gains spacing, radius, shadow and type-scale tokens** and every arbitrary `text-[Npx]`/`shadow-[…]`/`rounded-*` in the console becomes a token. Colour tokens are unchanged. | "easily editable" is false while 98 literals encode the body size. | — |

---

## 9. Budgets

Ceilings, source lines excluding tests. Baseline: `web/app` today is
~13,700 lines of which ~7,300 are prototypes and `admin.tsx`.

| Module | Ceiling |
| --- | --- |
| `app/(console)/shell/` — grid, header, sidebar, sub-regions | 400 |
| `app/(console)/ui/` — the component library (01 §7) | 1,400 |
| each screen directory under `app/(console)/[scope]/` | 350 (a screen over it is two screens) |
| `lib/` — api client, view-model helpers, scale registry | 600 |
| `content/` — every string the console explains with (05) | unbudgeted, but one file per screen |
| `backend/app/api/routes_console.py` + `domain/console.py` | 900 |

---

## 10. Testing, in one page

| Tier | Runs against | Examples |
| --- | --- | --- |
| **V1 pure** | view-model functions | `sentence(logRow)`, `preflightOf(session)`, `versionsFor(viewer, harness)`, scale lookups |
| **V2 component** | a component with props, in Playwright component mode | `ScaleTag` renders and links every registered value; `Table` keyboard path; `PermissionNotCleared` names the decider |
| **V3 screen** | a route against the fixture index | every row of 06's observability table; every scope × screen renders; `?as` refused for a member |
| **V4 wired** | `api` + `definitions` + a real CLI session in CI | a `harness run pi` in CI appears in `/sessions` with slots, preflight and endpoints within one tick |

**Fixtures.** `web/test/fixtures/` = the engine's `engine/compose/fixtures/`
(symlinked, not copied) + `sessions/*.json` derived by running the engine's
own preflight against them in CI. One truth, three consumers (engine 00 §10).

---

## 11. Glossary additions

| Word | Means | Never means |
| --- | --- | --- |
| **scope** | which surface: org, a team, or me | a permission |
| **viewer** | the signed-in person, or the member they are reading `as` | the author of a thing |
| **fact** | a value with its provenance | a claim |
| **scale** | a named set of values a tag can take | a status |
| **shell** | header + sidebar + content column | a page |
| **sub-header / sub-sidebar** | regions a screen adds inside the content column | chrome |
