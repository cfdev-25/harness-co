# Conformance fixtures

01 §6, *Conformance fixtures*. One truth, three consumers: the CLI,
`definitions` and the console's Playwright suite all read the same
`expected.json` (00 §10). The runner is exported from the package
(`@harness/compose/fixtures`) rather than living in a test file, so all three
run the cases rather than copying them.

A case is one directory here:

```
<case>/chain.json              Chain, with commit ids "org", "t1", …, "u" as placeholders
<case>/branches/<placeholder>/ the tree each placeholder commit holds, as plain files
<case>/expected.json           Composed with `tree` and every oid replaced by the fixture
                               path they came from
```

**A directory with no `expected.json` is not a case and is skipped.**

## What `expected.json` holds

The whole `Composed`, with every git object id substituted, because a raw oid
is unreadable and is not the same number under every git version.

| In `Composed` | In `expected.json` |
| --- | --- |
| `chain[].commit` | the placeholder, e.g. `t1` |
| `assets[].tree`, `assets[].shadows.tree` | `<placeholder>:<path>`, e.g. `t1:assets/tool/deploy` |
| `tree` (the composed tree) | `<composed>` — it came from no branch |

The composed tree's own id is therefore *not* asserted by a fixture. That it
is the same on every run is `compose_is_deterministic` (01 §10), which
compares two runs over one repo, tree id included; what the tree *contains* is
asserted directly in `test/fixtures.test.ts`.

**A case keeps every asset directory's contents distinct.** Two directories
holding identical bytes are one git object, so one oid would answer to two
fixture paths and the substitution above would be ambiguous.

## Running them

```ts
import { fixtureCases, gitFixture, memoryFixture, normalise } from "@harness/compose/fixtures";
```

`memoryFixture(dir)` is tier T1: a `Reader` over the files with no git at all.
`gitFixture(dir, repo, scratch)` is tier T2: the branches materialised as
orphan commits (01 §4.1) in a bare repo, read back through `gitReader`. Both
produce the same `expected.json` through `normalise`.

## The cases

| Case | Asserts |
| --- | --- |
| `single-org` | the minimal legal chain: an organisation and a person |
| `override-keeps-id` | D3 · org → team → user, the person's copy wins, `shadows` is the team's |
| `rename-follows-id` | §5 rule 4 · the team renamed the directory and kept the id |
| `same-path-different-id` | §5 rule 4 · fail closed, neither id loads |
| `duplicate-id` | §5 rule 3 · first by path order survives |
| `unknown-kind` | C37 · a kind absent from `kinds.json` |
| `narrowed-grant-valid` | §6 step 9 · a team narrowing one alias into a sub-team |
| `narrowed-grant-outside-subtree` | clause (c) |
| `narrowed-grant-alias-not-held` | clause (d) |
| `boundary-union` | §6 step 7 · ids prefixed by node path, root first |
| `always-loaded` | §6 step 12 · an id whose winning copy is not the organisation's is dropped |
| `required-and-recommended` | §6 step 12 · W5-D10's two-list `always-loaded.json`; the bare-array case is `always-loaded` |
| `harness-names-nothing` | C18 · an id that resolves to nothing stays on the definition |
| `harness-by-ids` | §4.2 · a harness on the org and one on the person, both collected |
| `three-level-teams` | §6 step 1 · four nodes, precedence across all of them |
| `no-policy-files` | C32 · absent is not empty, and absent is not a conflict |
| `reach-narrows` | D131 · org `on` → team `allow`, `setBy` the team |
| `reach-widened-conflict` | D131 · a team moving `allow` → `on`; the org stands |
| `reach-grant-retired` | D132 · `Grant.reach` composes to one conflict and no grant |
