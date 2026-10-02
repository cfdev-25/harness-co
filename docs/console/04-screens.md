# Console Plan — 04 · Screens

Every screen in `00 §5`, built. The PRD (Part II, §14–§20) is the design and
is not re-argued here; each subsection adds only what a build needs — route,
data, layout regions, typed columns, verbs by role with their refusals,
states, what is deliberately absent, and named tests. The Sessions screens
are new (engine 04 §6) and are the founder's primary window on the backbone.

## 1. Purpose

One subsection per screen, in `00 §5` order, each with the same eight parts
so that `03` can derive every `Column<Row>` and every endpoint response from
this document, `01` can confirm every component it names exists, and `05`
can inventory every explained word. A screen that needs a ninth part is two
screens.

## 2. Invariants

| # | Holds here | From |
| --- | --- | --- |
| S1 | One component per screen, parameterised by `Scope`; scopes differ in verbs, never layout | K1 |
| S2 | Every fact rendered is a `Fact<T>` or a field of a typed row; nothing is computed in a component | K2, K3 |
| S3 | Every tag is a `ScaleTag` on a registered `ScaleId`; no bare `Badge` with free text | K4, P3 |
| S4 | A screen renders inside the shell's content column; it may add a sub-header and a sub-sidebar and never a second scroll container | K5 |
| S5 | Every verb is one of `00 §4.11`'s endpoints; the console invents none | K8 |
| S6 | A verb the viewer lacks renders as `PermissionNotCleared` naming who decides, never as a disabled button | P13 |
| S7 | A hidden view renders a note naming the decision, never a shorter list | P10 |
| S8 | Relationship cells are `Related` with a unit; `all: true` renders *All teams* | P4 |
| S9 | Two-hop sections are `EdgeWalk`, directed, and appear only on object pages | P1 |
| S10 | No screen imports a fixture | K7 |
| S11 | The public pages — `/`, `/login`, `/signup` — are not screens: no shell, no scope, no `Scope` prop, and between them one **`api`** write, `POST /v1/orgs` behind the access code (07 §2, W7-D1/D101/D101a). `/signup?finish=1` is that same page and not a route of its own — it is where the email link lands, and the three calls that get it there (the link, the session it established, the password) are the auth provider's, not `api`'s | K5, 07 |

## 3. Contracts used

From `00 §4`: `Scope`, `Viewer`, `Fact`, `Provenance`, `HarnessCard`,
`HarnessView`, `HarnessFileRow`, `FileView`, `RequestView`, `DiffHunk`,
`SessionRow`, `SessionView`, `ScaleTag`, `ScaleId`, `Related`, `EdgeWalk`,
`LogRow`, `EndpointRow`, `PersonRow`, `TeamRow`, `RemovalPreview`. From
`engine/00 §4`: `HarnessDef`, `Boundary`, `Grant`, `SecurityGroup`,
`HarnessProvider`, `ModelProvider`, `Routing`, `Slot`, `Blocker`, `Drift`,
`PreflightReport`, `EndpointTally`, `Icon`, `AssetKind`.

`BoundaryRow` is `00 §4.7`'s. The other per-endpoint row types — `GroupRow`,
`GrantRow`, `HarnessProviderRow`, `ModelProviderRow`, `RoutingMatrix`,
`VaultRow`, `SecretRow`, `OrgAssetRow` — are defined in `03 §4` (the read
model `00 §4.10` delegates there); their columns are specified below and
`03` owns the field names.

Components referenced by name and owned by `01 §7`: `ConsoleShell`,
`Screen` (with its `header` and `aside` slots — the sub-header is a
`SubHeader`, the sub-sidebar is the `aside`, at the start or the end),
`Table` (consuming `Column<Row>`), `ScaleTag`, `Related`, `FactCell`,
`Card`, `Line`, `Modal`, `Confirm`, `Notice`, `Disclosure`, `Diff`,
`Compare`, `Tally`, `Segmented`, `Chip`, `Mono`, `PermissionNotCleared`,
`HiddenView`, `EmptyState`, `Skeleton`, `CommandSheet`, `CommandBlock`,
`PixelArt`, `PixelEditor`, `Field`, `Button`.

---

## 4. Harnesses (cards) — PRD §17.1

**Route.** `/console/[scope]/harnesses`. All scopes. `org` lists every
harness in the organisation grouped by team; `team` its own and its
sub-teams'; `me` the ones the person can run. Verbs differ; the grid does not.

**Bar.** No tabs; the count (*3 harnesses*), the collapsing search
(`?q=`, which was `_search.tsx`) and **New harness** (D99, 01 §7.5).

**Data.** `GET /v1/console/harnesses?scope=`. Server-fetched; nothing
observed at draw.

**Layout.** Sub-header: title *Harnesses*, count, search, **New harness**.
Content: a responsive card grid (`minmax(19rem, 1fr)`), each card
`PixelArt` 56px top-left, name, description clamped to two lines, team,
file count in `Mono`. Cards are links.

**Columns (card fields).** name · text · sort by name; description · text;
team · `Related{teams}` (one item); fileCount · number. No `ScaleTag`.

The card also carries `lastWorkspace` and `lastHost` — where the **viewer's
own** last session with this harness ran and on which machine, `null` for
everyone else and under `?as` (engine 08 D141). The screen's launch buttons
read them (WS5b).

**Launch (W5-D13, engine 08 D140).** The card's last row is one link per
`HarnessCard.runners` entry — the runtimes that can start *this* harness at
*this* level — under the word *Open in*, each labelled with the runtime's own
name (*Pi*, *Claude Code*) and each an
`<a href="harness://run?harness=<id>&provider=<id>">`. The list is the
server's (03 §4.2): approved or beta for the level, scoped to this harness,
and speaking a wire format the routed model exposes. The page derives
nothing, and a card with no runner shows no row rather than a disabled one
(P13). The row sits above the card's overlay link (`z-10`, as the team cell
does), so pressing a runtime opens a terminal and never the harness page.

When `lastWorkspace` is set, a second and quieter line follows: *Open again
in ~/projects/foo on corby-mbp*, the same link with `&workspace=` carrying
the **absolute** path percent-encoded — `~` is display only, and the CLI
refuses a relative path (`cli.link_malformed`). With one runtime the sentence
is the link; with more, the sentence says where and each runtime follows as
its own small link, which is the whole of the *menu* (no popover for two
words). The breadcrumb is drawn from the field being present and nothing
else, so another person's folders are never on screen.

Below the grid, one line: *Buttons open a terminal on this machine. Nothing
happened? **Install the CLI** and run `harness setup`*, the guide linked. No
detection is attempted, because a page cannot tell whether a link type is
registered; the guide (`docs/guide/install.md`) says so and lists the five
reasons nothing happened.

**Also at (W5-D9).** The same id on several nodes of the chain is one
harness, and the card is the **nearest** copy — the person's own version when
they have one. Every other copy is a small link under the team cell:
`HarnessCard.alsoAt: [{ level: "org" | "team" | "me", label, href }]`, in
chain order (organisation first), each `href` the same harness read at that
level's segment (00 D2). `cards()` keeps its dedupe and collects the rest as
it walks. At `org` the scope reads one node, so there is nothing to name.

**Verbs by role.**

| Verb | Member | Team admin | Org admin | Endpoint |
| --- | --- | --- | --- | --- |
| New harness (empty, or *start from a copy* — one button, a select inside) | yes, on own branch | yes, on team or own | yes, on org, team or own | `POST /v1/harnesses { name, description, icon, from? , scope }` |
| — and, for a personal viewer, **Web access** and **Outside keys** inside the same dialog (W7-D4) | yes, on own branch | n/a | n/a | the same `POST`, `+ reach?`, `+ grant?` |
| Open | yes | yes | yes | route |
| Open in *<runtime>* (one per `runners`) | yes | yes | yes | `harness://run?harness=&provider=` — the machine, not the API |
| Open again in *<folder>* (only with `lastWorkspace`) | own only | own only | own only | the same link, `&workspace=` |

**New harness lands at the level you are on** (W5-D9): when
`levelOf(scope, viewer).canEdit`, the button reads *New harness* and posts
`scope` as this level's segment (`HarnessIn.scope` — `me`, `org` or the
dotted team path, never the `team:` spelling of a query string). When it does
not, the button reads **New harness in yours** and posts `scope: "me"`: a
level you only read still lets you start one, on the branch that is always
yours, and the button says so before it is pressed. Creating is never
refused (PRD §17.4), so there is still no `PermissionNotCleared` here: a new
harness is a new filter, never a new permission.

**A personal viewer's dialog asks two more things** (W7-D4). Under name,
description and *start from a copy*:

* **Web access** — a switch, **on** by default, which is what a personal
  organisation's own reach is (engine 01 D155). On sends nothing: absent
  `reach` means *inherit*, and a harness that restated `on` would narrow
  nothing today and become a `reach-widened` conflict — which stops every
  session on the chain — the day the person turns their organisation's reach
  down on Boundaries. Off sends `reach: { mode: "off", hosts: [] }`, which
  becomes `HarnessDef.reach` and reads back as *off, set by `harness:<id>`*
  on the harness page and under Boundaries → Reach.
* **Outside keys** — a `Select` of the person's own security groups
  (`GET /v1/console/groups?scope=me`) with **None** first and chosen. A name
  sends `grant: { group }`, and the route makes one grant of it scoped to this
  harness (`scope: { teams: "all", harnesses: [id] }`). Nothing the modal
  writes reaches further than this harness; the file the grant lands in is the
  organisation's, because `policy/` is refused on a user branch (engine 01
  §4.2), and the API row says so.
* One **read-only line** under them: which model will serve it, from
  `Viewer.setup.model` (W7-D2) — *Model: your default key* · *Model: your Pi
  sign-in* · *Add a key or sign in to Pi first* with a **Providers** link,
  which is shown only in the last case, because that is the only one with
  something to do. `lib/views/harness.ts modelLine` is the one reading of
  those three states, and an absent `setup` reads as the last.

An enterprise viewer sees neither control and the body carries neither field:
their reach is the organisation's and their keys are a grant an admin makes.
The caller decides by passing `personal` — the groups come from a fetch and a
dialog does not fetch (01 rule 2) — so the store's *New harness from
selection*, which is this same dialog, asks the same two questions.

**States.** Loading: six card skeletons. Empty: *No harnesses reach you yet.
`New harness` starts one; it inherits everything you already hold.* Error:
the server's `message` + *Reload*. Hidden: n/a.

**Not on it.** Any tag or status (P11): no conflict count, no preflight,
no readiness. Those are inside.

**Tests.** `cards_carry_no_tag` · `cards_grouped_by_team_at_org_scope` ·
`cards_name_the_other_copies_as_also_at` ·
`new_harness_at_a_level_you_read_lands_on_your_own_branch` ·
`new_harness_one_button_choice_inside` · `new_harness_from_copy_prefills` ·
`cards_empty_state_names_new_harness` · `cards_error_shows_server_message` ·
`cards_carry_runners_approved_and_routed` · `runner_buttons_come_from_the_server` ·
`a_card_with_no_runners_shows_none` · `no_workspace_no_breadcrumb` ·
`the_breadcrumb_encodes_the_path_and_shortens_it_only_to_read` ·
`the_card_overlay_does_not_swallow_a_runner` ·
`new_harness_asks_web_access_and_outside_keys_on_a_personal_account` ·
`new_harness_on_a_personal_account_writes_nothing_for_the_defaults` ·
`new_harness_asks_an_enterprise_viewer_neither`.

---

## 5. Harness (repository) — PRD §17.1–17.3

**Route.** `/console/[scope]/harnesses/[id]?version=&view=&as=`.
`version` ∈ `mine` · `team` · `member:<id>` (the last only when `Viewer.role`
is team-admin at the harness's team or above); default `mine` at `me`,
`team` at `team`/`org`. `view` ∈ `files` (default) · `history` · `requests`.
`as` is the member being read (see §18 Cross-cutting). Both controls are
the bar's tabs and both are links — *Mine · The team's · Differences*, then
*Files · History · Requests*, parted by a rule — and **Edit** is the bar's
verb (D99). The drawing, the harness's own name and the two-by-three grid
are the first block of **content** (`EntityHeader`, `_header.tsx`), not a
header row: the page's name is *Harnesses*, in the top bar.

**Data.** `GET /v1/console/harnesses/{id}?version=&as=` → `HarnessView`;
`?view=requests` also `GET /v1/console/harnesses/{id}/requests?state=`.
The header's `preflight` is a `Fact` whose provenance is `derived` (`03`'s
rule from the last session or a dry compose) and is re-fetched when the
compare control changes — it is the one header cell that may read
*checked just now*.

