# Likely next steps

Written 28 September 2026 at the end of the construction sessions. It is
the accounting of `docs/engine/09-sequencing.md` and
`docs/console/06-sequencing.md` against what is built, and the order the
remaining work should go in. Every claim of *done* below was verified on a
real stack (see `build-log.md`); everything else says what it is.

## Where the build stands

The spine works end to end for one person on one machine: git is the
definition plane, the broker mints, the proxy attaches, the macOS jail
holds, the console reads and writes all of it, and an admin's first hour is
a seeded catalogue with a switch in each row. Backend 292 · compose 69 ·
definitions 39 · CLI 237 · web 147 unit + 50 component · `next build` clean.

| Milestone | State |
| --- | --- |
| Engine M0 build · M1 compose · M3 supervisor holds the key · M5 commands | done |
| Engine M2 definition plane | done except step 4's deletions (held: irreversible) |
| Engine M4 fence | macOS done; Linux only in CI, which has never run; Windows W1 not started |
| Engine M6 vaults + native | issuer built; AWS against recorded fakes; native mode never run whole |
| Console K-M0 … K-M3, K-M5 | done; the V4 rows that need a live session are mostly unrun |
| Console K-M4 (the fence, seen) | not started |
| Console K-M6 vaults | bundled vault only |
| Personal edition | seeded, routed, sign-up proven; never run as one person end to end |

