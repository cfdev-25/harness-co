# Wave 6 — defaults in one place, boundaries with tabs, providers that say what they are, tooltips that stay on screen

*Plan written 1 Oct 2026 from the discussion of that day. Same ground rules as
`docs/wave-5-plan.md` ("Ground rules for builders"); read them first, they
bind. Decisions here are W6-D*n*; builders record them in the engine and
console docs with the next free D-numbers (engine after D145, console after
D93) and one ledger row each under a `## Wave 6` heading in `docs/build-log.md`.*

## The rule this wave adds

**Every out-of-the-box behaviour lives in one place and can be changed by
the people it ships to.** Today the defaults are scattered: provider lists
and the reach starter list under `engine/compose/presets/`, the asset kinds
as a Python constant in `seed.py`, the runtime display names as a map in
`console.py`, the always-loaded split as a constant beside it. Each new
default has been added wherever its author stood. From this wave on:

- `engine/compose/presets/` is the only home of a default, and
  `presets/index.json` is its manifest. A default that is not in the
  manifest does not exist; a file under `presets/` that is not in the
  manifest fails the checker.
- Every manifest entry says how it is **managed**:
  `required` — the harness cannot function without it; it ships into every
  organization and nobody can remove it (the "harness OS": today that is the
  `harness-authoring` skill, the asset kinds, the two runtimes' identities).
  `recommended` — seeded into every new organization and then **fully the
  organization's**: every verb (create, read, update, delete) exists on the
  console screen the entry names.
  `suggested` — never seeded; offered on a screen as one-click adds
  (today the reach starter list; this wave adds the command starter list).
- Every entry names the console screen that manages it, and the checker
  proves the screen exists and lists the verbs. A new default without a
  screen is a build failure, not a backlog item.

## Order and ownership

| Phase | Workstream | Model | Touches |
| --- | --- | --- | --- |
| 1 | WS-D the defaults registry | opus | `engine/compose/presets/index.json`, `seed.py`, contracts (`HarnessProvider.name`), indexer, `scripts/check-defaults.py`, docs 01/00, console 03 |
| 1 | WS-B providers: routing folded into Model providers, a status that means something | opus | web providers screens, backend `model_provider_rows`, `runners_for`, `speaks_routed`, routing writes, docs |
| 1 | WS-C tooltips that stay on screen | opus | `web/app/(console)/ui/use-tip.ts` and its three callers, tests |
| 2 | WS-A boundaries: Reach · Commands · Files tabs, inherited then here, command boundaries enforced through the runtimes | opus | web boundaries screens, Claude and Pi adapters, Pi extension, compose (`holds`), backend boundary writes, `presets/command-boundaries.json`, docs 03/06/07 |

WS-A waits for WS-D because it adds a default and must add it through the
manifest. WS-B and WS-C are disjoint from WS-D and from each other.

---

## WS-D — The defaults registry

**W6-D1 One manifest.** `engine/compose/presets/index.json`:

```json
{
  "defaults": [
    { "id": "harness-providers", "path": "harness-providers.json", "managed": "recommended",
      "screen": "providers/harness", "verbs": ["approve", "decline", "pin", "scope"] },
    { "id": "model-providers",   "path": "model-providers.json",   "managed": "recommended",
      "screen": "providers/model", "verbs": ["set-up", "default", "approve", "delete"] },
    { "id": "kinds",             "path": "kinds.json",             "managed": "required",
      "screen": "assets", "verbs": ["read"] },
    { "id": "reach-suggested",   "path": "reach-suggested.json",   "managed": "suggested",
      "screen": "boundaries/reach", "verbs": ["add"] },
    { "id": "reach-default-personal",   "path": "reach-default-personal.json",   "managed": "recommended",
      "screen": "boundaries/reach", "verbs": ["mode", "add", "remove"] },
    { "id": "reach-default-enterprise", "path": "reach-default-enterprise.json", "managed": "recommended",
      "screen": "boundaries/reach", "verbs": ["mode", "add", "remove"] },
    { "id": "asset:harness-authoring", "path": "assets/skill/harness-authoring", "managed": "required",
      "screen": "assets", "verbs": ["read", "loads"] },
    { "id": "asset:harness-brief",     "path": "assets/system_prompt/harness",  "managed": "recommended",
      "screen": "assets", "verbs": ["read", "edit", "delete", "loads"] }
  ]
}
```

`screen` is a route segment under `web/app/(console)/console/[scope]/`, so
the checker verifies a directory, not prose. `verbs` are checked against
what exists in code — a component write spec in
`web/test/components/*-writes.spec.tsx` or a route handler named for the
verb — and only softly against console 04's *Verbs by role* tables. The two
reach defaults are W5-D1c's seed logic made data: the personal file is
`allow` with the suggested list, the enterprise file `off`; `seed.py` picks
one by edition and writes it as `policy/reach.json`. `managed: required` is
the complete list of what the product cannot run without; it is short on
purpose and the doc says why for each (kinds: both adapters render only the
kinds they know).

The checker is expected to find, on its first run, that model providers
have no delete verb today. That finding is the point: WS-B adds the route;
WS-D does not soften the manifest.

**W6-D2 The seed reads the manifest.** `seed.py` stops naming files: it
walks `defaults`, writes every `required` and `recommended` entry into a new
organization (assets into `assets/`, policy files into `policy/`), and
derives `REQUIRED_ASSETS` and the recommended list from `managed`. The asset
kinds move out of the `KINDS` constant into `presets/kinds.json` and are
seeded as `policy/kinds.json` the way they already are read. The CLI's
`harness new`, the compose fixtures and the dev org are unaffected.

**W6-D3 Runtimes have a name.** `HarnessProvider` gains `name` (contracts,
`policy.ts` SPEC, `harness-providers.json`, the indexer passes it through,
the seed writes it). **WS-D owns that much and nothing in `console.py`.**
WS-B owns every console read of `provider["name"]`, the deletion of
`RUNNER_NAMES`, and re-seeding the dev org's `harness-providers.json` with
the names through `PUT /v1/providers/harness` (WS-B is rewriting
`speaks_routed` and `runners_for` anyway; two agents in one function is how
Wave 5 lost time).

**W6-D4 The checker.** `scripts/check-defaults.py`, run beside
`check-plan-docs.py`: every file or directory under `presets/` (except
`README.md` and `index.json`) is a manifest entry and vice versa; every
entry's `screen` is a directory under `web/app/(console)/console/[scope]/`;
every verb named has a component write spec or a route handler that names
it (a verb only the docs mention is a finding); a `required` entry is named
in `docs/engine/01-repository.md`'s new §4.4 *The harness OS*, with one
sentence of why. Zero findings is the bar, like the plan checker.

Tests: backend seed tests move from hard-coded expectations to the manifest;
a test that a manifest entry marked `recommended` is deletable through the
API and a `required` one is refused; compose SPEC test for `name`.

Docs: 01 §4.2 (presets as the one home, the manifest), new §4.4; 00 §4.4
(`name`); console 03 (verbs vocabulary); `presets/README.md` rewritten
around the manifest; `docs/next-steps.md` "How to work in this tree" gets
the rule in one paragraph.

---

## WS-B — Providers

**W6-D5 Routing is a column, not a tab.** Routing is a setting: which model
provider serves a team, harness or runtime by default, and which may. It is
not a record, so it is not Logs (what actually served a session is already
on Logs → Sessions). The Routing tab goes; `providers/routing/**` redirects
to the Model providers tab. On each model provider row: **Default for**
(teams, harnesses, runtimes) and **Approved for**, with a *Set default…*
verb that picks a team (or harness, or runtime) and writes `routing.json`
through the existing write, and an *Approve for…* verb likewise. A toggle
*By team* on the tab shows the old matrix as a view of the same data for
the admin who wants to read it that way.

**W6-D6 Status instead of reachable.** The *Reachable* column becomes
**Status** with three values and one sentence each: *set up* (a credential
alias is held and the endpoint answered — *held* means the alias appears in
a security group entry whose vault id is registered, read from the composed
policy, never a live secret fetch on a page load), *needs a key* (no alias, or the alias resolves nowhere), and
*unreachable* (a key is held but the endpoint did not answer in three
seconds). The probe runs only when a key is held. A provider that *needs a
key* is excluded from `routing.defaultFor` and `approvedFor` writes (the
write refuses `provider.needs_key` with the Set-up link), from
`speaks_routed` and therefore from `runners_for` and `canRun`, and the
broker refuses to open a session routed to it with the same code. The
status scale is registered in `sentences.py` like the others.

Tests: backend for the three statuses, the write refusal, `runners_for`
excluding it; component tests for the two verbs at the network and the
redirect; screenshots of the tab with all three statuses (make a keyless
provider on the dev org for the proof and remove it after).

Docs: console 04 §11 rewritten (Routing folded, Status), 03 the scale,
decisions; engine 04 (broker refusal), 00 §4.10 route notes.

---

## WS-C — Tooltips

**W6-D7 One bubble, always on screen.** `useTip` keeps its contract (hover
and focus, `role="tooltip"`, `aria-describedby`, Escape) and changes where
the bubble is drawn: a portal at `document.body` (mounted only on the
client — the hook returns no node until after mount, so server rendering
and the first paint are unchanged), positioned from the
trigger's bounding rect, below and left-aligned by default, flipped above
when there is no room below and right-aligned when it would cross the
viewport's right edge, with an 8px gutter; width up to 20rem, wrapping;
repositioned on scroll and resize while open. No table cell can clip it
because it is not inside one. Today the hook returns `node` props the three
callers (`HelpMark`, `Word`, `Button.explain`) spread into a `<span>`; a
portal is an element, so the hook returns a rendered `tip.element` instead
and the three callers change that one line each. Component tests: a help mark in the last
column of a wide table opens fully visible; one at the bottom of the
viewport opens above; Escape closes; the `title=` fallbacks stay.
Screenshots of before and after on the Endpoints table's rightmost `(?)`.

---

## WS-A — Boundaries

**W6-D8 Three tabs, two blocks each.** Boundaries becomes tabs: **Reach**
(WS1w's section, moved whole), **Commands**, **Files**. Every tab is two
blocks: *Inherited*, read-only, each row with the level that set it, and
*Set here*, with add and remove for `adminHere`. The capability kind is
shown under the tab its value belongs to (a capability naming a command
under Commands, a path under Files, otherwise under Reach) until it has a
better home. The deny-list table `_table.tsx` is the row component for both
blocks.

**W6-D9 Command boundaries are enforced by the runtime, and say so.**
First step, before any matcher is written: prove on the installed Claude
Code (2.1.286) what `permissions.deny` rules `Bash(rm -rf /*)`,
`Bash(curl * | sh)` and `Bash(git push --force*)` actually refuse — Claude's
rule syntax is a prefix with a trailing wildcard, not a general glob — and
record the table. The compose matcher is written to what both runtimes can
honour identically; a pattern only one runtime can hold is shown on the row
as *intercepted by Pi* or *by Claude Code*, never as both. A boundary of
kind `command` becomes the runtime's own veto: Claude Code gets
a `permissions.deny` rule `Bash(<pattern>)` written into the session's
settings beside the file denies (`denyPatterns`); the Pi harness extension
refuses a `bash` tool call whose command matches, in its existing
`tool_call` handler, printing the boundary's reason. `holds` for a command
boundary is `intercepted` and the row says *intercepted by the runtime*;
`enforced` stays for what the proxy and the jail do. A pattern is a glob
over the resolved command line (`rm -rf /*`, `rm -rf ~*`, `curl * | sh`,
`git push --force*`); the matcher is one function in `@harness/compose`
used by both adapters and by the console's add form to validate. The audit
hook records a refused call as `tool.call` with `refused: boundary:<id>` so
Logs shows it.

**W6-D10 A starter set, offered.** `presets/command-boundaries.json` (a
manifest entry, `managed: suggested`, screen *Boundaries → Commands*): the
system and home directory wipes, piping a download into a shell, force
pushes, disabling the shell history. Shown under *Set here* as one-click
adds when the viewer administers the level, each with its reason; never
seeded.

Tests: compose matcher table; Claude golden gains the `Bash(…)` lines; Pi
extension test refuses a matching call and passes a non-matching one;
backend write of a command boundary and the level rule (a team may add, not
lift the org's); component tests for the tabs, the two blocks, add and
remove at the network, the starter adds. Live: add `rm -rf /*` at the org,
`harness run pi --test-harness-1` asks the agent to run it, the extension
refuses with the reason, the Logs row appears; same under Claude, where the
deny rule refuses it.

Docs: console 04 §9 rewritten for the tabs and blocks; engine 03 §5.x the
command kind no longer "later"; 06 the division between enforced and
intercepted; 07 §6 matrix rows for both runtimes; the manifest entry; the
usual decisions and ledger rows.
