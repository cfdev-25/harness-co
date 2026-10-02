# Wave 7 — the first personal user

*Plan written 2 Oct 2026. Ground rules: `docs/wave-5-plan.md` "Ground rules for
builders" bind (work in place, no commits, no `npm run dev`, no OpenAPI
regeneration, no screenshots, every line earns its keep). Decisions are
W7-D*n*; builders record them with the next free D-numbers (engine after
D154, console after D99) and one ledger row each under `## Wave 7` in
`docs/build-log.md`.*

## The person this wave is for

Someone who has never installed Pi or anything related. They come to the
site, choose **Personal** (or **Team**), type the access code, and are in.
On their account page they see what to do next, in order, with live state.
They install the CLI with one command, sign in, add a model key (or sign in
to Claude or ChatGPT inside Pi), make a first harness from a modal that asks
two things — web access on or off, and which outside keys, usually none —
and open it from the card. They never need Security groups, Boundaries or
Providers for that.

## Decisions

**W7-D1 Sign-up is Team or Personal behind one code.** `/signup`: choose
Team or Personal, enter the access code, then the account (email and
password through the existing auth). The code is one value in the API's
environment, `HARNESS_SIGNUP_CODE` (the dev value is `mcbreezy`, named in
chat per the no-`.env.example` rule), checked server-side on the one route
that creates the organisation; a wrong code is `signup.code_wrong` with no
hint. Personal creates a personal organisation (the existing personal seed);
Team creates an enterprise organisation with the signer as its admin (the
existing enterprise path). No plans, no payment.

**W7-D2 A model provider with no key is *your sign-in*, not an error, where
the runtime can sign in.** Wave 6's `needs-key` status and `broker.provider_needs_key`
refusal stay for organisations that supply keys. They do not apply when the
session's runtime supports `model_native` (Pi: Anthropic, OpenAI and the
others it ships sign-ins for) and the person has not been granted the alias:
that is the engine's native mode (03 D9/D11), the session runs on the
person's own sign-in and is marked not metered. The status column reads
*your sign-in* with the sentence *Pi signs in to this provider itself
(`/login`); add a key to route it through the harness.* The broker allows
such a session; `runners_for` includes the runtime. Note on the screen and
in 05: on a sign-in session the request goes to the provider over TLS, so
provider-side browsing cannot be stripped — reach on the machine still holds.

**W7-D3 Keys are pasted.** The one-click key paths that exist (OpenRouter's
sign-in creates a key) are later; *Set up* on a model provider takes a key.
On a personal account *Set up* also makes that provider the default and
grants it to the person, in the same write, so nothing else is needed.

**W7-D4 The first-harness modal asks two things.** *New harness* on a
personal account (and for any viewer whose level has no team structure to
speak of): name, description, drawing as today; then **Web access** — a
switch, on or off; then **Outside keys** — a select of the person's
security groups with *None* first and chosen by default. Everything it
writes is scoped to the harness: `HarnessDef.reach` (`on` or `off`), and a
grant of the chosen group scoped to the harness. Nothing is written at the
organisation. For this to narrow correctly the personal seed's reach
default becomes `on` (`reach-default-personal.json`: `{ "mode": "on", "hosts": [] }`);
the suggested allow-list stays for the Boundaries screen and for
enterprises. Record the change to W5-D1c with the reason: a per-harness
on/off switch needs *on* above it. One line under the switch says what the
model will be (the person's default, or *add a key or sign in to Pi first*
with the link) — read-only here.

**W7-D5 The account page is the setup list.** For a personal account the
Account screen opens with *Getting started*, four rows with live state:
install the CLI (the one install command; checked when a session has ever
been opened from this account), sign in (`harness login`; checked when a PAT
exists), a model (checked when a key is held or a session ran on a sign-in;
otherwise *Set up* link and the Pi sign-in sentence), first harness (checked
when a harness exists; otherwise *New harness*). Each unchecked row shows
exactly one command or one link. The list hides itself once all four are
checked. Enterprise accounts keep the page as it is.

**W7-D6 One command installs.** `scripts/install.sh`, served from the
repository (`curl -fsSL <raw url>/scripts/install.sh | sh`): checks for
Node 22 and git and says exactly what to install if either is missing;
clones the repository to `~/.harness/cli` (or pulls), runs `npm install`,
`npm run build`, `npm link -w engine/cli`, then `harness setup` once logged
in — and prints the three lines the person does next. Pi is vendored, so
nothing else is installed. `docs/guide/first-session.md` is rewritten for
the personal account around that command; the admin guide keeps the
developer path.

## Workstreams

| WS | Scope | Model | Files (owns) |
| --- | --- | --- | --- |
| W7-S | sign-up (W7-D1) | opus | `web/app/signup/**`, `web/app/auth.tsx`, `web/app/login/**` links, `backend/app/api/routes_auth.py` (+ the org-creation route it calls), `backend/app/config.py`, tests, console 04/07, engine 04 |
| W7-N | native mode and keys (W7-D2, W7-D3) | opus | `backend/app/domain/{broker,console}.py` (`needs_key`, `_status`, `speaks_routed`, `runners_for`), `routes_writes.py` (`setup` makes default + grant on personal), `sentences.py` scale, web `providers/model/**` status words, tests, engine 04, console 04 §10 |
| W7-H | the first-harness modal (W7-D4) | opus | `web/app/(console)/console/[scope]/_new-harness.tsx`, `lib/views/harness.ts`, `content/screens/harnesses.ts`, `routes_writes.create_harness` (`reach`, `grant`), `presets/reach-default-personal.json`, seed test, console 04 §4, engine 01 |
| W7-A | account checklist + installer + guide (W7-D5, W7-D6) | opus | `web/app/(console)/console/[scope]/account/**`, `lib/views/account.ts`, `content/screens/account.ts`, `routes_console.read_viewer` or a `GET /v1/console/setup` for the four facts, `scripts/install.sh`, `docs/guide/first-session.md`, console 04 §16 |

All four run in parallel; they share `routes_writes.py`, `console.py` and
`docs/build-log.md` (Edit after re-reading, never Write). W7-H's modal
depends on nothing new from W7-N except the *model* line's words; agree the
field name in the first hour: `viewer.setup.model: "key" | "sign-in" | null`.

## Proof

One throwaway personal account from `/signup` on the dev stack with the
code, through the account list, `scripts/install.sh` on a clean `HARNESS_HOME`,
`harness login`, a pasted key *or* `/login` in Pi, a first harness from the
modal with web access off and no outside keys, opened from the card, a Pi
session that is refused a web host and answers a prompt, and the exit
review. Each builder proves its own piece; the coordinator runs the whole
path once at the end.