**28 Sep, the seam (D30j):** every session now opens with where harness assets live, a built-in `harness-authoring` skill is seeded into every organisation, and a real session extracted a Codex setup into five assets without carrying its key — `build-log.md`, second-to-last row. Kept assets now join the selected harness at the exit review (step 5a). `harness run claude` has now run live too (skills listed and separated from Claude Code's own).

**28 Sep, after the first hands-on run:** four defects that no suite had
caught (stale Pi extension build, missing prompts directory, `NO_PROXY`
making Pi tunnel to its own proxy, undici sending no proxy credential for an
empty username) were found and fixed in one sitting — `build-log.md`, last
row. The lesson is step 3 below: a `--version` run proves the boot, not the
session. The regression is one line: `harness run pi --test-harness-1 -- -p
"Reply with exactly the word: ok" < /dev/null` → `ok`.

## Before the first stranger signs up (2 Oct 2026)

Wave 7 built the personal door (`docs/wave-7-plan.md`; `build-log.md` *Wave 7*).
Four things are the person's, not the code's:

1. **Commit and push, and make the repository public** (or host the
   installer another way). `engine/` has never been committed — the product
   is staged, not in history — and the repository is private, so
   `curl -fsSL https://raw.githubusercontent.com/cfdev-25/harness-co/main/scripts/install.sh | sh`
   is a 404 today. Nothing in the script changes once that is done.
2. **Custom SMTP, because the sign-up is now an email** (console D101a).
   Confirmation stays **on** and `/signup` sends the link itself, so a
   stranger meets one door — but the link is only as good as the mailer.
   Two settings, both the person's:
   - **Authentication → URL Configuration → Redirect URLs** must hold the
     deployed console's `/signup`. Dev's already is: a verify link asking for
     `http://localhost:3000/signup?finish=1` was answered `303` to exactly
     that address, rather than to the site URL, which is what a redirect
     GoTrue does not allow would have done. Without it the sign-up cannot
     finish, because the link lands where the page is not.
   - **Authentication → Emails → SMTP Settings**: the built-in mailer is
     rate-limited per hour and per project, and it refused outright during
     this build (`429 over_email_send_rate_limit` — the page shows it in
     place, which is honest and still a closed door). It is also why a
     throwaway address needs a domain with **MX records**: Supabase validates
     deliverability, and `@harnessmanager.dev` is refused
     (`400 email_address_invalid`) because that domain has no MX.
3. **`HARNESS_SIGNUP_CODE`** is set in `backend/.env` (dev value in chat);
   the deployed API needs it too, or every sign-up is refused.
4. **Throwaway accounts to discard**: `w7-personal-dana`, `w7-personal-sam`
   (holds a harness *First*), `w7-team-acme`, `w7h-1790964023` (a hand-edited
   fixture with a dud `openai` key in `model-keys`), the two WSD
   organisations in a second definitions root, and W7-D1a's auth users —
   `w7d1-probe-…` and `w7d1-…@harnessmanager.dev` (no organisation),
   `w7d1-pkce-…` and `w7d1-1790972186…@mailinator.com` (no organisation), and
   `w7d1-resume-1790972358575@mailinator.com` ·
   `w7d1-resume-1790972420028@mailinator.com`, which each hold a personal
   organisation made with the code. None is the dev org.

## After Wave 5 (1 Oct 2026)

Wave 5 is built, proved live and staged (`docs/wave-5-plan.md` is the plan,
`build-log.md` *Wave 5* the record). What it changed for the person: reach is
a policy with three modes and a list, set on Boundaries and narrowed per team
and per harness; a model request is shaped so the provider cannot browse on
its behalf unless reach is on; every refused endpoint names its rule and
offers **Allow**; the sidebar shows only what you manage; Logs has tabs;
Harnesses and Assets read the same at every level with a level chip; assets
have Edit, Delete, Browse and *add to harness*; required and recommended
assets; our brief is the real system prompt in both runtimes; a session
starts with a boot screen and ends with the same frame; a card opens a
terminal through `harness://`; a card remembers where you last worked.

**Do first:** restart the dev stack (`npm run dev`) once more. It picks up both this wave's policy rules and the new self-reloading `definitions` launcher (`scripts/dev-definitions.sh` under `node --watch-path`), after which a rebuild of `engine/compose` or `engine/definitions` relaunches the service by itself. Then write the two runtime names into the dev org: `PUT /v1/providers/harness` for `pi` (*Pi*) and `claude` (*Claude Code*), the step WS-B could not make against the old service.

**Was:** restart the dev stack (`npm run dev`). The running
`definitions` on 8402 was built before this wave; it refuses an org or team
write that carries a sidecar `description`, a `needs.environment`, or the
two-list `always-loaded.json`. Everything in this wave was proved on the
user branch or through a temporary second instance because of it.

**Open from the wave, smallest first:**

- `harness open` on Windows and Linux is written and unit-tested against the
  exact commands, never run. One suspicion is recorded in the WS5a ledger row
  (the `cmd /c start` fallback's quoting).
- Claude Code 2.1.286 ignores `Write(...)` deny patterns and says so (two
  builders saw the warning); the `Edit(...)` twins and the filesystem control
  still hold. Drop the `Write(…)` form from `denyPatterns` once the Pi
  extension's reading of that list is checked — it reads the same list as its
  advisory vocabulary.
- One live run printed *Something on this machine tried the proxy without
  the session secret.* Find what.
- **The dev organisation's two runtimes have no `name` yet.** W6-D3 put
  `HarnessProvider.name` on the contract, in the preset and in the seed, and
  the console reads it (`console.RUNNER_NAMES` is deleted); re-seeding the dev
  org through `PUT /v1/providers/harness` is refused
  `definitions.policy_invalid: unknown key name` because the `definitions`
  running on 8402 was started from a build that predates the SPEC change.
  Restart the dev stack, then PUT the two rows with their names (*Pi*,
  *Claude Code*); until then the dev console shows the ids.
- The console serves no guides, so the cards' install link points at the
  GitHub copy. A `/console/guide/[slug]` route makes every guide link real.
- The search palette renders no results list (01 D61); the search endpoint
  now links assets to the level that holds them, which nothing shows yet.
- The exit review's `[a]ll / [n]one / [p]ick` is the one place a terminal
  prompt library would earn its keep (`@clack/prompts` is the Node choice;
  Ink is the Textual analogue and is not worth a React runtime for a splash).
  Adopt it there if the review's picking is still clumsy after a week of use.
- `harness remove <key> --harness <name>` run right after a session that
  pushed that key exited 0 and removed nothing (1 Oct, the exit-review proof;
  `DELETE /v1/assets/{id}?scope=me` did the job). It should either remove or
  say why not — a silent no-op is the one answer a verb may not give. Likely
  `refs/harness/remote` not yet carrying the just-pushed key.
- `words.ts` still explains *Endpoints reached*; the tab is *Endpoints*.
- **Triage the screen suite.** `playwright --project screen` against stack B
  (`web/test/server/stack-b.sh up`) closed the wave at 56 passed · 89 failed
  · 34 skipped. Nobody counted it during the wave, and the scratch database
  it runs over was last synced for the cutover dry run. Resync the scratch
  data (`stack-b.sh sync`, then the migrations through 0040 and a reindex),
  rerun, and only then read the failures as code: the first ones are fixture
  text the screens no longer print and the `sessions/**` → `logs/sessions/**`
  move.

## In order

0. **A local database for development.** Every console read is now 5–12
   queries, and each is a full round trip to the Supabase pooler — 87 ms
   from here — so a page is 0.5–1.2 s in development and would be ~20 ms
   against a database on the same machine. `supabase start` (Docker) gives
   a local Postgres with the `auth` schema the joins need; point
   `backend/.env`'s `DATABASE_URL` and the two `NEXT_PUBLIC_SUPABASE_*`
   values at it and apply `backend/supabase/migrations`. The query counts
   are the floor now (build-log, 30 Sep); the distance is the rest.

1. **Push, and get CI green on both runners.** Nothing has been pushed. M0's
   exit criterion is a green run on macOS 14 and Ubuntu 24.04, and the Linux
   jail (bwrap + forwarder, eight skipped tests here) and the probe-binary
   checksum step only exist there. Expect Linux to need a fix or two.
   Then restart the dev stack: `npm run dev` runs `definitions` from `dist/`,
   and the copy that was running on 26 Sep predates that day's builds.

2. **Run the personal edition as one person** — `signup_import_run_read_back`
   (console 06 K-M3): sign up with `personal: true`, `harness login`,
   `harness import claude`, **Set up** an OpenRouter key on the model tab,
   `harness run pi`, read the session back. Every piece exists and has been
   proved alone; the whole path has not. It is the first shippable edition
   and the cheapest proof of the most product.

3. **Claude Code's audit hooks and server-side web tools.** Hooks do not run inside a session on 2.1.283 (build-log, last row: trust, tier and jail ruled out; policy-limits fetch is the lead) — the Claude session page shows endpoints only until fixed. `WebSearch`/`WebFetch` are denied by `permissions.deny` and stripped from the request by the proxy (05 §6a) when reach is prohibited — done.

4. **The live V4 rows of K-M3** with a real session: rotate a key → the alias
   reads *retired* on the live session (`rotation_retires_alias_live`);
   narrow a grant → *revoked* with the reason (`policy_change_revokes_session`,
   file exists, never exercised live); *Endpoints reached* fills on the tick;
   a broker refusal becomes a harness-log row; a native session reads *not
   metered*. These are the promises the homepage makes.

5. **M2 step 4 — the deletions.** `GET /v1/resolve`, `asset_scopes` (table,
   endpoints, predicate), `harness_assets(kind,name)`, Postgres as the
   definition source of truth, `identify()` by shape, `automation_runners` and
   the three dead functions, `routes_assets.py`'s legacy versioning routes.
   Gate: D6 byte-identical against production data (it is 0 mismatches
   against dev). It is the one irreversible step; it needs its own go-ahead
   and the freeze switch (`503 migrating`) that does not exist yet.

6. **K-M4, the fence seen** — small and it makes *enforced* true on screen:
   drop *not enforced yet* from the reach table, show refusals with their
   status in Endpoints reached, show the six probe results and the macOS
   keychain note on the session.

7. **M4's remaining engine items:** the test `ambient_token_has_no_route_in_org_mode`
   (D11 — closes the Keychain concern; does not exist), the Windows W1 WSL2
   spike (six probes green in a stock WSL2 Ubuntu), `no_key_in_child_env`'s
   run-level form and `aborted_boot_closes_session` (both need a run harness
   with an injectable api).

8. **M6 for real:** the AWS resolver against a live account
   (`aws_resolve_tags_and_scopes_session` runs against fakes), then Azure and
   HashiCorp behind the same `Resolver`; native mode through the whole path
   with `harness auth claude`.

9. **Housekeeping** that costs an afternoon: the 34 screen-test `fixme`s
   written before the writes existed (most now do — convert or delete); the
   terminology rename through the homepage (prd-v2 §22 Add 18); server-side
   idle expiry for a session whose client dies between mint and its first
   heartbeat; `harness switch <unit-path>/<name>`; CLI verbs for groups,
   boundaries, routing and vaults (D117); the defects listed under
   *Recorded, not built* in `build-log.md`.

## Decisions waiting on a person

- The deletions (5) — yours, once D6 has run against production data.
- Whether the personal cut ships before or after K-M4 (console 06 says
  decide from what is green; today (2) is green enough to try).
- Native mode's refusal sentence: engine 07 says native is never refused by
  name, 08 §11.15 says a notice — one of them is wrong.
- 07 §2 (*other* provider → **Add** → **Set up**) versus 04 §10 (*Set up* on a
  preset row): `PUT /v1/providers/model/{id}` exists; the console form for a
  non-preset provider does not.

## How to work in this tree

- Contract first, then agents: every wave changed `docs/engine/00-overview.md`
  §4 / §4.10 or `docs/console/04-screens.md` before any code, and
  `scripts/check-plan-docs.py docs/engine docs/console` stays at 0 findings.
- **Every out-of-the-box behaviour lives in `engine/compose/presets/` and is an
  entry in `presets/index.json`** (engine 01 §4.2/§4.4, D146–D149). A default
  added anywhere else — a Python constant, a map beside its one reader, a JSON
  array nobody can find — is not a default, it is a thing the people it ships
  to cannot change. Each entry says how it is **managed** (`required`, which
  nobody may remove and 01 §4.4 justifies in one sentence; `recommended`,
  seeded and then wholly the organisation's, with every verb on the screen;
  `suggested`, never seeded and offered as one-click adds) and which console
  screen manages it. `python3 scripts/check-defaults.py` runs beside the plan
  checker and stays at 0 findings: it proves the manifest and the directory are
  the same set, that each screen is a real route directory, and that each verb
  exists in code. A new default without a screen is a build failure, not a
  backlog item.
- Writes are proved at the network (`web/test/components/writes.tsx`), never
  by mocking `request`; the seven silent 422s of wave 4 are why.
- `engine/cli/src/commands/sheet.ts` is the one command list; `npm run sheet`
  in `web/` copies it, and `sheet_matches_cli` fails on drift. From the root,
  `npm run sheet` does both halves — it builds the CLI (which emits
  `engine/cli/dist/sheet.json`) and then runs the web one, so the copy is
  never made from a stale build.
- Nothing is committed by the tooling. Stage, review, commit yourself.
