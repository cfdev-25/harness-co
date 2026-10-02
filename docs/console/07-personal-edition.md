# Console Plan — 07 · Personal edition

A personal account is an organisation with zero teams (`prd-v2.md` §12.1).
The engine does not know the difference; the console renders the same
screens and hides what has no meaning at *n* = 0 (00 K9, D14). This
document is the list of what that means per screen, the sign-up path, and
the cut that ships first.

## 1. Rules

1. **One codebase.** There is no `personal/` route group, no second shell,
   no component that takes `edition` as a prop. `Viewer.edition` is read in
   exactly two places: the sidebar's `navFor()` and each screen's verb table.
2. **Hidden, not disabled.** A screen or verb with no meaning at *n* = 0 is
   absent; nothing renders greyed. The person never sees the word *team*.
3. **The person is the org admin.** Every org-admin verb that has meaning
   with one person is available to them, under the plain name (*my keys*,
   not *security groups*; *what I block*, not *boundaries* — see §3).
4. **Upgrading is one verb.** *Create a team* on the People screen (which
   appears the moment it is used) turns the account into an enterprise one;
   nothing is migrated.
5. **Bring your own key is the default expectation.** Most personal users
   arrive with an OpenRouter, Anthropic or OpenAI key; the sign-up's key step
   names those three with upstream, header and wire formats prefilled from
   the engine's presets (engine 07 §11.0), so the person pastes a key and
   picks a model. One OpenRouter key runs both Pi and Claude Code. The
   provider's own sign-in (native mode) is the second path, offered on the
   same step as *or sign in with Claude Code / Pi instead*.

## 2. Sign-up and first run

| Step | What happens | Where |
| --- | --- | --- |
| Sign up | `/signup`, **two answers and a link** (W7-D1, D101, D101a): *Team or Personal* — two cards, one sentence each, and the organisation's name when it is a Team; *your email* — one field, which asks the auth provider to mail a sign-in link back to `/signup?finish=1` (`signInWithOtp`, `shouldCreateUser`). Email confirmation stays **on** and **the link is the confirmation**: nothing tells the person to confirm their address and sign in somewhere else, because the thing in their inbox signs them in. The page then says *Check your email — the link brings you back here.* and keeps step 1's answer in `localStorage` under `harness.signup`, because the account the link signs in has no organisation to read it off. `NEXT_PUBLIC_ALLOW_SIGNUP` is gone: the access code is the door, so `/login` is sign-in only (*New here? Create an account*) and the marketing pages' call to action points here | 02 §3, `app/signup/**` |
| Finish | the link lands on `/signup?finish=1`. Building the browser client is what reads the session out of that URL, and `getSession` waits for it — so the page asks the client, not the cookie, whether this is the last step. Step 3 is **the password and the access code on one form**: `auth.updateUser({ password })` first (the link signed the person in without one, and `/login` is a password), then `POST /v1/orgs`. Nothing remembered — another browser, cleared storage, or a sign-in that `AuthApp` sent back here — and step 3 asks *Team or Personal* again above the password. `?finish=1` with no session is said once: *That link did not sign you in…* and step 1 again. There is no second place an organisation can be made | `app/signup/signup.tsx` |
| The provider's two settings | the link's return address must be in the project's allowed redirect URLs (Supabase → Authentication → URL Configuration → Redirect URLs); `http://localhost:3000/signup?finish=1` already is. And the link is an email, so the mailer is now on the sign-up path: the built-in one is rate-limited per hour and answers `over_email_send_rate_limit`, which the page renders in place. Production wants custom SMTP (`next-steps.md`) | Supabase project settings |
| The code | one value in `api`'s environment, `HARNESS_SIGNUP_CODE`, compared **server-side** on `POST /v1/orgs` and nowhere else: that is the route that creates the organisation, so there is nothing for a client check to protect. Wrong, or unset: `403 signup.code_wrong`, *That access code is not right.*, with no hint and nothing created. The field stays open with the server's own words under it, and the password is **not** asked for a second time — it is already set, and asking again would be refused (`same_password`) | 00 §4.11, W7-D1 |
| Org created | `api` creates the organisation and the person's node in one `definitions:/internal/branches` call, grants org-admin, then seeds the org branch (engine D30h): every runtime **approved**, the three presets with no key, and one group `my-keys` with no entries granted to the org | engine D30f, engine D30h, engine 02 |
| First screen | `/console/me/harnesses`, empty: *Nothing here yet. Install the CLI and run `harness import claude` to bring what you already have, or `harness new` to start one.* | 05 `empty.ts` |
| Import | `harness import claude` (engine 07 §4a) → the first harness and its fidelity report; the console shows the report on the harness page once. Any other tool — Codex, Cursor, Gemini CLI, Aider — goes the agentic way: start a session and ask the assistant to extract the setup; the built-in `harness-authoring` skill (engine D30j) does it in the same carried / partial / dropped terms and the exit review adopts the result | engine 08 §11.19, engine D30j |
| Keys | **Set up** on a preset row of *Providers · model* (or `harness keys add openrouter`): *paste the key, choose a model* — `POST /v1/providers/model/{id}/setup`, the same write enterprise uses; the entry lands in `model-keys` in the bundled vault and the routing default is written under the org path (engine D30i). *Other* (a non-preset provider) is **Add** with the four fields, then Set up. The person never sees the words *group*, *grant* or *routing* | 04 Providers; engine 00 §4.10 |
| Run | `harness run pi` or `harness run claude`; the session appears in `/console/me/sessions` | 06 K-M3 |

