# Console Plan — 06 · Sequencing

The console lands in step with the engine, and each console milestone is
defined by one question: **what can the founder now observe and drive
through a screen that the engine made true?** Every row of the tables below
names the engine milestone it depends on, the console screens that land,
what becomes visible, which verbs work, and the Playwright test (V3/V4)
that proves it. A console milestone is done when its rows pass against a
real `api` and, from K-M2 on, a real `definitions`.

Console milestones are prefixed **K** to keep them distinct from the
engine's **M**. K-M*n* never requires engine M*n+1*.

| Console | Needs engine | Lands | Deletes |
| --- | --- | --- | --- |
| **K-M0** Foundations | M0 | shell, tokens, library, one data path, the generated-types pipeline, lint rules, test rig | `jade`/`leather`, `NEXT_PUBLIC_HARNESS_API_URL`, `lib/supabase.ts`, the duplicate components; prototype routes hidden from robots |
| **K-M1** The tree and the index | M2 | Harnesses (cards, repository, files), Organisation assets, People & teams (read), How this works | `admin.tsx` asset/harness panels; `org-preview` |
| **K-M2** Policy | M2 | Security groups, Boundaries, Providers, Key vaults, Logs (permission/provider/people) | remaining `admin.tsx` panels; `admin.tsx` itself; `lib/types.ts` |
| **K-M3** Sessions — and the **personal cut** (07 §5) | M3 | Sessions list and detail: slots, `resolved from`, evidence, the preflight report whole, endpoints tally; Logs (harness) | `team-preview`, `user-preview` |
| **K-M4** The fence, seen | M4 | refusals in Endpoints; reach table shows *enforced* (**done in W5** — engine D133, see K-M3); sandbox facts on the session | "not enforced yet" labels (**gone**) |
| **K-M5** Requests and verbs | M5 | Requests panel and request page; accept/decline/withdraw; narrow; sub-team; boundary add; removal preview; the command sheet from one table | — |
| **K-M6** Vaults | M6 | customer-vault rows: connected, reachable now, secrets listable; `minted` vs `stored` on slots | — |

---

## K-M0 · Foundations (needs engine M0)

**Lands.**
1. `app/(console)/shell/` — the fixed grid, header, sidebar, drawer, the
   `Screen` slots (01 §4); the route group `app/(console)/[scope]/…` with
   `[scope]` parsing (02 §2); an empty screen per route in 00 §5 rendering
   `EmptyState` with its sentence from `content/empty.ts` (05 §8).
2. Tokens (01 §5, D13) added to `globals.css`; themes reduced to two (D4);
   one public-path definition; the theme flash fixed (01 §10).
3. `app/(console)/ui/` — the component library (01 §7) with its V2 tests
   (01 §13); `ui.tsx` survives only for the public site and `auth.tsx` until
   K-M2.
4. One data path: `lib/api.ts` `request(path, token, init)`, `@supabase/ssr`
   cookie session, `middleware.ts` (02 §4, 02 D20); `lib/api.generated.ts`
   from a committed `openapi.json` with a drift check (D3, 02 D24) — the
   pipeline lands here; console-route types appear as 03's endpoints land;
   `lib/types.ts` itself goes at K-M2 with the last `admin.tsx` panel.
5. The lint rules of 02 §9 rule 28 — no `fetch` outside `lib/api.ts`, no
   prototype imports, no hard-coded `/console/` hrefs, no inline copy, no
   `window.confirm`, no arbitrary sizes — each with its failing test (02 §15).
6. The test rig (02 §10): vitest, Playwright component mode, Playwright
   screen tests against the real `api` on a scratch Postgres seeded from
   `engine/compose/fixtures/` (symlinked), CI on the same two runners the
   engine uses.
7. `robots.ts` disallows the prototype routes until they are deleted.

**Observable.** Nothing about the backbone yet. The founder can open every
route at every scope and see the shell hold still while an empty content
region scrolls — `shell_only_content_scrolls` at three breakpoints.

**Done.** 01 DoD (shell, tokens, library); 02 DoD; every route in 00 §5
resolves at every scope with the correct verbs hidden; no arbitrary font
size in `app/(console)/`.

---

## K-M1 · The tree and the index (needs engine M2)

The first milestone that reads the backbone. Engine M2 makes the definition
plane git and the index derived; this milestone lets the founder walk it.