**Layout.** Sub-header = the harness header: `PixelArt` top-left, name and
description beside it, and to the right the **two-by-three grid** — team ·
preflight (`ScaleTag preflight`) · model provider · security groups
(`Related{groups}`) · **reach** · file count — all
three blocks one height. The reach cell is `HarnessView.reach` in the same
words as the *Applies here* line below it (*allow-list, 3 hosts · set by
Organisation*): one fact said twice on one screen must be said the same way.
It replaces the *Outside endpoints* `ScaleTag`, which read `Grant.reach` —
retired by engine 01 D132, so that cell had become a constant *prohibited*.
Directly below, on one line: the compare control — a
`Segmented` over `HarnessView.versions` plus the client-side *Differences*
option (03 D32) — and beside it the Files / History / Requests `Segmented`
(`?view`). Sub-sidebar (the `Screen` aside at the **end**): **Applies here** (D86) —
what holds on this harness wherever it runs, in three parts: the **reach**
line (*Reach: allow-list, 6 hosts*, with *set by Marketing* under it — the
aside is one narrow column and one clipped sentence is worse than two
readable ones; *Reach: not set* where the response carries none), the
**boundaries** covering it **in full**
(P17), and the **security groups** whose grants cover it. Each is a link to
the screen that sets it for a viewer with `Viewer.adminHere` and plain text
for everyone else, because a link that can only refuse is worse than plain
text (P13). Then the **Commands** button. Content: the flat file table.

**Columns (`HarnessFileRow`).**

| Heading | Type | Sort |
| --- | --- | --- |
| Type | `Chip` of the kind word, wrapped in `Word` (P8) — a kind is data, not a scale (01 D68) | yes |
| Name | text, link to the file | default |
| Last editor | text (`lastEditor.name`) — follows the selected version (P12) | yes |
| Their note | text (`lastEditor.note`) | no |
| When | date (`lastEditor.at`) | yes |
| Differences only: Differs | text: *yours only* · *theirs only* · *both* · *conflict* — plain text, not a `ScaleTag` (a comparison state is not a scale; `ScaleTag` is the only pill, 01 §7.2); the column exists in this view alone (P12) | yes |

History view: one row per version — plain sentence, files touched beneath,
short hash `Chip` with the full hash as title; the selected version decides
whose history. *Differences* is hidden in History (PRD §17.2).

**Verbs by role.**

| Verb | Member | Team admin | Org admin | Endpoint / note |
| --- | --- | --- | --- | --- |
| Switch version / view | yes | yes (+ one entry per member) | yes | URL only (`?version`, `?view`) |
| Offer everything · Take the team's for everything | Differences view only | same | same | these are CLI verbs; the console shows the exact commands from the sheet (P9) and links nothing else — decided D40 |
| Open Commands sheet | yes | yes | yes | `CommandSheet` (P14) |
| Promote a file (reading `as` a member) | — | yes | yes | `POST /v1/requests { …, as }` then `POST /v1/requests/{id}/accept` — one flow (00 §4.11) |
| Edit name / description / drawing | own harnesses | team's and own | any | `PATCH /v1/harnesses/{id}` |
| Delete | own | team's and own — confirm: *This removes the harness and nothing in it: N files keep their history* | any | `DELETE /v1/harnesses/{id}` |

`PermissionNotCleared` for edit/delete on a harness the viewer does not own:
*Changing a team harness is a team admin's decision.*

**States.** Loading: header skeleton + eight row skeletons. Empty (a harness
with no files): *Nothing in it yet. Add files from your work tree with
`harness push`, or from the team's with `harness reset <key>`* (with the
sheet link). Error: server message + remedy. Hidden: if
`Viewer.visibility.boundaries === false`, the sub-sidebar's Boundaries block
is `HiddenView`: *An organisation admin has turned off this view* (P10).
Stale: n/a here (see §7).

**Not on it.** A per-file state column (PRD §17.2); a merge button; a
branch dropdown (it is a compare control); any conflict marker outside
Differences; org-wide boundaries repeated per row (they are in the
sidebar list, once — PRD §15).

**Tests.** `header_grid_is_two_by_three` · `compare_control_sized_by_role` ·
`differs_column_only_in_differences` ·
`member_sees_mine_team_differences_only` · `team_admin_sees_member_versions` ·
`editor_column_follows_version` · `conflict_badge_only_in_differences` ·
`differences_hidden_in_history` · `history_follows_selected_version` ·
`bulk_verbs_only_in_differences` · `boundaries_listed_in_full_in_sidebar` · `applies_here_links_only_for_an_admin` ·
`applies_here_says_the_mode_and_the_level_that_set_it` ·
`applies_here_names_the_harness_when_the_harness_set_its_own_reach` ·
`harness_view_reach_is_the_chain_narrowed_by_the_harness` (backend) ·
`boundaries_hidden_view_names_decision` · `org_file_all_versions_identical_note` ·
`edit_refused_names_team_admin` · `delete_confirm_states_file_count` ·
`commands_button_opens_sheet` · `repository_empty_state_links_sheet`.

---

## 6. File — PRD §17.2, §18

**Route.** `/console/[scope]/harnesses/[id]/files/[assetId]?version=&as=`.
All scopes.

**Data.** `GET /v1/console/harnesses/{id}/files/{assetId}?version=&as=` →
`FileView`. Content and history come via `api` from `definitions` (00 D8).
Server-fetched; nothing observed.

**Layout.** Sub-header: breadcrumb `← <harness>`, path as title, and the
**owner line first** (PRD §17.1): *Organisation file — nothing below the
organisation can change it* · *Team file — you may offer changes* · *Yours —
on your branch only* · *<Member>'s — on their branch only*. Sub-sidebar (the
`Screen` aside at the **start**): the harness's file list (the same
`HarnessFileRow` table, compact) so files are one click apart. Content:
(a) if `differs === "conflict"`: `Compare` with `content.mine` left and
`content.team` right, `FileView.diff` beneath it in `Diff`, and the three
outs as commands — *keep mine* · *take theirs* · *edit by hand* — each a
`CommandBlock` from the sheet (D40); (b) else the file, and beneath it *What
changed* as a plain sentence with `Disclosure` *View as git* showing
`FileView.diff` (P9) — every hunk is server-produced (00 D8, 01 D66); (c)
History from both copies, each row labelled `mine` / `team`.

**Columns (history).** Version · `Chip` short hash; Branch · text; Who ·
text; When · date; Message · text. Sorted newest first.

**Verbs by role.**

| Verb | Member | Team admin | Org admin | Endpoint / note |
| --- | --- | --- | --- | --- |
| View as git | yes | yes | yes | `Disclosure` |
| Offer to the team / Keep as mine / Take the team's / three outs | shown as commands | same | same | CLI (D40) |
| Promote this file (reading `as`) | — | yes | yes | as §5 |
| Withdraw the open request on it | author | author | author | `POST /v1/requests/{id}/withdraw` |

**States.** Loading: sub-header + content skeleton. Empty content
(`content.mine === null && content.team === null`): *This id is assigned
but nothing answers it on your chain* (engine C18) — the row is shown,
never hidden. Error: server message. Hidden: n/a. Stale: an
open request on this file whose team copy moved shows *the team's copy has
since changed* beside *proposed*, in the two-column form (PRD §17.3).

**Not on it.** An editor. A merge. A per-file settings panel. Groups or
boundaries (they are on the harness).

**Tests.** `owner_line_is_first` · `owner_line_per_owner_value` ·
`conflict_renders_two_columns_and_three_outs` · `view_as_git_shows_hunk_ref_commit` ·
`history_from_both_copies_labelled` · `assigned_but_unresolved_is_shown` ·
`stale_request_shows_two_columns` · `file_sidebar_lists_siblings`.

---

## 7. Requests panel and Request — PRD §17.3

**Route.** Panel: `/console/[scope]/harnesses/[id]?view=requests&state=open|closed`.
Request: `/console/[scope]/harnesses/[id]/requests/[rid]`. All scopes.

**Data.** `GET /v1/console/harnesses/{id}/requests?state=` → `RequestView[]`;
`GET /v1/console/requests/{rid}` → `RequestView`. `verbs` come from the
server (K8). Nothing observed.

**Layout.** Panel: Open / Closed filter (a segmented control, `?state`),
then a list — one `Line` per request: title, `<author> · <n> files`, and
in Closed the outcome word in the same line (*· declined*). **No state
badge** (PRD §17.3). Request page: sub-header = title, author, file count,
reasoning as the lede. Content: **two columns** — the body, one `Card` per
file with path, `+added −removed` `Tally`, and the `Diff` (added green,
removed red, the line carries the colour; hunks from `RequestView.files[*].diff`,
server-produced); and the `Screen` aside at the **end**, sticky within the
content scroll: the discussion thread, the decision (when closed) with its
reason, and the verb buttons. Stale files carry *proposed* beside *the team's copy
has since changed* in the two-column form.

**Columns (panel rows).** Title · text; Author · text; Files · number; When
· date; Closed only: Outcome · text in the line, not a tag.

**Verbs by role.**

| Verb | Member | Team admin | Org admin | Endpoint |
| --- | --- | --- | --- | --- |
| Accept all *n* | — | yes; confirm names the team: *Publishes n files to everyone on <team>* | yes | `POST /v1/requests/{id}/accept { reason? }` |
| Decline | — | yes; reason required | yes | `POST /v1/requests/{id}/decline { reason }` |
| Comment | yes | yes | yes | `POST /v1/requests/{id}/comments { text }` |
| Withdraw | author only | author only | author only | `POST /v1/requests/{id}/withdraw` |

`PermissionNotCleared` where Accept/Decline would be, for a member:
*Accepting a request publishes it to everyone on <team>, so a team admin
decides it.* — plus Withdraw if theirs (PRD §17.3 verbatim).

**States.** Loading: list skeleton / two-column skeleton. Empty open: *Nothing
waiting. Offer a change with `harness offer`.* Empty closed: *No decisions
yet.* Error: server message. Hidden: n/a. Stale: per file, as above.

**Not on it.** State badges; a thread per file (one discussion per request);
a *settled* filter; a merge affordance.

**Tests.** `requests_open_closed_no_badge` · `closed_row_carries_outcome_in_line` ·
`request_two_columns_discussion_right` · `accept_confirm_names_team` ·
`request_decline_requires_reason` · `member_sees_permission_not_cleared_with_withdraw` ·
`author_can_withdraw_only_open` · `stale_file_two_column_form` ·
`one_discussion_per_request` · `requests_empty_open_names_offer`.

---

## 8. Security groups — PRD §15, §18

