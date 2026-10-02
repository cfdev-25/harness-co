# Presets — the defaults registry (engine 01 §4.2, D30h, D146)

**Every out-of-the-box behaviour lives here, and `index.json` is the list.**
This directory is the only home of a default: the exporter, `api`'s seed and
the CLI read these files and none of them holds a list of its own. A default
that is not in `index.json` does not exist, and a file in this directory that
no entry names is a finding of `scripts/check-defaults.py` (run it from the
repo root, beside `check-plan-docs.py`; zero findings is the bar).

## The manifest

`index.json` has one array, `defaults`. Each entry:

| Key | What it says |
| --- | --- |
| `id` | the entry's name, used by the one indirection below and by the checker's findings |
| `path` | the default itself: a JSON file here, or an `assets/<kind>/<name>/` directory |
| `managed` | `required` · `recommended` · `suggested` — see below |
| `screen` | the console screen that manages it: a **route segment** under `web/app/(console)/console/[scope]/`, so the checker tests a directory and not a sentence |
| `verbs` | the controls that screen offers. Each must exist in that directory's own files or in a `<subject>-writes.spec.tsx` test name (console 03 §10.1) |

### `managed` — who owns it after we ship it

- **`required`** — the harness cannot function without it, it ships into every
  organisation and nobody can remove it. This is the *harness OS*: short on
  purpose, and engine 01 §4.4 gives the one sentence of why for each. Today:
  the asset kinds and the `harness-authoring` skill.
- **`recommended`** — seeded into every new organisation and then **fully the
  organisation's**: create, read, update and delete all exist on the screen
  the entry names.
- **`suggested`** — never seeded. Offered on a screen as one-click adds:
  `reach-suggested.json` under Boundaries → Reach, and
  `command-boundaries.json` under Boundaries → Commands.

### The one indirection

A value spelled `@<entry id>` is that entry's file, resolved by the seed.
It exists so a default can *be* another entry rather than hold a hand-copied
second copy of it that would drift: `reach-default-personal.json` was
`{ "mode": "allow", "hosts": "@reach-suggested" }` from D146 until W7-D4 made
it `{ "mode": "on", "hosts": [] }` (D155 — a per-harness on/off switch needs
*on* above it), so **no preset uses the indirection today**. It stays: the
seed resolves it, `check-defaults.py` checks any `@` it finds names a real
entry, and the next default that is another entry with a field on it says so
instead of copying. `reach-suggested.json` itself stays a plain array — the
shape `policy/reach.json`'s `hosts` takes and the shape the Boundaries screen
offers as one-click adds.

## The files, and what JSON cannot say about them

`harness-providers.json` holds a `HarnessProvider` without `approval`, `scope`
or `reason` — whose runtime is allowed is the seed's decision, not ours. It
*does* carry `name` (W6-D3/D148): what the runtime calls itself, *Pi* and
*Claude Code*, so no screen holds a map from id to display name. Pi ships
vendored at a commit (engine 07 D90); the CLI refuses any other pin shape
(build-decisions.md 2026-09-15). `speaks` is each adapter's own declaration.
So is `modelNative` (W7-D2): the model providers that runtime signs in to
*itself*, by provider id — Pi's six OAuth flows
(`pi/packages/ai/src/auth/oauth/`), Claude Code's one. It is the list behind
`capabilities.model_native`, which says only whether a runtime can do it at
all, and it sits here for the same reason `speaks` does — the server has to
predict a runtime's behaviour without running it (`seed.preset_model_native`,
`broker.signs_in`). Stripped when the seed writes, like `attach`: it is a fact
about the runtime we ship, never a policy an organisation edits.

`model-providers.json` holds a `ModelProvider` without `credential`, plus the
`attach: { header, prefix }` its key is sent with, stripped when the seed
writes — `attach` is how a key travels and belongs to no branch.

`kinds.json` is `AssetKind[]`, seeded as `policy/kinds.json` and read from
there everywhere (`console_index`, `console.policy`, compose). It is
`required`: both adapters render only the kinds they know, so a kind on no
list is `unknown-kind` at compose.

`reach-suggested.json` is W5-D5's starter allow-list: the package registries,
source hosts and update hosts a first `pip install` or `npm install` needs, as
a plain array of host patterns. Nothing reads it at compose or at run — a host
reaches only because a node's own `reach.json` names it.

`command-boundaries.json` is W6-D10's starter set of command boundaries: an
array of `{ value, holds, reason }` — no `id` and no `scope`, because those
are the write's, not ours. `holds` is `intercepted` on every one and can be
nothing else: a command boundary is the runtime's own veto (engine 06 §13),
and `api` refuses `enforced` on the kind. The patterns are written to what
**both** runtimes hold, except one: `curl * | sh` is Pi's alone, because
Claude Code matches each subcommand on its own and a pattern with a pipe in
it never fires there (engine 07 §8.1, measured). The console row says so
rather than claiming a refusal nobody saw. Never seeded — a default that
denies something is a decision, and the organisation makes it.

`reach-default-personal.json` and `reach-default-enterprise.json` are W5-D1c /
D135 made data, amended by W7-D4 / D155. The seed picks one by edition and
writes it as `policy/reach.json`: a personal account starts `on` with an empty
deny-list, an enterprise starts `off` and an org admin turns it on from the
same screen. The personal default is `on` and not the suggested allow-list
because the first-harness modal's **Web access** switch writes `off` on the
harness, and reach only ever narrows — a harness cannot turn web access off
under an allow-list without also naming every host it is dropping, and it
cannot turn it on at all. The suggested list did not go away: it is still what
Boundaries → Reach offers as one-click adds, which is where a person who wants
an allow-list builds one.

`assets/<kind>/<name>/` are the built-in assets (D30j), seeded verbatim —
bytes, not re-serialised JSON, because a `SKILL.md` is not JSON. Which of
`always-loaded.json`'s two lists an asset lands on is its entry's `managed`
word and nothing else: `asset.json` is identity, and 01 §5 rule 2 refuses a
key that is not identity, so a preset cannot say this of itself.

## Adding a default

1. Put the file or the asset directory here.
2. Add its entry to `index.json`, with the screen that manages it and that
   screen's verbs.
3. If it is `required`, give it a row in engine 01 §4.4 with the sentence that
   says why nothing works without it.
4. `python3 scripts/check-defaults.py` — zero findings, or the screen, the
   verb or the sentence is missing and that is the finding.

The seed needs no edit for a new policy file whose body is a list of names or
a plain object, and none for a new asset directory.

**`models` in `model-providers.json` (W7-D7).** Each provider ships a short list of models a fresh organisation can name, so a personal account's first session on the person's own sign-in has a model to ask for (`anthropic` first: `claude-sonnet-5`). The list is the organisation's to edit on Providers → Model providers; the seed fills it only where the organisation holds nothing.