**Lands.** `/v1/console/me`, `/harnesses`, `/harnesses/{id}`,
`/harnesses/{id}/files/{assetId}`, `/assets`, `/assets/{id}`, `/people`,
`/people/{id}`, `/teams`, `/edges`, `/how`, `/search` (03 §4); the screens Harnesses cards, Harness
repository (Files and History views; Requests view reads empty until K-M5),
File (owner line, content, history from both copies, the two-column compare
for a conflict), Organisation assets with `EdgeWalk`, People and teams
(read), How this works (05), the Account screen's teams and honesty line
(04 §17; its logins card fills at K-M3).

**Observable and drivable.**

| The founder can… | Which proves | Test |
| --- | --- | --- |
| Open `/console/me/harnesses` and see the cards their chain composes, no tags | compose over the index; K1 cards | `me_harness_cards_match_compose_fixture` |
| Open a harness and see every file with its **owner** — org, team, you — and open one to read the owner line first | branch precedence made visible | `file_owner_matches_winning_branch`, `owner_line_per_owner_value` |
| Switch **Your version · Team version · Differences** and watch the editor column follow | one work tree, three views | `editor_column_follows_version` |
| Push a change with the CLI, refresh, and see it under *Your version* and in *Differences*, not in *Team version* | the user branch is real and separate | `cli_push_appears_as_yours_only` (V4) |
| Open a file and read its history from both copies, labelled | `definitions` log through `api` (D8) | `history_from_both_copies_labelled` |
| Open an organisation asset and read *what rests on this* / *what this rests on* | the index stores edges | `asset_edge_walk_directed` |
| As a team admin, pick a member's branch in the compare control and see the `?as` banner; as a member, be refused | `readable` refs; `?as` authorisation | `as_member_requires_admin`, `as_banner_names_member` |
| Click any tag and land on its scale in *How this works* | K4 | `every_scale_tag_links_to_how` |
| Open Account and read who can see their versions, by name | admin sight is stated to the member (PRD §18) | `account_honesty_line_names_admin_and_team` |

**Deletes.** `admin.tsx`'s asset and harness panels, `asset-*.tsx`,
`harness-*.tsx`, `scope.tsx`; `org-preview/` in full (its fixtures move to
`web/test/fixtures/`).

**Done.** 04's Harnesses, File, Organisation assets, People (read), How and
Account sections' DoD; 03's endpoints for them with their authorisation tests;
`cli_push_appears_as_yours_only` green in CI against a real CLI.

---

## K-M2 · Policy (needs engine M2)