**Bar.** No tabs; the grant count, the collapsing search (`?q=`, which was
the table's own filter box) and the one verb the level has (D99).

**Route.** `/console/[scope]/groups` and `/groups/[name]`. Org: full list,
create. Team: the groups granted to it, **Narrow to a sub-team**. Me: read
— the groups covering the person, with the entries they resolve.

**Data.** `GET /v1/console/groups`, `GET /v1/console/grants`,
`GET /v1/console/groups/{name}` (with `EdgeWalk`). Writes: `POST /v1/grants`
(narrow), `POST /v1/groups` (org), `PATCH /v1/groups/{name}` (org).
Observed at draw: nothing in the list; on the group page, each entry's
vault `probe()` as a `Fact` *checked just now* (P2).

**Layout.** Sub-header: title, count, search, **New group** (org) / **Narrow
to a sub-team** (team). Content: one table of **grants** — a group grant
and an outside-endpoints grant are rows in the same table, told apart by
the *Gives* column (PRD §8: *a grant whose payload is reach*). Group page:
entries table, then *Granted to* (`Related{teams}`), *Only for*
(`Related{harnesses}`), *Narrowed from* (link), then `EdgeWalk` — *What
rests on this* (harnesses, assets by alias) and *What this rests on*
(secrets, vaults).

**Columns (`GrantRow`).**

| Heading | Type | Sort |
| --- | --- | --- |
| Group | text, link (or *Outside endpoints* for a reach grant) | default |
| Gives | text: *n entries* · *reach beyond grants* | no |
| Sources | text: *vault only* · *vault or local*, with the `Word` hover — not a `ScaleTag` (D41: `source` is where a credential came from; `sources` is a rule) | no |
| Granted to teams | `Related{teams}`, `all: true` → *All teams* (P4) | yes |
| Only for harnesses | `Related{harnesses}` or *every harness they own* | no |
| Narrowed from | link to the parent grant, or — | no |
| By | text (author) · When · date | yes |

**Columns (entries, group page).** Alias · `Chip`; Secret · text (`ref`);
Vault · text; Upstream · text; Ready · `FactCell<boolean>` observed. The row
carries `entries` as `policy/groups.json` holds them (03 §4.5), so *Add an
entry* can send the held ones back unchanged.

**Verbs by role.**

| Verb | Member | Team admin | Org admin | Endpoint |
| --- | --- | --- | --- | --- |
| Narrow to a sub-team (modal: pick sub-team; untick entries; live sentence *<Sub-team> will be able to resolve crm. They will not get email.*; **Create the grant**) | — | yes, from grants the team holds | yes | `POST /v1/grants { group, scope, narrowedFrom, aliases }` |
| Create a group (a named set — it may start with no entries; the first one comes after) / add an entry / change sources | — | — | yes | `POST /v1/groups`, `PATCH /v1/groups/{name}` |
| Revoke a grant (confirm shows the harnesses that stop resolving — from `EdgeWalk.restedOnBy`) | — | own narrowed grants | any | `DELETE /v1/grants/{id}` |

`PermissionNotCleared` (team admin on create): *Creating a security group,
or adding an entry to one, is an organisation admin's decision. Narrowing
what <team> already holds covers most of what people ask for.* (member on
narrow): *Narrowing a group into a sub-team is a team admin's decision.*

**States.** Loading: table skeleton. Empty (team): *<Team> holds no security
groups yet. An organisation admin grants them.* Error: server message.
Hidden: n/a (groups are never hidden from those they cover). Stale: n/a.

**Not on it.** A hygiene or rotation-age column (PRD §6.5). A per-person
row. A boundary (they are a separate object — PRD §7).

**Tests.** `grants_table_mixes_group_and_reach_rows` · `all_teams_renders_word_not_list` ·
`narrow_modal_cannot_add_entry` · `narrow_preview_sentence_updates` ·
`narrow_creates_grant_with_narrowed_from` · `revoke_confirm_lists_breaking_harnesses` ·
`team_admin_create_group_not_cleared` · `member_narrow_not_cleared` ·
`group_page_edge_walk_is_directed` · `entry_ready_is_observed_fact` ·
`no_hygiene_column`.

---

## 9. Boundaries — PRD §7, §15, §16

**Routes.** `/console/[scope]/boundaries/{reach,commands,files}`, and
`/console/[scope]/boundaries` redirects to **Reach** (W6-D8, D98). Three
tabs, because *how far does a session go*, *what may it never run* and *what
may it never read* are three questions with three answers, and one long page
made the person scroll past two of them to reach theirs. The tabs are routes
(02 rule 16) and the sidebar row stays **Boundaries**. They are the bar's
tabs (D99), **Add a boundary** is the bar's verb, and the three tab
sentences are the screen's readme.

All scopes; listed **in full** everywhere (P17). A personal account reaches
this screen from the sidebar, because reach lives here and the person is
their own organisation admin (07 §3, W5-D6).

**Data.** `GET /v1/console/boundaries?scope=` → `BoundaryRow[]`, read once
per tab and filtered by `lib/views/boundaries.ts`'s `tabOf`;
`GET /v1/console/reach?scope=` → `ReachView` on Reach;
`GET /v1/console/boundaries/suggested?scope=` → `SuggestedCommands` on
Commands (W6-D10). Writes: `POST /v1/boundaries`,
`DELETE /v1/boundaries/{id}` (own scope only); `PUT /v1/reach?scope=`,
`POST /v1/reach/hosts?scope=`, `DELETE /v1/reach/hosts/{host}?scope=`.
Nothing observed.

**Which tab a row is on.** The three deny kinds place themselves: `endpoint`
is Reach, `command` is Commands, `filesystem` is Files. The **capability**
kind names a built-in rather than a thing, so it goes under the tab whose
vocabulary its value is in — a value naming a path (`/…`, `~/…`, `./…`,
`filesystem.*`) under Files, one naming a command (`process.exec`,
`tool.<name>`, `shell`) under Commands, and everything else under Reach,
which is where the screen opens. One function, `tabOf`, and the plan's own
words for it are *until it has a better home*.

**Layout, the same on every tab.** Sub-header (title, lede per scope, **Add
a boundary** for an admin of this level, opening on the tab's own kind), the
tab strip, then — on Reach only — the Reach section (§9.1), then the two
blocks:

1. **Inherited** — every row that reaches this level from above, read-only
   whoever is looking, each naming the level that set it. A boundary is
   lifted where it was set, so an organisation admin lifts the
   organisation's at the organisation; there is no block in which lifting
   the row above you is a verb. Nothing above means the block says so rather
   than drawing an empty table.
2. **Set here** — this level's own rows, with **Remove** per row for an
   admin of it, and on Commands the starter adds below them. At *me* outside
   the personal edition this block is empty by construction: a person sets no
   boundary of their own, and every row they see is inherited.

`_table.tsx` is the row component for both blocks: they are the same rows
filtered, not two designs.

**The Holds cell on a command row** (W6-D9). A command boundary is never
`enforced` — the runtime refuses the call as it is made, because nothing
outside the runtime can see a command line before it runs (engine 06 §13) —
so the cell is the `intercepted` tag with *by Pi and Claude Code* under it,
or *by Pi* where Claude Code's own matcher cannot hold the pattern, with the
reason on hover (engine 07 §8.1: it matches each subcommand on its own, so a
pattern with a pipe or an `&&` in it never fires there). The row never claims
a refusal nobody measured.

**Columns (`BoundaryRow`).**

| Heading | Type | Sort |
| --- | --- | --- |
| Kind | text: endpoint · command · filesystem · capability | yes |
| Value | `Mono` | default |
| Holds | `ScaleTag holds`, plus *by …* on a command row | yes |
| Applies to | `Related{teams}` / *All teams*; Only for `Related{harnesses}` | no |
| Set by | text: the node's name, link | yes |
| Reason | text | no |
| When | date | yes |

**Verbs by role.**

| Verb | Member | Team admin | Org admin | Endpoint |
| --- | --- | --- | --- | --- |
| Add (form: kind — the tab's own — value, holds, scope within own subtree, reason required) | — | yes | yes | `POST /v1/boundaries` |
| Add a suggested command (one click, the preset's reason travels with it) | — | yes | yes | `POST /v1/boundaries` |
| Remove | — | own team's only | org's and any | `DELETE /v1/boundaries/{id}` |
| Set the reach mode | — | own node's | own node's | `PUT /v1/reach?scope=` |
| Add a host (typed, or one click from *Suggested*) | — | own node's | own node's | `POST /v1/reach/hosts?scope=` |
| Remove a host | — | own node's | own node's | `DELETE /v1/reach/hosts/{host}?scope=` |

A member reads the Reach section and sets nothing: `ReachView.canEdit` is the
server's answer and the console never computes it from a role name (P13).
`viewer.adminHere` is the same answer for the two blocks.

On the add form, `holds` is **not** a choice for a command: the field is read
only and says *intercepted — the runtime refuses the call as it is made*,
because `api` refuses `enforced` on the kind. A pattern that denies every
command there is (`*` alone) is said beside the field as it is typed, in the
sentence `api` would refuse with — said, never a disabled button (P13, 02
rule 21).

`PermissionNotCleared` (team admin on an org boundary): *Lifting an
organisation boundary is nobody's decision below the organisation.
Boundaries only ever tighten on the way down.* (member on add): *Adding a
boundary is a team admin's decision.*

**States.** Loading: table skeleton. Empty: *No boundaries. The agent may
reach whatever its grants allow* — with the reach sentence per PRD §8.
Error: server message. **Hidden** (`Viewer.visibility.boundaries === false`
at `me`): the blocks are `HiddenView` and the tabs and the Reach section
stay: *An organisation admin has turned off your view of boundaries. Ask
<admin> why a refusal happened.* (P10).

**Not on it.** A summary sentence in place of the list (PRD §16). Allowlists
(a boundary is a deny). A per-person boundary.

**Tests.** `boundaries_listed_in_full_at_every_scope` ·
`boundary_tabs_are_three_routes_under_the_scope` ·
`boundaries_inherited_is_read_only_and_set_here_is_not` ·
`boundaries_at_the_top_of_the_chain_inherit_nothing` ·
`boundaries_set_here_is_empty_and_unactionable_for_a_member` ·
`a_command_row_says_which_runtime_intercepts_it` ·
`add_from_the_commands_tab_posts_a_command_at_this_level` ·
`a_pattern_that_denies_everything_is_said_where_it_is_typed` ·
`the_command_starter_set_is_one_click_each_and_never_offered_twice` ·
`remove_boundary_deletes` · `boundaries_hidden_view_whole_table` ·
`boundaries_redirect` (V1: the bare route sends every scope to Reach) ·
`add_boundary_scope_limited_to_subtree` ·
`a_command_boundary_is_intercepted_and_not_a_choice` ·
`the_command_starter_set_is_offered_under_set_here` (V3) ·
`reach_mode_puts_the_whole_file_at_the_scope` ·
`reach_adds_a_host_from_the_field_and_from_the_suggested_list` ·
`reach_removes_a_host_at_the_scope` ·
`reach_widening_shows_the_servers_sentence_in_place` ·
`reach_is_read_only_without_canEdit` · `reach_not_set_here_offers_the_modes_and_no_list`
(V2, at the network) · `reach_line_says_the_mode_and_who_set_it` (V1).

**Budget.** The three tabs are three route directories over one `_screen.tsx`
(the fetch, the header, the tab strip) and one `_blocks.tsx` (the two
blocks), so the split that 02 rule 36 would have forced on the old single
page is the split the tabs wanted anyway. Reach keeps `_reach.tsx`, now
inside `boundaries/reach/`, which is also what `presets/index.json`'s three
reach entries name as their `screen`.

### 9.1 Reach — W5-D5, engine 01 D131

A boundary is a deny; reach is how far a session goes before a deny is even
asked. It sits above the table because it is the question a person arrives
with, and the boundaries are the exceptions to its answer.

Three parts, in the order they are read:

1. **Inherited** — one line per node above this one that holds a
   `policy/reach.json`, walk root first: *Organisation: allow-list, 3 hosts*.
   The level's own word, never a dotted path (01 §4.4). Under them, the
   composed answer: *In effect here: allow-list, 3 hosts · set by
   Organisation*. At the top of the walk there is nothing inherited and the
   section says so instead, because repeating the radio below would be noise.
2. **At this level** — the mode as three radio choices, one sentence each
   (*Off* · *An allow-list* · *On, with a deny-list*), then this node's own
   host list with **Add** and **Remove**. A node that holds no file of its
   own has **no mode chosen and no list**: the three writes all act on *that*
   node, so a list drawn from what was inherited would offer a Remove that
   removes nothing. The sentence says what it uses instead, and choosing a
   mode starts a file there.
3. **Suggested** — `ReachView.suggested`
   (`engine/compose/presets/reach-suggested.json`) as one-click adds, under
   `allow` only, each already-listed host reading *already allowed* rather
   than being offered twice.

`ReachView.canEdit` gates every control; without it the three parts render as
text under the chip's own *read and use* sentence, because how far your own
sessions reach is not an admin's privilege to know (engine D136). A narrowing
rule the server refuses — a widening (engine 01 D131) — is rendered in the server's own
sentence beside the control that caused it, never pre-empted by a disabled
control (P13, 02 rule 21).

A member reads the Reach section and sets nothing: `ReachView.canEdit` is the
server's answer and the console never computes it from a role name (P13).
The verbs, the refusals and the states are §9's, above: Reach is a tab of
that screen and not a screen of its own, and one table of verbs for the
three tabs is the point of them being one screen.

---

## 10. Providers — PRD §9, §15

**Route.** `/console/[scope]/providers` (harness providers),
`/providers/model`. Two tabs, not three: W6-D5 folded Routing into the model
provider row that owns it, and `/providers/routing` **redirects** to
`/providers/model`. Org: all verbs. Team: read, plus **choose the team's
default** within *approved for*. Me: read. The two tabs are the bar's
(D99) and the two ledes are the screen's readme.

**Data.** `GET /v1/console/providers/harness`, `/providers/model`,
`/routing` (read by the model tab for the two routing columns' subjects and
for the *By team* view). Writes: `PUT /v1/providers/harness/{id}` (approval,
scope, pin, `speaks`, `name`), `PUT /v1/providers/model/{id}`,
`DELETE /v1/providers/model/{id}?scope=org`, `PUT /v1/routing` (the whole
file; a team default is one cell of it). Observed at draw: on a model provider
row whose key is **held**, a HEAD on its endpoint with a three-second budget —
and only then (W6-D6).

**Layout.** Sub-header: title, the two tabs as routes, **Add** (org, model tab
only — a provider that is not a preset). Harness providers: a table that is a
**catalogue with switches** — every runtime the platform knows is a row from
the day the organisation exists (engine D30h), and the control is **in the
row**: an org admin's approval `Select` (approved · beta · not approved) with
the reason asked for inline when it becomes *not approved* or *beta*; scope
(*Approved for*) is edited in the same row. There is no picker modal: nothing
is chosen from a list that the table already is. Not-approved rows stay, with
their reason (PRD §9.1 — *not approved is a state*). The *Provider* column is
`HarnessProvider.name` (W6-D3) — *Pi*, *Claude Code* — falling back to the id.
Model providers: a table with one row per provider, its endpoints per wire
format, its **Status**, and what it is **Default for** and **Approved for**;
the presets are rows before any key exists, and a row without a credential
carries one verb, **Set up** — a modal with two fields, *paste the key* and
*default model*, that is `POST /v1/providers/model/{id}/setup` (engine
00 §4.10): the vault entry, the `model-keys` group, its grant to all teams and
the organisation-wide routing default in one write. The words *group*, *grant*
and *routing* do not appear in the modal; the Groups screen and this table's
own two columns show what it did. A **By team** toggle above the table swaps
the rows for the old routing matrix — rows teams / harnesses / runtimes, the
two column groups and what each team resolves to — as a **read** view of the
same routing (PRD §9.2); the team scope's matrix is its own row.

**Columns (`HarnessProviderRow`).** Provider · text (`name`, else the id);
Approval · `ScaleTag approval`; Approved for · `Related{teams}` / *All teams*;
Pin · `Mono` (commit or `binary ≥ version`); Speaks · text list of wire
formats; Reason · text; Decided by / When · text / date.
**Columns (`ModelProviderRow`).** Provider · text; Endpoints · one `Mono` per
wire format; Models · text list; Credential alias · `Chip` (or the *Set up*
verb); **Status** · `ScaleTag providerStatus`; **Default for** · the subjects
this provider serves by default, grouped by dimension (teams · harnesses ·
runtimes), with *Set default…* under them; **Approved for** · the same, each
with a **Remove**, and *Approve for…* under them.

**Status** (W6-D6 and W7-D2, the `providerStatus` scale, 03 §4.6):

| Value | When | What it means for the rest of the screen |
| --- | --- | --- |
| *set-up* | a credential alias is **held** — it appears in a security group entry whose vault id is one `api` has connected — **and** the endpoint answered a `HEAD` within three seconds | nothing special: the row routes |
| *sign-in* | no key is held, **and** a runtime this organisation lists and has not declined signs in to this provider itself (`modelNative`, engine 07 §6) | the row routes, on the person's own login: both verbs stay, `speaks_routed` is true, the cards keep their launch buttons and the broker opens the session marked *not metered* (engine 04 §5.3 step 5, engine 04 D156). The row says what that means where the keyless row says why it is out, and the screen carries the one honesty line below. *Set up* is still offered, because a key is what routes it through the harness |
| *needs-key* | no alias, or an alias no group entry holds, **and** no runtime signs in to it | the row is out: `PUT /v1/routing` refuses `provider.needs_key` naming the *Set up* verb, `console.speaks_routed` is false for it so it leaves `runners_for`, `canRun` and the harness cards' launch buttons, and the broker refuses a session routed to it with `broker.provider_needs_key`. The row says so where its two verbs would be |
| *unreachable* | held, but no answer in three seconds | routing stands, and so do the verbs: a provider that is down is not a provider that is misconfigured |

*Held* is read from the composed policy — a group entry and a connected
vault — and never a live secret fetch on a page load; the probe runs **only**
when a key is held, so a fresh organisation's three keyless presets cost no
network at all. A *sign-in* row is not probed either: the endpoint a native
session reaches is the provider's own, and whether it answers *us* says
nothing about that.

**The honesty line** (W7-D2, also in 05). Said once for the screen, whenever
any row reads *sign-in*: *On a sign-in session the request goes straight to
the provider over TLS, so provider-side browsing cannot be stripped. Reach on
the machine still holds: the harness's own network rules are unchanged. Add a
key to route it through the harness.* It replaces the first-run *no key is
connected yet, so a session has nowhere to send a request* line rather than
sitting under it, because that sentence stops being true the moment a runtime
can sign itself in.

**Verbs by role.**

| Verb | Member | Team admin | Org admin | Endpoint |
| --- | --- | --- | --- | --- |
| Approve / move to beta / decline (reason required for decline; in the row) | — | — | yes | `PUT /v1/providers/harness/{id}` |
| Set up (paste a key, pick a default model) on a row without a credential | — | — | yes | `POST /v1/providers/model/{id}/setup` |
| Set approval scope | — | — | yes | same |
| Add a model provider (name, endpoints per format, models, credential alias) | — | — | yes | `PUT /v1/providers/model/{id}` |
| **Set default…** (pick a team, a harness or a runtime) | — | own team only, within approved-for | any subject | `PUT /v1/routing` |
| **Approve for…** and the **Remove** on an approval | — | — | yes | `PUT /v1/routing` |
| **Delete** a model provider (confirm) | — | — | yes | `DELETE /v1/providers/model/{id}?scope=org` |

A team admin's *Set default…* opens with no dimension to pick and one subject,
their own team (D42: a select limited to allowed options is not a refusal);
*Approve for…*, the **Remove** and **Delete** are absent for them, because the
server refuses them `routing.not_yours` and `provider.org_admin_required`
(P13). `PermissionNotCleared` (team admin on approval): *Approving a runtime is
an organisation admin's decision: it decides whose program holds a credential
in memory.*

**States.** Loading: table skeletons. **First run** (the seeded state,
engine D30h — the tables are never empty for an organisation, so the checklist
item is a `Notice` above the table, from the rows the page already holds):
harness tab, when no row is *approved* — *No runtime is approved yet, so
nobody can start a session. Turn one on below.*; model tab, when no row has a
credential — *No key is connected yet, so a session has nowhere to send a
request. Set one up below.* Each disappears by being done (05 §12). **Set up**
is offered only on a row without a credential; the server refuses a second key
for the same row with `provider.credential_exists` and the sentence names *Key
vaults* as the place to rotate. **Delete** is refused `provider.in_use` while a
routing cell or a security group entry still names the provider, and the
refusal names them. Empty (a table with zero rows, which only a pre-seed
organisation can show): the `EMPTY.providers` / `EMPTY["providers.model"]`
sentences. Error: server message. Hidden: n/a.

**Not on it.** A harness→provider binding (PRD §9.3 — `canRunOn` is derived
and shown only as *cannot launch* on the harness). A *custom distributions*
object (prd-v2 §23, row 4). A Routing tab (W6-D5). A *Reachable* yes/no
(W6-D6). An *Approved for providers* column (D95).

**Tests.** `not_approved_rows_present_with_reason` · `approval_scope_is_related_teams` ·
`providers_decline_requires_reason` ·
`team_default_select_limited_to_approved` ·
`model_status_is_held_then_probed` ·
`a_provider_needing_a_key_is_excluded_and_says_why` ·
`routing_subjects_carry_a_word_never_an_id` ·
`model_provider_set_default_at_the_network` ·
`model_provider_approve_for_at_the_network` ·
`model_provider_remove_approval_at_the_network` ·
`delete_model_provider_at_the_network` ·
`delete_model_provider_shows_the_in_use_refusal` ·
`routing_by_team_toggle_reads_the_same_data` ·
`team_admin_sets_its_own_team_and_holds_no_other_verb` ·
`team_admin_approve_not_cleared`.

---

## 11. Key vaults — PRD §6.2, §6.7, §15

**Route.** `/console/[scope]/vaults`, `/vaults/[id]`. Org only (team/me:
not in the sidebar).

**Data.** `GET /v1/console/vaults`, `GET /v1/console/vaults/{id}/secrets`.
Writes: `POST /v1/vaults` (connect), `POST /v1/vaults/{id}/secrets`
(bundled vault only — paste a key), `POST /v1/vaults/{id}/secrets/{ref}/rotate`
(bundled only). Observed at draw: per vault, `probe()` for connectivity and
list permission; per secret, `probe()` readiness — all `Fact` *checked just
now*, stored nowhere.

**Layout.** Sub-header: title, **Connect a vault**. Content: one table of
vaults **including the person's own machine as a row** (PRD §6.2: no row
has a blank provider); its page states what we can and cannot do. Vault
page: secrets table browsed provider → group → secret (PRD §6.7), the
*Issues* / *Contents* columns (PRD §6.2 "vault columns say what they ask"),
and the two findings as filters: *nothing covers* and *points at a missing
secret*.

**Columns (`VaultRow`).** Vault · text; Connected · `Fact` (observed: *reachable now*); Hands us · text (*minted* or *stored*); Issues ·
text: *temporary credentials* · *stored values*; Contents · text: *we may
list* · *declared only*; Connected · `FactCell` observed; Groups · `Related{groups}`.
**Columns (`SecretRow`).** Secret · `Mono` (ref); Group (vault's own
grouping) · text; Reached by groups · `Related{groups}` (empty → the
*nothing covers* finding); Ready · `FactCell` observed; Last used · date
(recorded by us) — **no rotation age, no hygiene** (PRD §6.5).

**Verbs by role.**

| Verb | Org admin | Endpoint / note |
| --- | --- | --- |
| Connect a vault (provider, auth method, list permission requested with what it buys) | yes | `POST /v1/vaults` |
| Paste a key / rotate — **bundled vault only** | yes | `POST …/secrets`, `…/rotate` — on a customer vault these verbs are absent and the page **links out** (PRD §6.2: we never write to a customer's vault) |
| Disconnect (confirm lists groups that stop resolving) | yes | `DELETE /v1/vaults/{id}` |

Team admin / member never see this screen; a deep link renders
`PermissionNotCleared`: *Key vaults are an organisation admin's screen.*

**States.** Loading: skeleton. Empty (secrets, no list permission): *This
vault did not grant list permission. The console shows what an admin
declared and can show no more* (PRD §6.2 honest degradation). Error: server
message. Hidden: n/a.

**Not on it.** Rotation age, overdue flags, recommendations (PRD §6.5). Any
secret value or last4 in the table. Write verbs on a customer vault.

**Tests.** `machine_is_a_vault_row` · `customer_vault_has_no_write_verbs_links_out` ·
`bundled_vault_paste_and_rotate` · `no_list_permission_degrades_honestly` ·
`secret_nothing_covers_finding` · `secret_missing_pointer_finding` ·
`vault_probe_is_observed_fact` · `no_rotation_age_column` ·
`vaults_deep_link_not_cleared_for_team_admin`.

---

## 12. Assets — PRD §5.2, §15

**Route.** `/console/[scope]/assets`, `/assets/[id]`. **One screen at every
level** (W5-D9): at *You* the person's own copies, at a team the team's, at
the organisation the organisation's — always the copies that node holds, and
never a borrowed list. The verbs are the level admin's, and at *You* that is
always the person, so a personal account has the screen too (07 §3, amended).
The kind tabs and **Browse** are the bar's tabs, parted by a rule, with the
count beside them and one collapsing search (`?q=`) over whichever list is
open — the table's filter box and the store's are gone (D99).

**Data.** `GET /v1/console/assets?scope=`, `GET /v1/console/assets/{id}?scope=`
(with `EdgeWalk`). `console.asset_rows` reads one node — `scope_node(ctx)`:
the last node of the chain at `me` (not `ctx.scope_path`, which is the
organisation there), the scope's path at a team, the org path at the
organisation. The listing carries `kinds`, the organisation's
`policy/kinds.json` in its own order, beside `items`. Writes:
`PUT /v1/assets/{id}/loads { loads }` (org ref, 00 D9),
`PATCH /v1/assets/{id}?scope=` `{ name?, description? }` and
`DELETE /v1/assets/{id}?scope=` (WS3a). Nothing observed.

**Tabs.** One per kind in `policy/kinds.json` order, each with its count; a
kind with nothing on this branch still has a tab, greyed, reading `0`. A kind
the branch holds that the vocabulary does not name is a tab at the end, so
its rows are reachable. The open tab is **`?kind=`** — a query, not a route:
rule 16 makes a category a route when it is a *screen*, and these are one
table, one fetch and one set of verbs, filtered. With no `?kind=` the screen
opens on the first kind that has rows.

**Layout.** Sub-header: title *Assets*, the level chip (01 §7.5), the lede
for this level. Content: the tabs, the count, a filter box, the table.
Asset page: the sidecar facts, *Loads*, then the **reverse view** —
`Related{harnesses}` (*all harnesses* when always loaded, PRD §15),
`Related{teams}`, `Related{groups}` it needs — then `EdgeWalk`.

**Columns (`OrgAssetRow` — the model keeps its name).** Name · text (default
sort, the row's link); Description · text, from the sidecar's `description`
(WS3a); Loads · text, the word `loadsLabel()` returns — **Required** /
**Recommended** / **On request** (W5-D10); Used by · `Related{harnesses}` /
*all harnesses*; Last change · date. There is no Type column: the tab is the
kind. *Needs groups* stays on the asset page's reverse view, which is where a
person asks what a single asset needs.

**Three states, one vocabulary (W5-D10).** *Required* is in every session's
load set, cannot be taken out of a harness (`cli.asset_required`) and cannot
be deleted (`asset.required`); *Recommended* is copied into every new
harness's `assets` at creation and is an ordinary entry of it from then on;
*On request* is neither — published, and included by whoever builds the
harness. The three are the `loads` scale's registered values, so the asset
page's *Loads* fact is a `ScaleTag` and the table cell is the same word from
one function, `lib/views/assets.ts loadsLabel()`. The cell is a word and not
a tag because a table of twenty assets is not twenty tags.

The org-admin control on the asset page is a three-way `Segmented` posting
`required | recommended | on-request` to `PUT /v1/assets/{id}/loads`. Moving
to *required* confirms with what it takes (*Preflight will refuse to launch
any harness without it*); the other two take nothing away and commit on the
press. The route accepts `always` and `chosen` as aliases for one release —
`always` → `required`, `chosen` → `on-request` — and `loadsValue()` reads
them the same way for an index written before the split. Nothing in the
console sends the old words.

**Verbs by role.**

| Verb | Member | Team admin (own team) | Org admin | The person, at *You* | Endpoint |
| --- | --- | --- | --- | --- | --- |
| Edit (name, description) | no | yes, on the team's copy | yes, on the organisation's | yes, always | `PATCH /v1/assets/{id}?scope=` |
| Delete | no | yes, on the team's copy | yes, on the organisation's | yes, always | `DELETE /v1/assets/{id}?scope=` |
| Set *Required* / *Recommended* / *On request* (confirm for required: *Preflight will refuse to launch any harness without it*) | no | no | yes | yes (they are their own org admin) | `PUT /v1/assets/{id}/loads` |
| Tick a row in *Browse* and **Add to harness** | yes | yes | yes | yes | `POST /v1/harnesses/{id}/assets?scope=me` |
| Tick a row in *Browse* and **New harness from selection** | yes | yes | yes | yes | `POST /v1/harnesses { assets }` |

The two row verbs are rendered when `levelOf(scope, viewer).canEdit` — the
same fact the chip states, so a screen that says *read and use* never shows a
verb. Edit opens the library's dialog (01 §7.10; there is no drawer
component and this workstream added none) with the name and the description,
and sends only the fields that changed. Delete confirms with what it takes
(rule 22): the harnesses of the row's *used by*, named; *It loads into every
harness today, and would leave all of them* when the organisation always
loads it; *No harness lists it* when none does. A refusal — `asset.required`
for something every session loads, `asset.name_taken` for a rename that
collides — renders inside the dialog in the server's own words (rule 21),
because the dialog is on the top layer and a notice behind it would not be
seen. Team admin / member on the loads toggle: `PermissionNotCleared`, *How an
organisation asset loads is an organisation admin's decision.*

### Browse — the store (W5-D15)

**One more tab, at the end of the strip: `?tab=browse`.** The kinds answer
*what is on this branch*; Browse answers *what could I use*. It is a tab and
not a screen for the reason the kinds are (rule 16): one directory, one set
of verbs, one question asked two ways. It opens on **all kinds**, because a
person looking for something does not know its kind yet; the kinds are a
quieter filter inside it and still `?kind=`, so a link into one works.

**Data.** `GET /v1/console/assets/browse?scope=` → `{ items: BrowseRow[],
next }`, built in `console.browse_rows(ctx)` from `idx_effective` — the
*winning* copy of every asset the viewer can use, so a shadowed copy is not
offered twice — plus the bundled presets the organisation does not hold yet,
read from the directory the seed reads (`engine/compose/presets/assets`, the
only copy) and deduped against the same ids. The picker's harnesses are
`GET /v1/console/harnesses?scope=me`: the cards at *You*, which is what a
person may write.

**Columns (`BrowseRow`).** Type · text (the kind, because the list spans the
vocabulary); Name · text, linking to the asset page **at the level that holds
the copy** (`href`, `null` for a preset, which is on no branch); Description
· text; From · chip — the node's own name for the organisation and a team,
*you* and *preset* for the two the console has words for (the row carries
`level` and the console writes those two, rule 26); Yours · *On your branch*
when the viewer's own branch holds a copy. A checkbox leads each row.

**The bar.** It appears when something is ticked, sticky at the bottom, and
says how many. **Add to harness** opens a picker of the viewer's own
harnesses and posts `{ ids }` to `POST /v1/harnesses/{id}/assets?scope=me`:
the ids join *the person's version* of that harness — `harnesses/<id>.json`
on their own branch, created from the nearest copy on their chain when their
branch has none, the rule `joinHarness` follows (engine 08 §10.0 step 5a). A
preset is copied onto that branch in the same commit. An id already listed is
skipped in silence, and nothing to do is not a commit. **New harness from
selection** opens §4's own new-harness dialog with the ids in `assets`;
`POST /v1/harnesses` copies a preset among them the same way, through the
same helper. The dialog lives at `[scope]/_new-harness.tsx` because it now
has two callers (rule 2 allows a screen to read an ancestor's private part).

**A tool brings its environment.** A `tool` sidecar may carry
`needs: [{ kind: "environment", name }]` (engine 01 §5). Ticking that tool
ticks the environment of that name from the same list, and the confirmation
says so before the button is pressed: *Adds `environment/python-data`
because `tool/csv-summary` needs it.* The route does the same expansion
(`routes_writes._with_environments`), so the CLI reaching the same write gets
the same set; the console's half is telling the person first. An environment
nothing in the list answers is left out rather than invented.

**The store switch.** An organisation boundary `visibility.store: false`
hides the tab, and the route answers `hidden` in place of the list (P10) for
anyone who reaches the URL. It is the existing visibility mechanism —
`_visibility_of` in `console.py`, `Viewer.visibility`, `PATCH
/v1/org-units/{id}/visibility` — with a third key, default true, and a
personal account has it on. The switch is where the other two are, on the
person page's *What they can see* (§15), reading **Browse for assets**;
there is no visibility section on Boundaries to put it in. What the person
already holds is untouched: only the place to pick more from closes.

**Refusals.** `asset.unknown` — *Nothing on your chain, and nothing bundled,
answers that id* — for an id the viewer cannot use, raised before the harness
file is read, so nothing is written.

**The directory is over rule 36's ceiling and stays one screen**, because the
store is not a second screen: it is the same route, the same `page.tsx`, the
same verbs table and the same `?kind=`, and splitting it would mean two
directories that must agree about the tabs. The parts are the split — `_browse`,
`_selection-bar`, `_table`, `_tabs`, `_edit`, `_delete` — each well under it.

**States.** Loading: table skeleton. Empty: per level — *No organisation
assets yet. Anything here reaches every team.* / *Nothing on this team's
branch yet. What the organisation holds still reaches you.* / *Nothing on
your own branch yet. What your team and your organisation hold still reaches
you.* An empty **tab** shows the same sentence under the tabs, which stay.
Error: server message. Hidden: n/a.

**Not on it.** *required* / *optional* wording (retired, prd-v2 §25). An
owned/available toggle (retired). Edit of the asset's *content* (that is git,
via the CLI — Edit here is the name and the description only).

**Tests.** `assets_are_the_levels_own_copies` (backend, me/team/org) ·
`edit_asset_patches_only_what_changed_at_the_scope` ·
`delete_asset_names_the_harnesses_it_leaves_then_deletes` ·
`delete_asset_shows_the_servers_refusal_in_place` ·
`has_a_tab_per_declared_kind_empty_ones_included` ·
`opens_on_the_asked_kind_else_the_first_with_rows` ·
`writes_the_loads_word_in_one_place` (three states, W5-D10) ·
`set_loads_is_a_three_way_choice_posting_the_new_words` ·
`browse_lists_the_chain_and_the_presets_the_org_lacks` ·
`browse_offers_a_preset_once_the_chain_already_answers_it` ·
`browse_reads_the_environment_a_tool_needs` ·
`the_store_can_be_turned_off_for_a_person` ·
`a_search_hit_opens_the_level_that_holds_the_copy` ·
`add_to_harness_writes_the_persons_own_version` ·
`add_to_harness_copies_a_preset_in_the_same_commit` ·
`add_to_harness_skips_what_is_already_listed` ·
`add_to_harness_refuses_an_id_the_person_cannot_use` ·
`a_tool_brings_the_environment_its_sidecar_names` ·
`a_new_harness_from_a_preset_copies_it_too` ·
`add_to_harness_posts_the_ticked_ids_to_the_persons_version` ·
`new_harness_from_selection_opens_the_screens_own_dialog` ·
`always_loaded_shows_all_harnesses_word` · `asset_reverse_view_three_related` ·
`set_always_loaded_confirm_text` · `asset_edge_walk_directed`.

---

## 13. Sessions — engine 04 §6, 00 D7

The founder's window on the backbone. New; no PRD section.

**Route.** `/console/[scope]/logs/sessions`, `/logs/sessions/[id]` — the
**Sessions** tab of Logs (§14, D85). The old `/sessions` and `/sessions/[id]`
redirect onto it, query string and all. Org: all sessions. Team: sessions of
people in its subtree. Me: own. The three filters (`?person=`, `?harness=`,
`?status=`) are the bar's verbs rather than its search: they are three
parameters and one box could only guess which (D99).

**Data.** `GET /v1/console/sessions?person=&harness=&status=` →
`SessionRow[]`; `GET /v1/console/sessions/{id}` → `SessionView`. Write:
`POST /v1/sessions/{id}/revoke { reason }`. Observed at draw: for an
`active` session, `lastActiveAt` freshness is a `Fact` re-fetched every 15 s
(the supervise tick) so *Endpoints reached* fills while you watch.

**Layout.** List: sub-header with filters (person, harness, status), table.
Session page: sub-header = person · harness · provider `id version` ·
model · `ScaleTag session`; started / last active / closed. Content, in
this order, each a `Card`: (1) **Preflight report, whole** (P15) —
`ScaleTag preflight`, then blockers (each `Blocker.message` + `remedy` +
`link`), then drift rows (`Drift` file / expected / actual), then the
report's `choices` (provider, harness, model, grants) and its **reach**
line, read off `SpawnPlan.reach` — the mode, the host count and the level
that last narrowed it (engine D131); a report written before Plan says *not decided
yet* rather than guessing at `off`, in the CLI's own words;
(2) **Slots table**; (3) **Reach** — the composed reach first, then the
credentialed hosts and the deny list, each row naming the object that
decided it (PRD §7 *union computed on the harness*);
(3a) **Refused by a boundary**, *when there is one* — W6-D9's
`SessionView.refusals`: tool, what was attempted, the boundary, the level
that set it, when. A command boundary is `intercepted`, which means the
runtime refuses the call as it is made (engine 06 §13), so the proxy log
never sees it and the tally below never counts it: this card is the whole
record that the boundary did its job. Only the refusals — a session makes
hundreds of tool calls and none of the rest is a record of anything a person
has to look up — and the card is absent when there are none, because an
empty one reads like a feature that failed;
(4) **Endpoints reached** —
`EndpointTally` table; (5) **Definitions** — `commits`: one row per ref
with its commit as `Chip`, linking to the log; (6) revoke reason when
present. A native session's model row reads **not metered** (P16), never
`0`.

**Columns (`SessionRow`).** Person · text; Harness · text link (or —);
Provider · text `id version`; Model · text; Status · `ScaleTag session`;
Started · date (default sort, newest); Last active · `FactCell` observed for
active; Endpoints · text *reached n · refused m*.
**Columns (slots).** Need · text (`credential:<alias>` · `asset:<name>` ·
`login:<tool>`); State · `ScaleTag slot`; Evidence · `ScaleTag evidence`;
Resolved from · text from `ResolvedFrom` (*group <g> via grant <id> · vault
<v>* · *local: gh* · —); Via · text (`via.group`, `via.sources`) when
deferred; Blocker · message + remedy when present.
**Columns (refusals, W6-D9).** Tool · text; What was attempted · text (the
runtime's own plain sentence); Boundary · text (its id; the pattern and the
reason are on Boundaries → Commands, §9); Set by · the level's own word;
When · date. No sort: a session's refusals are a handful, in the order they
happened, and that order is the thing.

**Verbs by role.**

| Verb | Member | Team admin | Org admin | Endpoint |
| --- | --- | --- | --- | --- |
| Open a session | own | subtree | any | route |
| Revoke (reason required; confirm: *The session's proxy will refuse every credential and the provider will be stopped within one tick*) | — | subtree | any | `POST /v1/sessions/{id}/revoke { reason }` |
| Open the harness / the log row | yes | yes | yes | links |

`PermissionNotCleared` (member on revoke): *Revoking a session is a team
admin's decision. Close it yourself with Ctrl-C.* The endpoint itself also accepts the
session's owner (engine 00 §4.10) — that is the CLI's own close path, not a
console verb.

**States.** Loading: skeleton per card. Empty list (me): *No sessions yet.
`harness run` starts one and it appears here before the provider starts.*
Session with `preflight === null` (pre-D7 CLI): the report card reads *This
session's CLI did not post its preflight report; slots and endpoints are
still recorded.* Error: server message. **Hidden** (`Viewer.visibility.logs
=== false` at `me`): the endpoints card is `HiddenView` naming the decision;
slots and preflight stay (they are the person's own configuration, not a
log). Stale: n/a.

**Not on it.** Any credential value, alias value, or secret `last4`. Token
counts for a native session (P16). A transcript (we do not have it — PRD
§6.7, engine 05 §9).

**Tests.** `session_appears_before_provider_starts` (V4) ·
`session_page_preflight_report_whole` · `blockers_show_message_remedy_link` ·
`slots_table_state_evidence_resolved_from_via` · `reach_rows_name_deciding_object` ·
`endpoints_tally_fills_on_tick` · `native_session_reads_not_metered` ·
`commits_link_to_log` · `revoke_requires_reason_and_names_effect` ·
`member_revoke_not_cleared` · `session_without_report_says_so` ·
`endpoints_hidden_view_keeps_slots` · `no_value_string_anywhere_on_session_page`.

---

## 14. Logs — PRD §19

**Logs is one page with tabs, and the tabs are routes** (D85). In order:
**Changes** (`/logs/changes` — the `harness` category, retitled: pushes and
pulls on the branches you can see), **Sessions** (`/logs/sessions`, §13),
**Endpoints** (`/logs/endpoints`), and, only for a viewer with
`Viewer.adminHere`, **Permissions** · **Providers** · **People**
(`/logs/permission` · `/logs/provider` · `/logs/people`). They are the
bar's tabs, with the rows' filter box as its collapsing search (`?q=`) and
the three tab sentences in the screen's readme (D99). A personal account
reads the first three under the same title: there is nobody else to
administer, so the other three never appear (07 §3).
`tabs(base, viewer)` in `lib/views/logs.ts` is the one list.

**Route.** `/console/[scope]/logs/[category]` with `category` ∈ `changes` ·
`permission` · `provider` · `people`, plus the static `/logs/sessions`,
`/logs/sessions/[id]` and `/logs/endpoints`. `changes` is the route's word
and `harness` stays the category `api` answers to. Two redirects keep the
old addresses working: `/logs/harness` → `/logs/changes`, and `/sessions`,
`/sessions/[id]` → `/logs/sessions[/id]`. All scopes, filtered to the scope
(team: its subtree; me: rows about the person).

**Data.** `GET /v1/console/logs/{category}?scope=&cursor=` → `LogRow[]`;
`GET /v1/console/endpoints?scope=` → `EndpointRow[]`. Write (the Endpoints
tab's **Allow**): `POST /v1/reach/hosts?scope=`. Nothing observed.

**Layout.** Sub-header: the title *Logs*, the level chip, the tab's own
lede. Below it the tabs as routes, a date range, search. Content: table;
each row expands (`Disclosure`) to the diff for
git-backed rows (P9 *view as git*). Endpoints: the attempts table
(§14.1); a row expands to the sessions and harnesses behind it, its port
and alias, and the log row that explains a new endpoint where one exists
(PRD §19's join).

**Columns (`LogRow`).** When · date (default, newest); Who · text; Team ·
text; What · `sentence` (plain words, built by `03`'s rule); Action · `Mono`
(the audit action) — shown on hover/expand, not as a column at `me`; Diff ·
`Disclosure`.
**Verbs by role.** On the log tabs, none but *view as git* and *open*
(links). On Endpoints, **Allow** (§14.1). Export is Later (SIEM, out of
scope).

### 14.1 Endpoints — the attempts log (engine 05 §6a, engine D133, engine D136)

Every refusal says which rule refused it and who owns that rule, so a
refusal is something a person can act on rather than a mystery (P11). The
server groups one row per `(host, port, alias, outcome, reason, setBy)`: a
host refused for two reasons is two things to do something about.

**Columns (`EndpointRow`).**

| Heading | Type | Sort |
| --- | --- | --- |
| Host | `Mono`, `Disclosure` onto the sessions, harnesses, port and alias | yes |
| Outcome | `Chip`: *reached* · *refused* · *stripped* — what happened, not a registered scale (D41's reasoning; a `ScaleTag` throws on a value no scale registers) | yes |
| Reason | text, in plain words (03 §6.2's table); a reason the console does not know prints as it came | no |
| Set by | text: the level's own word, or the harness's name for `harness:<id>` — never a dotted path or a uuid | yes |
| Count | number | yes |
| First / Last | date (`Last` the default sort, newest first) | yes |
| Sessions | number, a link to the session when the row groups exactly one | yes |
| Allow | the verb, or the sentence that replaces it | no |

**The Allow rule.** A refused row carries **Allow** when
`EndpointRow.allow.can` — the viewer administers the node in `setBy` and
reach there is not `off`. It writes `POST /v1/reach/hosts?scope=<allow.scope>`
against that node: under `allow` the host is added to the list, under `on` it
comes off the deny-list, and the person does not have to know which. On
success the row reads *allowed for the next session* — the honest tense,
because a session already running keeps the plan it started with — and the
screen refetches. Where `allow.can` is false the cell is `allow.why`, the
server's one sentence naming who decides instead (*Reach is off for
{node}; turn it on under Boundaries → Reach.*), rendered as text and never as
a disabled button (P13). A row that is not a refusal has no cell at all.

**States.** Loading: skeleton rows. Empty: *Nothing recorded yet for <scope>.*
Error: server message. **Hidden** (`Viewer.visibility.logs === false` at
`me`): every log tab is `HiddenView` naming the decision (P10).

**Not on it.** Agent-reported activity (PRD §25). A single "everything" log
(one per category is the design). Editing.

**Tests.** `tabs_are_routes_three_for_everyone_three_for_an_admin` ·
`changes_is_the_harness_category_under_another_name` ·
`old_sessions_and_logs_harness_addresses_redirect` (by hand: the three are
`307`s carrying the query string; there is no screen suite to hold it yet) ·
`log_row_sentence_plain_words` ·
`git_backed_row_expands_to_diff` · `endpoint_row_expands_to_sessions_and_explaining_log` ·
`endpoint_reason_in_plain_words` · `allow_writes_the_host_at_the_node_that_refused` ·
`allow_shows_the_servers_refusal_in_place` ·
`logs_filtered_to_scope` · `logs_hidden_view_every_tab` · `logs_empty_names_scope`.

---

## 15. People and teams — PRD §12, §18

**Route.** `/console/[scope]/people`, `/people/[id]`, `/teams`. Org: all
verbs. Team: invite, remove, sub-team, role requests. Me: redirects to
`/account` (§17).

**Bar.** No tabs; the collapsing search (`?q=`, which was the table's own
filter box) and the invite verbs (D99).

**Data.** `GET /v1/console/people`, `/people/{id}`, `/people/{id}/removal`
→ `RemovalPreview`, `/teams` → `TeamRow[]`. Writes: existing
`/v1/invites`, `/v1/org-units/…` (sub-team, membership), roles routes,
`PATCH /v1/org-units/{id}/visibility` (org), `POST /v1/requests` with a
role subject (00 §4.4, §4.11; D43), accept/decline of a role request
(org admin). Nothing observed.

**Layout.** People: sub-header with **Invite**, **New sub-team** (team/org),
search; table. Teams: a tree **collapsed to the top level** (PRD §12), each
row: what it sits inside, what sits inside it, people, groups. Person page:
teams, role, sessions link, **Remove** with the `RemovalPreview` confirm.
A card *Waiting on an organisation admin* lists role requests with the
admin they wait on (team scope) and with Accept / Decline (org scope).
A card *Not yours to change* (team scope) enumerates the four items PRD
§12 names, each with who decides.

**Columns (`PersonRow`).** Name · text (default); Email · text; Teams ·
`Related{teams}`; Role · `ScaleTag role`; State · text: active · invited ·
deactivated; Last active · date. An invited row carries `invite` and no `id`,
which is what withdrawing it names (`DELETE /v1/invites/{id}`); the person
page's visibility switch reads the detail's own `visibility`, not the
viewer's. *What they can see* is **three** checkboxes — Boundaries, Logs and
**Browse for assets** (`store`, W5-D15, the Assets screen's *Browse* tab) —
each one key of `PATCH /v1/org-units/{id}/visibility`, each default on, and
each turning a view off without taking away anything already held.
**Columns (`TeamRow`).** Team · text tree; Inside · text; Contains ·
`Related{teams}`; People · number; Groups · `Related{groups}`; Admins ·
`Related{people}`.

**Verbs by role.**

| Verb | Member | Team admin | Org admin | Endpoint |
| --- | --- | --- | --- | --- |
| Invite to a team | — | own team | any | `POST /v1/invites` |
| Remove (confirm = `RemovalPreview`: groups lost, shared keys to rotate) | — | own team | any | `DELETE /v1/org-units/{team}/members/{id}` |
| New sub-team (dialog: name, who; the notice that it starts empty and inherits, and that keeping something from it means placing it elsewhere — PRD §5.4) | — | yes | yes | `POST /v1/org-units { kind: team, parent, name, members }` |
| Ask to be a team admin | yes | yes | — | `POST /v1/requests { subject: { kind: "role", level: "team-admin", team } }` (D43) |
| Appoint / revoke a team admin; accept or decline a role request | — | — | yes | roles routes; `POST /v1/requests/{id}/accept\|decline` |
| Deactivate | — | — | yes | `PATCH /v1/people/{id} { state }` |
| Visibility switch (boundaries, logs, store) for a person or team | — | — | yes | `PATCH /v1/org-units/{id}/visibility` |

`PermissionNotCleared` (team admin on appoint): *Appointing a team admin is
an organisation admin's decision. Anyone may ask; the request appears above.*
(member on invite): *Inviting is a team admin's decision.*

**States.** Loading: table skeleton. Empty (people, team): *Nobody here
yet. Invite someone; adding them to the team is the grant.* Error: server
message. Hidden: n/a.

**Not on it.** A per-person permission list (PRD §12). A disuse warning or a
no-admin nag (prd-v2 §25). A flat team list (tree, collapsed).

**Tests.** `teams_tree_collapsed_to_top_level` · `removal_confirm_shows_preview` ·
`sub_team_dialog_three_fields_and_notice` · `role_request_waits_on_named_admin` ·
`org_admin_accepts_role_request` · `team_admin_appoint_not_cleared` ·
`member_invite_not_cleared` · `visibility_switch_org_only` ·
`not_yours_to_change_lists_four` · `no_per_person_permission_list`.

---

## 16. How this works — PRD §14, 05

**Route.** `/console/how#<scaleId>` — outside `[scope]`, one URL for every tag's link (00 §5, K4). The sidebar links to it from every scope.

**Data.** `GET /v1/console/how` → `ScaleRegistry` + `05`'s content.

**Layout.** Sub-sidebar (the `Screen` aside at the start): one entry per
`ScaleId` and one per vocabulary word (`05`); then **Set up** (§16.1), above
everything, and a search box below it filtering by word (05 §9). Content:
for each scale, its values in order with
`ScaleTag` rendered and the one-line meaning; for each word, its definition
and where it appears. Every `ScaleTag` on the console links here with the
scale's anchor (K4); the page is the destination, so it never links back to
a legend.

**Columns.** Value · `ScaleTag`; Means · text; Seen on · `Related` of
screens (links).

**Verbs.** Generate a token → `POST /v1/personal-access-tokens`, in *Set up*
and nowhere else on this page (§16.1).

**States.** Loading: skeleton. Empty: impossible (the registry is static);
error: server message. *Set up* carries its own refusal beside the button
(02 rule 21) and the rest of the page is unaffected by it.

**Not on it.** Screen commentary (P8 — vocabulary, not screens). Prose
between the reference sections (05 D54 — *Set up* is instructions above the
reference, not prose inside it).

**Tests.** `every_registered_scale_has_anchor` · `every_scale_tag_links_to_how` (V2, run
over every screen's rendered tags) · `how_word_lists_where_seen` · §16.1's four.

### 16.1 Set up — D105

The first thing on the page, above the filter box, and the only part of it
that is per viewer: what a person who has just signed up does next, on the
page every other screen already links to. Three numbered `CommandBlock`s,
each with its own copy button, in the order they are pasted:

| # | Command | Where the string comes from |
| --- | --- | --- |
| 1 | the one install command (W7-D6) | `INSTALL_COMMAND` in `lib/views/account.ts`, the one source of truth |
| 2 | `harness login --api-url <origin> --token <token>` | the sheet's `harness login` row (D40) plus `HARNESS_API_ORIGIN` and the minted token |
| 3 | `harness setup` | the sheet's row (engine 08 §11.17) |

Then one line — *Then open a harness from the Harnesses page.* — which names
a screen, not a fourth command.

**The token.** Step 2's slot reads `<token>` and the block carries a
**Generate a token** button. It posts `{ name: "console setup <date>" }` and
writes the raw value straight into the line, because the line is what the
person pastes and a token on its own is half of one. The raw value is in
that response and nowhere else, so the button is **replaced** by *This is the
only time it is shown; generate another if you lose it.*, the section holds
it until the page is left, nothing is stored (P2), and there is no
`router.refresh()` — it would take the value away. The request is
`lib/pat.ts`'s, shared with the Account card's *Create an access token*
(§17): one fetch path, one shape.

**The origin.** `HARNESS_API_ORIGIN` is server-only (02 D23), so the page
reads it and hands it down; the browser has only the `/v1` rewrite and cannot
know the address the CLI should dial. **A deployed console must set it to the
public API URL.** Unset, the line prints `<your API URL>`: a localhost
default would be a line that runs and reaches the wrong machine.

**Who sees it.** Every viewer, personal and enterprise alike — a team member
installs the CLI the same way an owner does.

**Not on it.** A fourth command. A second copy of any of the three (§17.1's
first two rows link here). A token that is listed, re-shown, named by hand or
kept anywhere.

**Tests.** `setup_is_three_commands_and_a_token_slot` ·
`setup_generates_a_token_and_writes_it_into_the_login_line_once` ·
`setup_asks_for_an_origin_rather_than_printing_a_localhost` ·
`setup_shows_the_servers_refusal_beside_the_button`.

---

## 17. Account — PRD §18

**Route.** `/console/me/account`. Me only; `/console/me/people` redirects here.

**Data.** `GET /v1/console/me` (`Viewer`), `GET /v1/console/people/{me}`,
and the person's logins as observed facts — **not** probed by the console
(it cannot see the machine): they come from the last session's `Slot`s of
kind `login` (`GET /v1/console/sessions?person=me&limit=1`), labelled
*as of your last session*. Writes: `POST /v1/requests` with a role subject (D43).

**Layout.** Cards, in order: **Getting started** (personal only, W7-D5/D100 —
below); **Your teams** (`Related{teams}` with role);
**Logins on your machine** — one row per `login` need seen in the last
session: tool, `ScaleTag slot`, and for a missing one the command that
creates it (from the sheet); **Who can see your versions** — the honesty
line (PRD §18): *<Admin> can see your versions. As <team>'s admin, they can
open your branch and promote something you have not offered. Said here so
you never find out by accident*; **Ask** — the one request a member may
make: *Ask to be a <team> admin*, with reason; **Sessions** link.

**Columns (logins).** Tool · text; Present · `ScaleTag slot`; As of · date;
Create it · `CommandBlock`.

**Verbs.** Ask to be a team admin → `POST /v1/requests` with a role subject (D43); Sign out.

**States.** Loading: card skeletons. No session yet: the logins card reads
*Run `harness preflight` once and this fills in.* Error: server message.
Hidden: n/a (the honesty line is never hidden — it is the point).

**Not on it.** Anything editable about permissions. A theme picker beyond
the two themes (00 D4).

**Tests.** `account_honesty_line_names_admin_and_team` · `logins_from_last_session_labelled_as_of` ·
`missing_login_shows_create_command` · `ask_to_be_admin_opens_request` ·
`no_session_yet_names_preflight`.

### 17.1 Getting started — W7-D5, D100

The first card on a **personal** account, and nothing at all on an
enterprise one (an admin's first hour is `first-hour-admin.md`'s and
`harness setup`'s). Four rows in the order they are done, each either a tick
with the fact that closed it or the step with **exactly one** thing on it —
and for the first two that one thing is a link, not a command (D105): the
install line and the `harness login` line are printed under *Set up* on *How
this works*, where the server can hand the origin down and a token can be
minted into the line, and a command in two places is two commands the day
one of them changes.

| Step | Closed when | Unclosed shows |
| --- | --- | --- |
| Install the CLI | `setup.installed` — a `harness_sessions` row exists for this person | **How to install** → `/console/how#setup` (§16.1, D105) |
| Sign in | `setup.loggedIn` — a `personal_access_tokens` row exists | **How to sign in** → the same section, which prints the whole `harness login` line with a token on it (§16.1, D105) |
| A model | `setup.model !== null` (W7-D2 — `key` or `sign-in`) | **Set up** → `/console/me/providers/model`, and one sentence: *Or sign in to Claude or ChatGPT inside Pi with `harness auth pi`.* |
| First harness | `setup.harness` — a harness on the chain (the seed writes none) | **New harness** → `/console/me/harnesses` |

**Data.** `Viewer.setup: { installed, loggedIn, model: "key" \| "sign-in" \| null, harness }`
on `GET /v1/console/me`, derived per read by `console.setup_facts` in one
statement. Nothing is stored and nothing is ticked off: the list cannot
disagree with what has happened.

**States.** All four closed → the card is **absent**, not complete
(`gettingStarted()` answers `null`). Enterprise → absent. `setup` missing
from an older server → nothing done, so the list appears.

**Not on it.** A button that performs a step: three of the four happen on
the person's machine (D40). A progress bar. A *skip* or *dismiss* — the list
dismisses itself.

**Tests.** `getting_started_is_four_rows_of_one_thing_each` ·
`getting_started_checks_what_is_done_and_asks_for_the_rest` ·
`getting_started_hides_itself_when_all_four_are_done` ·
`getting_started_is_absent_for_an_enterprise_account` ·
backend `setup_facts_are_the_four_things_the_person_has_done`.

---

## 18. Cross-cutting

**The compare control.** A `Segmented` (01 §7.9) over `HarnessView.versions`
plus a client-side *Differences* option (03 D32 — not in `versions`, not an
endpoint value); the URL (`?version`) is the state. Rules: a member's
options are exactly `mine · team · differences`; a team admin's add
`member:<id>` per member of the team, labelled by name; `differences`
always means *the selected version against the team's*; in History view
`differences` is removed from the control; for an organisation file all
options render the same content and a one-line note says so. Selecting a
`member:` option sets `?as=` on child routes.

**The `?as` banner.** When `as` is set, a strip above the content:
*Reading <Name>'s branch · they have not offered these; you can take one
anyway* with exactly one action, **Promote a file**, which opens the file
picker and runs the request-then-accept flow (00 §4.11). `push`/`offer`
verbs are never shown under `as` (engine 08 D103).

**The Commands sheet.** `CommandSheet` (01 §7) is a `Modal` rendering the shared
table (`content/commands.generated.ts`, 05 §6, P14) — the same rows `harness commands`
prints — each row a plain description and a `CommandBlock` with copy. Any
screen that mentions a CLI verb links to the sheet row by id rather than
restating the command (D40).

**`PermissionNotCleared` usage rule.** Where a verb would be, for a viewer
who lacks it, render the component with the sentence from that screen's
table above; never render a disabled button, never hide the space. The
sentence always names *who decides* (P13). Copy lives in `content/` (05).

**`HiddenView` usage rule.** Only for `Viewer.visibility` flags, only at
`me` scope, always the whole block, always the note from `content/empty.ts`
`HIDDEN` naming the decision and the org admin role (P10; 01 §7). Never used for role-based absence — that is
`PermissionNotCleared` or simple omission of a verb.

**`EdgeWalk` placement.** Only on object pages (group, secret, organisation
asset, harness provider, model provider), as the last two cards *What rests
on this* and *What this rests on*, never merged, never on list pages (P1).

**Observed facts.** Any `FactCell` with `provenance: "observed"` shows
*checked just now* on hover with `at`, re-fetches on focus/visibility
change, and is never persisted client-side beyond the render (P2).

**Confirmations.** A destructive verb confirms with a sentence naming what
it takes with it, computed server-side (`RemovalPreview`,
`EdgeWalk.restedOnBy`), never a generic *Are you sure?*.

---

## 19. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D40 | **Work-tree verbs are shown as commands, not buttons.** Offer / keep as mine / take the team's / the three outs act on the person's machine; the console shows the exact `CommandBlock` from the shared sheet and performs nothing. The only console-side promotion verb is accept (and the `as` flow), which acts on the server. | a console upload path for a person's files — rejected: it would make the console a second write path onto the person's branch (engine C31) |
| D41 | **A group's `sources` is text with a hover, not a `ScaleTag`.** `source` (where a credential came from) is a registered scale; `sources` (how far a group permits) is a rule with two values. Registering it as a scale would give two near-identical scale names (P3 one word one meaning). | adding a `sources` scale to `ScaleId` |
| D42 | **A select limited to allowed options is not a refusal.** The team default select lists only *approved for*; no `PermissionNotCleared` is rendered for options that do not exist. | rendering the full list with refusals per option |
| D43 | **A role request is the request primitive with a `subject`.** `POST /v1/requests` takes `subject: { kind: "promotion", paths, commit, harness? } \| { kind: "role", level: "team-admin", team }` (00 §4.4, §4.11; engine 00 §4.10). A role request has no files; its page shows the reasoning, the discussion and the decision, and its list row reads *asked to be a <team> admin*. | a separate `/v1/role-requests` — rejected: it is the same primitive (PRD §13) |
| D44 | **Sessions is a first-class screen at all three scopes**, not a tab of Logs. It is the observation surface for the engine and the founder's stated test instrument. Superseded by D85: the screen is unchanged, its address is now a tab of Logs. | folding it into Logs |
| D85 | **Logs is one page with tabs, and the tabs are routes** (§14). Changes · Sessions · Endpoints for everyone on the level, plus Permissions · Providers · People for an admin of it. Three top-level rows for one idea — where something was recorded — crowded the sidebar and hid the other four logs, so Sessions and Endpoints leave it (01 D83) and the old `/sessions`, `/sessions/[id]` and `/logs/harness` addresses redirect. Supersedes D44's placement, not the screen. The tab is **Endpoints**, not *Endpoints reached*: W5-D4 made the table every attempt — reached, refused and stripped — so the older name described only a third of its rows. | splitting Sessions back out |
| D86 | **A harness page says what applies to it** (§5): *Applies here* — reach, the covering boundaries, the covering security groups — links for an admin of the level, plain text for a member. *A refusal you cannot look up is a bug* (P17): the two reference lists were already there, unnamed, and reach was nowhere. | listing them without the reach line |
| D87 | **Changing the reach mode starts the list empty** (§9.1). `PUT /v1/reach` is the whole file, and an allow-list is not a deny-list: carrying one over as the other would turn *reach these three* into *reach anything but these three* in one click. Each radio's own sentence says the list starts empty, and the suggested hosts are one click each. | carrying the hosts across the mode change |
| D88 | **A level with no `reach.json` of its own shows no mode chosen and no host list** (§9.1). All three writes act on *that* node's file, so a list drawn from what was inherited would offer a **Remove** that removes nothing and an **Add** that silently forks the parent's list. The section says what the level uses instead; choosing a mode is what starts a file there. | pre-filling the inherited answer as if it were this level's |
| D89 | **An attempt's outcome is a `Chip`, not a `ScaleTag`** (§14.1). *reached* · *refused* · *stripped* is what happened to one request, not a scale of claim strength; registering a thirteenth scale for it is what D41 already refused, and `ScaleTag` throws on a value no scale registers. | a fourth outcome scale |
| D90 | **The card's launch buttons are a server field, and the page draws nothing else** (§4, W5-D13). `HarnessCard.runners: [{ id, name }]` is every harness provider not *not-approved*, scoped to this chain and this harness, whose `speaks` meets the routed model's `endpoints` — `console.runners_for`, sharing `speaks_routed` with the `/providers/harness` row's `canRun` so a button appears exactly where the broker would mint. *Beta* is a button: the organisation said *try it*, and the refusal, if there is one, is the broker's with its reason, not a web page's guess. The name was `RUNNER_NAMES`' because `HarnessProvider` had no display name — a contract gap, recorded, not invented per screen; W6-D3 put `name` on the contract and D97 deleted the map. | deriving the list in the page from `/providers/harness`, which would make the console a second composer (K2) |
| D91 | **The console states what the buttons do and never detects whether they will work** (§4, engine 08 D140). A page cannot see a registered link type; a probe would be a guess shown as a fact (P5). So one line under the grid — *Buttons open a terminal on this machine. Nothing happened? Install the CLI and run `harness setup`* — links the guide, which owns the five reasons. The guide is linked at its source address until the console serves the guides itself. | a timing hack that "detects" the handler and warns when it is wrong |
| D92 | **The store is a tab of Assets, and a browse row is its own type** (§12, W5-D15). `GET /v1/console/assets/browse?scope=` answers `BrowseRow[]` — the winning copy of every asset `idx_effective` gives the viewer, plus the bundled presets no id on the chain answers, read from the directory the seed reads. Not a cut-down `OrgAssetRow`: an asset row answers *what is on this branch* and carries that branch's relationships; a browse row answers *what could I use*, so it carries the level the copy would come from, whether the person already holds one, and nothing else. The tab is `?tab=browse` and opens on all kinds, with `?kind=` still the filter inside it. | a Store screen of its own — rejected by rule 16: one directory, one fetch, one set of verbs; and by a second row type that would drift from the first |
| D93 | **Adding writes the person's version of the harness, and a tool brings its environment** (§12, W5-D15, engine 08 §10.0 step 5a). `POST /v1/harnesses/{id}/assets?scope=me { ids }` extends `harnesses/<id>.json` on the person's own branch, created from the nearest copy on their chain when their branch has none — the file and the rule `joinHarness` already uses, so the store and the terminal cannot write it two ways. A bundled preset is copied onto that branch in the same commit, by the helper `POST /v1/harnesses` shares, because a harness naming an id nothing answers is an unanswered row. A `tool` sidecar's `needs: [{ kind: "environment", name }]` adds that environment too, in the console *and* in the route: the console's copy exists to name it in the confirmation before the button is pressed, which a route cannot do. | the console computing the file and pushing it — rejected: that is the composer in the browser (K2); and expanding the environment only in the console, which would make the CLI's path different |
| D95 | **Routing is a column and two verbs, not a tab** (§10, W6-D5). Which model provider serves a team, a harness or a runtime is a *setting* on the provider that serves it, and a setting belongs where the thing it sets is read; what actually served a session is a record and is already on Logs → Sessions. So the Routing tab is a redirect, the row carries *Default for* and *Approved for* (data it already held — 03 §5.2), and *Set default…* / *Approve for…* write `routing.json` through the write that was already there. The old matrix survives as the **By team** read view, because an admin auditing *who resolves to what* reads rows per team, not per provider. The old *Approved for providers* column went with the tab: it showed `routing.approvedFor.providers` under a heading that called it derived, and it is one of the three dimensions the new column shows whole. | a Routing screen again — then the same fact lives in two places and the pair can disagree |
| D96 | **A model provider's Status is three states, not a yes/no** (§10, W6-D6). *Reachable* answered a question nobody asked: a preset with no key answered *no* and looked broken, and a provider with a key and a flaky endpoint answered *no* and looked the same. *set-up* · *needs-key* · *unreachable* name who acts — connect a key, or wait for an endpoint — and the exclusion follows the first of them, everywhere: the routing write, `speaks_routed`, `canRun`, the cards' launch buttons and the broker's step 5 all read `broker.needs_key`, so a row the console greys out is exactly a row the broker would refuse. *Held* is the composed policy (a group entry in a connected vault), never a secret fetch on a page load, and the probe runs only when a key is held. | a `reachable` boolean plus a second *has a key* column, which is the same two facts with no sentence between them |
| D97 | **The console reads the runtime's name from the contract** (§10, W6-D3). `HarnessProvider.name` ships in the preset and the seed, so `console.RUNNER_NAMES` — the two-entry map that sat beside `runners_for` — is deleted, and every place a runtime is named for a person (the Providers table, the cards' launch buttons, the routing subject picker) reads `provider.name` with the id as the fallback for a branch seeded before the field. | a second map in the console the day a third runtime ships |
| D98 | **Boundaries is three tabs of two blocks each** (§9, W6-D8). One page held reach, every deny on the chain, and a second table called *Set by the organisation* — so a person asking *what may this session never run?* scrolled past the host list and the file paths to find out, and a team admin could not tell at a glance which rows were theirs to lift. The tabs are the three questions (**Reach** · **Commands** · **Files**), the blocks are the two answers every one of them has (*Inherited*, read-only with the level that set each row; *Set here*, with add and remove), and the capability kind is placed by what its value names until it has a home of its own. Both blocks are `_table.tsx`: they are the same rows filtered. `boundaries/` redirects to Reach rather than 404ing, because the bare address is in the wild. | one page again — then the screen grows a fourth question and the person scrolls past three |
| D100 | **The setup list is four derived facts and it removes itself** (§17.1, W7-D5). `Viewer.setup` carries *has a session ever run* · *does a token exist* · *is there a model* · *is there a harness*, read in one statement per `/v1/console/me` (`console.setup_facts`) — nothing is stored, so there is no state to tick, to reset, or to disagree with the thing it describes. Each unclosed row carries exactly one command or one link, never both and never a button that does the step: three of the four happen on the person's machine (D40). `gettingStarted(viewer)` answers `null` for an enterprise account and for a personal one that has closed all four, so the card is absent rather than a list of ticks — a finished checklist is furniture (P8). | stored onboarding progress with a *dismiss* — then the list can be wrong and still be shown, and *dismissed* becomes a fifth state nobody can see |
| D103 | **A fourth status, because *no key* and *no way in* are different sentences** (§10, W7-D2; amends D96, which had three). D96's point was that *needs a key* and *did not answer* send a person to two different places, and the same argument makes a third: a keyless provider the organisation's own runtime logs itself in to sends them nowhere at all — it already works. *sign-in* is that row, and it is `accent`, not `warn`, because nothing is wrong with it. The exclusion still follows the broker exactly: `needs_key ∧ ¬signs_in` is what drops a row from the two routing verbs, from `speaks_routed`, from `canRun` and from the cards, and it is what the broker refuses at step 5 (engine 04 D156) — so the console still greys out exactly what the broker would refuse, which was D96's whole claim. What the screen owes in exchange is the one honesty line: a sign-in request never passes through the proxy, so the model shaping of W5-D3 cannot apply to it, and the screen says so once rather than letting *not metered* read as *free*. | a fourth column (*signs in itself*), which is the same two facts with no sentence between them — D96 refused that shape already; or leaving it *needs-key*, which tells a person to go and get a key they do not need |
| D102 | **The first-harness modal asks two things, and both are written on the harness** (§4, W7-D4). A personal viewer gets **Web access** — a switch, on by default — and **Outside keys** — a select of their own groups with *None* first and chosen — and one read-only line naming the model that will serve it (`Viewer.setup.model`, W7-D2), with the Providers link only where there is nothing yet. Three consequences the screen is built on. *First*, **on sends nothing**: absent `reach` is *inherit*, and a harness restating `on` narrows nothing today and becomes a `reach-widened` conflict that stops every session on the chain the day the organisation turns its reach down — so the switch is not symmetric, and engine D155 moved the personal default to `on` so that `off` is the one thing a harness can say. *Second*, **the grant is scoped to the harness and nothing else**, so the modal gives a harness keys without giving the person any they did not already hold; the file it lands in is the organisation's only because `policy/` is refused on a user branch. *Third*, **the dialog does not fetch** (01 rule 2): the groups arrive as a `personal` prop that the two screens mounting it build with `loadPersonalChoices`, which is also why *New harness from selection* asks the same two questions instead of growing a second form. An enterprise viewer has neither control and the body carries neither field. | asking a team viewer the same two — rejected: their reach is the organisation's and their keys are a grant an admin makes, so both controls would be refusals waiting to happen; and a *Reach* step after creation, which is a second screen for a one-word answer |
| D105 | **The three install commands are printed once, on *How this works*, with the token in the line** (§16.1, §17.1; W7-D5/D6's commands, one place). *Set up* opens that page with the install command, `harness login --api-url <this console's API origin> --token <token>` and `harness setup`, each a copy-able block, and a **Generate a token** button that mints one and writes it into the second line — shown once, held until the page is left, stored nowhere (P2). The origin is `HARNESS_API_ORIGIN`, read on the server and handed down (02 D23); a deployed console sets it to the public API URL and an unset one prints `<your API URL>` rather than a localhost that would reach the wrong machine. The Account rows that used to carry the first two commands now **link** here, and `harness login`'s own remedy and `docs/guide/first-session.md` name the same section, so the lines a person pastes exist in exactly one place. Amends D40 only in where a command is printed, not in that it is printed: it is still a command, never a button that does the step. | the token on the Account card and the bare `harness login` back on the row — then the person joins an address and a token by hand, and two screens print commands that have to stay equal |
| D45 | **The Account screen's logins come from the last session's slots**, labelled *as of*, because the console cannot probe a machine. | a browser-side probe — impossible |
| D46 | **Boundaries' `intercepted` option is present but disabled with *not yet*** until command interception ships (engine 06 §13), so the scale is complete on the How page and honest on the form. | hiding the value |
| D47 | **Not-approved providers are rows**, never filtered out by default. | a *show declined* toggle — rejected: PRD §9.1 |

## 20. Out of scope

The public site and its pages. SIEM export and any log export (Later). A
transcript viewer (no transcript exists). An in-browser editor for assets
(git, via the CLI). Budgets and quotas. Cross-organisation views. A
mobile-specific layout beyond the shell's collapse rule (01).

## 21. Definition of done

- Every screen in `00 §5` has a route file under `app/(console)/[scope]/`
  matching this document's route, under the 350-line ceiling (`00 §9`).
- Every named test in §4–§17 exists by that name and passes at V3 against
  the fixture index; `every_scale_tag_links_to_how` passes over every
  screen; `session_appears_before_provider_starts` passes at V4.
- Every `PermissionNotCleared` and `HiddenView` sentence in this document
  appears verbatim in `content/` (05) and nowhere else.
- Every column listed here has a `Column<Row>` in `03`; every row type named
  in §3 is defined in `03 §3`.
- `web/app/admin.tsx`, its panels, and the three `*-preview` directories are
  deleted in the milestones `00 §7` names; `grep -r "org-preview\|data.ts\|files.ts" web/app` returns nothing.
- No file under `app/(console)/` imports from `web/test/fixtures/`.
- Role requests open, list and decide through the same `RequestView` screens as promotion requests (D43).