## 3. Screens at *n* = 0

| Screen (00 §5) | Personal rendering | Hidden |
| --- | --- | --- |
| Harnesses | cards; *New harness*; *Import* button when no harness exists | team badge on cards |
| Harness | Files · History; compare control is **Your version** only (there is no team version) — the control is hidden when it has one option; the header's two-by-three grid loses *security groups* → *keys* and *team* → nothing (grid becomes 2×2: preflight, model, keys, files) | Requests view; `?version`; *offer*; the `?as` banner |
| File | content, history of your copy, *view as git* | the two-column compare (no other copy); conflict states |
| Security groups → **Keys** | one list: alias · upstream · vault (bundled or the person's own) · sources; *Add a key*, *Rotate*, *Remove* | granted-to, only-for, narrow, sub-teams |
| Boundaries → **What I block** | the personal deny list with *Add*; holds column stays | the node that set it (always you); org/team layers |
| Providers | harness providers all *available* (no approval scale shown); pin and version; model providers and one default | approval, scope, routing matrix (one row: the default) |
| Key vaults | the bundled vault and *connect your own* (AWS, Azure, HashiCorp, GCP, 1Password per engine 11) | — |
| Assets | present (W5-D9 supersedes *absent*): Assets is one screen at every level, and at *You* on a personal account it is the person's branch **and the organisation's** — the two nodes the chain has (D104). The seed writes `harness-authoring` and the brief on the org branch, and a personal account has no organisation scope to go and look at them on, so *Nothing on your own branch yet* was the screen hiding the only assets a new account had. Each row carries `level` (*org* or *me*), which is what tells a seeded copy from one the person has edited. The kind tabs, Edit and Delete are as they were. The old row read *absent — an org asset with one member is an asset*, which was true of the **organisation's** list and not of the person's | — |
| Sessions | identical to enterprise; the person's own | *revoke* by an admin (they are the admin: *end session* remains) |
| Logs | one log, *Changes*, plus *Endpoints reached* | the four categories (merged) |
| People | absent until *Create a team*, which lives under Account | the screen |
| How this works | identical; scales that never appear (role, request, approval) are still documented | — |
| Account | **Getting started** first, while it has anything to ask for (§3a, 04 §17.1, D100); then teams: *just you*; logins present; *Create a team* (the upgrade) | the honesty line about admin sight (nobody can) |

## 3a. The first hour — W7-D5, W7-D6, D100

An enterprise organisation's first hour belongs to its admin, and
`harness setup` and `docs/guide/first-hour-admin.md` already walk it. A
personal account has no admin to wait for and no runtime to approve, so its
first hour is four things in one place: the Account screen's *Getting
started* list (04 §17.1).

| Step | What the person does | Live state |
| --- | --- | --- |
| Install the CLI | **How to install** → *How this works* → *Set up*, which prints the one command — `scripts/install.sh` over `curl` (W7-D6): it checks `git` and Node ≥ 22 and says how to get either, clones to `~/.harness/cli`, builds the CLI and the vendored Pi runtime, links `harness`, and prints the three lines the person does next | `setup.installed` — a session has run |
| Sign in | **How to sign in** → *How this works* → *Set up*, which prints the whole `harness login` line and mints the token into it (04 §16.1, D105) | `setup.loggedIn` — a token exists |
| A model | **Set up** on *Providers · model* (W7-D3 — paste a key; on a personal account the same write makes it the default and grants it), **or** `harness auth pi` and Pi signs in to Claude or ChatGPT itself (W7-D2) | `setup.model` — `key`, `sign-in`, or `null` |
| First harness | **New harness**, which asks two things on a personal account (W7-D4) | `setup.harness` — a harness on the chain |

None of the four needs Security groups, Boundaries or Providers' permission
machinery, and the list removes itself when they are all closed (D100).
`docs/guide/first-session.md` is the same path written out.

The installer is the only path that is not a console screen, so it carries
the words itself: nothing is installed outside `$HOME`, there is no `sudo`,
and running it again updates in place. It does **not** build the console —
a person installing the CLI has no reason to build `web/`, which needs
environment they do not hold.

## 4. Endpoints

No new endpoints. `Viewer.edition` is derived by `api` from the org having
no team nodes, and W7-D5's `Viewer.setup` is four more derived facts on the
same answer (04 §17.1) rather than a screen's own read. `/v1/console/groups` returns the one group; `/v1/grants`
returns its one grant; the console renders them under the personal names.
Writes are the enterprise writes (00 §4.11) called by the same person as
org admin.

## 5. The personal cut

The first shippable edition. It needs fewer screens than enterprise and
none of the request or people machinery, so it ships at **K-M3** — the
milestone that gives sessions — as *Harness, personal*:

| Needs | From |
| --- | --- |
| shell, library, data path | K-M0 |
| Harnesses, Harness, File, How, Account | K-M1 |
| Keys, What I block, Providers, Key vaults (bundled) | K-M2 (personal rendering) |
| Sessions, Endpoints reached, Changes | K-M3 |
| `harness import`, exit review | engine M5 — pulled forward for the cut, or the cut waits; 06 decides at M3 |
| native mode | nothing — seed-and-harvest is built; the Keychain question was an enterprise org-mode concern (engine D11) |

Named tests: `personal_hides_team_vocabulary`, `personal_compare_control_hidden_with_one_option`,
`create_team_upgrades_without_migration`, `signup_creates_org_and_user`
(built as `the_right_code_creates_the_organisation` ·
`a_wrong_code_refuses_with_no_hint_and_creates_nothing` ·
`an_unset_code_refuses_every_sign_up` ·
`team_sign_up_is_an_enterprise_org_with_the_signer_as_its_admin` ·
`a_personal_organisation_is_named_after_the_person`, and in the component rig
`signup_asks_the_kind_then_the_email_and_mails_the_link` ·
`signup_finishes_from_the_link_with_the_password_and_the_code` ·
`signup_renders_a_wrong_code_in_place_and_sets_the_password_once` ·
`signup_asks_the_kind_again_when_nothing_was_remembered` ·
`signup_says_so_when_the_link_established_no_session`),
`import_is_offered_on_empty_harnesses`.

## 6. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D70 | `edition` is derived from the org's shape, never stored as a plan or a flag | a column |
| D71 | Personal names (*Keys*, *What I block*) are content entries keyed by edition, not different screens | one vocabulary for both — costs the plain words |
| D72 | The personal cut ships at K-M3; whether `import` and the exit review are pulled forward is decided at engine M3 from what is green | shipping at K-M5 |
| D73 | Sign-up seeds the same catalogue enterprise gets (engine D30h) with two differences, both `api` sign-up steps and never console verbs: every runtime arrives **approved**, and the group `my-keys` (no entries, granted to the org) exists for a hand-added key | making the person approve a runtime and create a group first |
| D101 | **One door and the code is checked where the organisation is made** (W7-D1, §2). `/signup` is one page: Team or Personal, then the account (D101a rewrote the middle of it — an email link — and moved the code to the last step). The code is not validated on the page and has no endpoint of its own — it travels with `POST /v1/orgs` and is compared there to `HARNESS_SIGNUP_CODE` before the transaction opens (`secrets.compare_digest`), so the thing it guards and the thing it is checked against are the same call, an unset variable refuses everyone rather than admitting everyone, and a wrong code costs the records nothing. The refusal says only that the code is wrong. A Team names its organisation and owns it; a Personal account is named after the person — the address's local part, or `email_label` when that slug is taken, because `org_units.path` is unique — and so has no name field at all. `Onboarding` in `auth.tsx` is **deleted**: it was a second way to create an organisation, and a second way would be a way round the code. | a `POST /v1/signup/check` so the page can refuse earlier — which is a hint, a second place the code lives, and still no protection for the write |
| D101a | **The link is the confirmation, and the code is still the gate** (§2; amends D101's steps, not its rule). Confirmation is **on** in the auth provider, so the old last step could not finish in one pass: `signUp` with a password returned no session, the page said *check your email, then sign in*, and the person met two doors for one account. `/signup` now asks Team or Personal and an address, and `signInWithOtp({ shouldCreateUser: true, emailRedirectTo: <origin>/signup?finish=1 })` mails **one** link that confirms the address and signs them in; the password is set on the way through (`auth.updateUser`) because `/login` is still a password, and the access code rides on the same form. A wrong code leaves that form standing and does not ask for the password twice (`same_password` is tolerated for exactly that reason). Step 1's answer is kept in `localStorage` under `harness.signup`: the account the link signs in has **no organisation** to read the choice off, and when nothing was kept step 3 asks again rather than guess at an organisation's shape. **What it costs.** `@supabase/ssr` hard-codes `flowType: "pkce"`, so the link signs in **only in the browser that asked for it** — the verifier is that browser's cookie — and a link carrying tokens in the URL hash (an admin-generated one; an invite) is refused by the client as *Not a valid PKCE flow url*, which is why `?finish=1` with no session says so and offers step 1 again. The inbox is also on the critical path now, so the built-in mailer's hourly limit is a sign-up outage rather than an inconvenience: `over_email_send_rate_limit` renders in place, and production wants custom SMTP. | turning *Confirm email* off, which is an unverified address on every account, or reading implicit-grant tokens out of the URL by hand — a second session path, in a page whose whole job is one |
| D104 | **The organisation is the person, in the records and on the Assets screen** (§2, §3; amends D70's *derived*, not its rule). Two corrections found by proving W7-H's modal against a signed-up account. **(a)** `POST /v1/orgs { personal: true }` writes **no team unit**. It used to write a `General` one — the definition plane skipped it, but `org_units` held it — because `org_units_role_order` refused a user outside a team; migration 0038 widened that clause, so the team can go, and it has to: `edition` is derived from the organisation having no team nodes, so one vestigial team made every signed-up personal account render as **enterprise** — the modal's two controls, the Getting started list, the sidebar, all of it. The user unit now hangs off the org and its path is `<org>.<person>` on both sides, so the branch's `node_path` is the stored path and nothing is recomputed around a records-only segment. `team_id` in the response and in the `org.create` event is `null`. **(b)** Assets at *You* lists the organisation's own copies beside the person's (`console.scope_nodes`), each row carrying its `level`. The seed's assets are on the org branch and a personal account has no organisation scope, so the screen said *Nothing on your own branch yet* while holding everything the person had. | (a) keeping the team and storing `edition` as a column — which is D70 undone, and a flag that can disagree with the tree; (b) a second *inherited* list below the person's — two tables answering one question, and P8 |

## 7. Out of scope

Billing, plans, quotas; a marketing page for the edition; sharing between
personal accounts (that is a team).

## 8. Definition of done

Every screen in §3 renders correctly for a fixture org with zero teams; the
five named tests pass; the word *team* does not appear in any personal
render (a V3 grep); *Create a team* on a personal fixture produces the
enterprise People screen with the person as org admin and nothing else
changed.