**Lands.** `/groups`, `/grants`, `/boundaries`, `/providers/*`, `/routing`,
`/vaults`, `/logs/{permission,provider,people}` (03 §4); the screens
Security groups (read; narrow lands K-M5), Boundaries (read; add lands
K-M5), Providers (read; approval and routing writes through the org-ref
commit helper, D9), Key vaults (read; the person's machine as a row), three
of the four change logs.

**Observable and drivable.**

| The founder can… | Which proves | Test |
| --- | --- | --- |
| See every group with *Granted to teams*, *Only for harnesses*, entries as alias → secret, and *sources* | policy files on the org branch, indexed | `groups_columns_from_index` |
| See an outside-endpoints grant in the same list, distinguished by *Gives* | one scoping primitive | `grants_table_mixes_group_and_reach_rows` |
| See boundaries in full with the node that set each; the org's cannot be lifted from a team | union down the chain; tighten-only | `boundaries_listed_in_full_at_every_scope`, `org_rows_have_no_remove_for_team_admin` |
| Approve a provider, set it to beta with a reason, and see the commit in the provider log with author and diff | write → `definitions:/internal/commit` → audit → log | `provider_approval_is_a_commit_with_diff` (V4) |
| Set a routing default for a team and see the matrix update | routing on the org branch | `routing_matrix_round_trips` |
| Read the permission log and find *who narrowed what from what* | `narrowedFrom` recorded | `permission_log_shows_narrowed_from` |

**Deletes.** The rest of `admin.tsx` and `model-default.tsx`; `admin.tsx`
is gone; `ui.tsx` reduced to what the public site and `auth.tsx` still use.

**Done.** 04's Security groups, Boundaries, Providers, Key vaults, Logs
sections' read paths; `admin.tsx` deleted.

---

## K-M3 · Sessions (needs engine M3)

The milestone the plan exists for. Engine M3 puts the key in the supervisor
and the credential in the proxy; this milestone shows the founder exactly
what a session was given and why.

**Lands.** `/sessions`, `/sessions/{id}`, `/logs/harness`, `/logs/endpoints`
(03 §4); the Sessions list and detail (04 §13); `PATCH /v1/sessions/{id}
{ preflight }` consumed (D7); the Account screen's logins card from the last
session's `login` slots (04 §17, 04 D45).

**Observable and drivable.**

| The founder can… | Which proves | Test |
| --- | --- | --- |
| Run `harness run pi` and see the session in `/console/me/sessions` before the provider starts | the session record | `session_appears_before_provider_starts` (V4) |
| Open it and read the **slots**: each alias, its state, its evidence, and *resolved from the Marketing group* — never a value | broker mint; `resolvedFrom`; engine I6 | `slots_table_state_evidence_resolved_from_via`, `no_value_string_anywhere_on_session_page`, `no_credential_value_in_any_response` (V4 sweep of every console response) |
| Read the **preflight report whole** — choices, blockers with remedies, drift, the reach table — as the CLI wrote it | D7; P15 | `session_page_preflight_report_whole`, `blockers_show_message_remedy_link` |
| Start a session the broker refuses (a vault-only alias with the vault down) and find the refusal in the harness log — a refusal opens no session, so it is a log row carrying the blocker's message (03 §4.4, §6) | fail closed at the broker | `refused_session_shows_blocker_remedy` |
| Watch **Endpoints reached** fill as the session runs, and see which session and harness reached each host | the proxy's authoritative log | `endpoints_tally_fills_on_tick` (V4), `endpoint_row_expands_to_sessions_and_explaining_log` |
| Rotate a key in the console and watch the alias read *retired* on the live session while the session continues | retire without revoke (engine 04 D61) | `rotation_retires_alias_live` |
| Narrow a grant covering a live session and watch the session read *revoked* with the reason | policy change ends the session (engine C33) | `policy_change_revokes_session` |
| See a native session read *not metered*, never zero | engine C22 | `native_session_reads_not_metered` |
| Read the reach table and see hosts, deny, outside, each naming what decided it | honesty about what the session was given | `reach_rows_name_deciding_object` |

**Reached early, W5.** The *not enforced yet* label is gone: the fence's
routing rule (engine D133) landed in wave 5, before this console milestone
was closed — `routable()` holds a session to `plan.hosts` and `plan.reach` and
`denied()` to `plan.deny`, and every refusal is a row in the Endpoints tab.
Every row on that card is therefore enforced, and the label was the one false
sentence on it. The card now reads *These are what the session was given, and
the proxy held it to them*, and `reach_labelled_not_enforced_before_m4`
becomes `reach_says_the_proxy_held_the_session`, which also asserts the old
words do not come back. This closes K-M4's **reach-table** clause only; its
sandbox facts and its *status* column on refusals are still ahead.

**Deletes.** `team-preview/`, `user-preview/`, `scope-app.tsx`, `files.ts`.

**Done.** 04's Sessions and Logs sections; the V4 rows above green in CI
with a real CLI session; no prototype route remains.

---

### The personal cut

K-M3 is also the first shippable edition: *Harness, personal* (07 §5) — a
person signs up, imports their Claude Code setup, adds their keys, runs a
session and reads it back. It needs nothing from K-M4 or K-M5 except
`harness import` and the exit review (engine M5), which are either pulled
forward or the cut waits — decided at engine M3 from what is green. Test
row: `signup_import_run_read_back` (V4).

## K-M4 · The fence, seen (needs engine M4)

**Lands.** No new screens. The session detail's reach table dropped *not
enforced yet* in wave 5 already, when engine D133 made every row on it
enforced (K-M3's note); what is left here is the rest. Endpoints shows
refusals with their status
(`denied`, `no-route`, `sni-mismatch`…); the session records the sandbox
facts the CLI posts in the report (mechanism, probes, the keychain limit on
macOS).

**Observable and drivable.**

| The founder can… | Which proves | Test |
| --- | --- | --- |
| Run a session that tries a denied host and see the refusal in Endpoints reached with `denied` | the proxy refuses; the log is authoritative | `denied_host_appears_as_refused` (V4) |
| See a session under *outside endpoints prohibited* reach only its credentialed hosts | derived reach | `prohibited_session_reaches_only_grants` |
| Read the six sandbox probes' results on the session | engine C26; probes recorded | `session_shows_probe_results` |
| See the honest keychain note on a macOS session | engine 06 D87 | `macos_session_notes_keychain_limit` |

**Done.** The *enforced* label appears only where engine 06 says it holds;
`homepage-promises.md` §4.3 can be marked earned by this milestone's tests.

---

## K-M5 · Requests and verbs (needs engine M5)

**Lands.** `/harnesses/{id}/requests`, `/requests/{id}`; `POST /v1/requests`
with both subjects (promotion and role — 00 §4.4), `/accept`, `/decline`,
`/comments`, `/withdraw`; narrow (`POST /v1/grants`), add/remove a boundary,
sub-team, invite, remove with preview, role request from People and Account,
visibility switch, create/edit/delete a harness, revoke a session; the
Commands modal from the shared sheet (P14).

**Observable and drivable.**

| The founder can… | Which proves | Test |
| --- | --- | --- |
| `harness offer` from the CLI and see the request open in the harness's Requests panel with its diffs | the request primitive | `cli_offer_opens_request` (V4) |
| Accept it as a team admin and see the file move to *Team version*; decline with a reason and find the reason in the closed list | accept = promote via `definitions:/internal/commit` | `accept_promotes_to_team`, `decline_records_reason` |
| Open the same request as a member and read *Permission not cleared* naming who decides | P13 | `member_sees_permission_not_cleared_with_withdraw` |
| Ask to be a Marketing admin from Account, see it waiting on the named org admin in People, and see it decided | one request primitive, two subjects (PRD §13) | `ask_to_be_admin_opens_request`, `role_request_waits_on_named_admin`, `org_admin_accepts_role_request` |
| Narrow a group into a sub-team with the one-sentence preview, then see the sub-team's members' next session mint only the kept aliases | narrowing; broker re-derivation | `narrowed_grant_limits_next_mint` (V4) |
| Create a sub-team, add a person, remove them and read what it takes with them | membership is the grant | `sub_team_dialog_three_fields_and_notice`, `removal_confirm_shows_preview` |
| Read a member's branch as a team admin and promote one file with the single verb | admin sight (PRD §18) | `promote_from_read_branch` |
| Open the Commands modal and `harness commands` and get the same text | P14 | `sheet_matches_cli` (05 §6) |

**Done.** 04's Requests, People (write), Security groups (narrow),
Boundaries (add) sections; every write in 00 §4.11 has its V3 test.

---

## K-M6 · Vaults (needs engine M6)

**Lands.** Vault rows show *connected*, *reachable now*, *issues*, *secrets
listable*; a vault's minted slots read `minted` with an expiry; the
secrets list under a vault when list permission exists, and the honest
*cannot list* note when it does not.

**Observable.** A session against AWS shows `minted` slots that expire with
it; the vault row says *verified*; the bundled vault row says *verified —
exists and decrypts* (engine 04 D67). Test `deep_vault_slot_reads_minted`.

---

## Tracks

| Track | Owns | Talks to |
| --- | --- | --- |
| **W · web** | 01, 02, 04, 05 | X for endpoints; the engine's Track A for `@harness/contracts` and the command sheet |
| **X · api console routes** | 03, `routes_console.py`, `domain/console.py`, the org-ref commit helper (D9), `remedy` in the envelope | engine Track B for the index reads and `definitions` internal reads (D8) |

Track W can build K-M0 entirely against fixtures before engine M0 is done.
Track X begins with 03's read model at engine M2 step 1 and is gated by the
index existing.

---

## Risk register

| Risk | Where | Mitigation |
| --- | --- | --- |
| Console-route OpenAPI drift | every K | committed `openapi.json` + CI drift check (02 D24) |
| A screen quietly reading fixtures in production | K-M1+ | eslint forbids imports from `test/`; K7 |
| Chrome regressions to page scroll | K-M0+ | `shell_only_content_scrolls` at three breakpoints in CI |
| The founder's V4 rows depend on a real CLI in CI | K-M1, K-M3, K-M5 | the engine's CI already runs `harness run pi` (engine 08 DoD); the console reuses that job |
| Two plans, one truth | all | every endpoint a screen calls is in 00 §4.10–4.11 and served by 03 §4; every type is in 00 §4 or engine 00 §4; the engine spine carries a pointer to the console's endpoints and the four cross-plan amendments (console D7, D8, `@harness/contracts`, two-subject requests) |

---

## Definition of done for the plan itself

Every row in the observability tables has a named test, and every named
test exists before its screen merges. The founder can open any console
milestone's table and, for each row, do the thing and see the result —
without a fixture, a flag, or an engineer explaining what they are looking
at.
