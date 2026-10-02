# Engine Plan — 10 · Code standards

How the engine's code is written so that it stays small, readable, and
honest. These are rules, not preferences; a reviewer cites them by number.
The model to imitate is `hydrate.ts` as it stands today: one exported
function, a numbered algorithm from a normative document, comments that say
which row of the table a branch implements, and tests against the real
thing.

## 1. Necessity

1. **Every line does something the plan asked for.** No speculative
   parameters, no "for later" branches, no configuration for a choice nobody
   has to make. If the plan does not name it, it is not written; if it turns
   out to be needed, the plan is amended first.
2. **One caller, no abstraction.** A function with one caller is inlined or
   kept private. An interface with one implementation is a type alias until
   the second implementation exists. (`Enforcer` and `Adapter` earn theirs:
   each has several.)
3. **No flag disables a safety property.** There is no `--no-sandbox`,
   `--allow-env`, `--skip-probe`, `--unsafe`. A developer who needs to bypass
   something edits the code on a branch and does not merge it.
4. **No degraded mode.** A capability that cannot be provided on this machine
   produces a `Blocker`, not a warning and a weaker session.
5. **Delete with the replacement.** When a module on `00 §6` is replaced, the
   old code and its tests leave in the same change.
6. **Zero runtime dependencies in the CLI and `definitions`.** `node:*` only.
   A proposal to add one must show that writing it would exceed the module's
   budget (`00 §8`) *and* that the dependency has no degraded path.

## 2. Shape

7. **A module is a noun; its exports are verbs.** `compose.ts` exports
   `compose`; `proxy.ts` exports `startProxy`; `sandbox.ts` exports `confine`.
   A file that exports more than three things is two files.
8. **Pure first.** Everything that can be computed without I/O is, and is
   tested at T1. I/O lives at the edges: `compose(chain, read)` takes a
   `read` callback; enforcers take a plan and return a plan; adapters'
   `render` is the only place a file is written and it says so.
9. **Algorithms are numbered in the doc and numbered in the code.** A branch
   that implements row 3 of a table says `// Row 3:` — the reader can hold
   the doc in one hand and the code in the other.
10. **Types come from `00 §4`.** Nothing redeclares a contract type; nothing
    widens one locally. A local type is private to its module.
11. **No class where a closure will do; no closure where a function will do.**
    State that must persist across calls (the proxy's connector table, the
    supervisor's spool offset) is one object created in one place and passed.
12. **Errors are `Blocker`s, or they are bugs.** Anything a person can act on
    is a `Blocker` with `code`, `message`, `remedy`. Anything else is thrown
    as-is and crashes; there is no catch-and-log. `catch` appears only where
    the doc names the failure mode being handled.

## 3. Words

13. **Comments say why, never what.** The code says what. A comment that
    restates the line below it is deleted. A comment that names the invariant,
    the row, the spike, or the gap number is kept.
14. **Names are the doc's names.** `Chain`, `Composed`, `SpawnPlan`, `Slot`,
    `Blocker`, `Grant`, `Group`. If the doc calls it a grant, the variable is
    not `permission`.
15. **Messages are sentences a person can act on.** *"Marketing interns holds
    no group with an entry for `crm`. Ask a Marketing admin to narrow one into
    the sub-team."* Never *"resolution failed: crm"*. Every message is in the
    doc's failure-mode table before it is in the code.
16. **British spelling in prose and messages; American in identifiers where
    the ecosystem does** (`color` in CSS, `authorization` in HTTP headers).

21. **A provider is a directory with known contents.** `adapters/<provider>/`
    holds `locate`, `render`, `rehydrate`, `launch`, `probe`, `import`, one
    per file, plus `index.ts` assembling the `Adapter`. Nothing provider-
    specific lives outside its directory; nothing shared lives inside one.

## 4. Tests

17. **Test the thing, not a mock of it.** Git tests use git in a tmpdir. Proxy
    tests open a socket. Sandbox tests spawn a child under the profile. Mocks
    are allowed only for the network edge to `api`, and each mock's shape is
    checked against `00 §4.10`.
18. **A named test in the doc exists before the code merges.** Reviewers
    search by name.
19. **Idempotency is a test.** Any operation the doc calls idempotent has a
    test that runs it twice and asserts zero writes on the second run.
20. **A security property has a negative test.** "The agent cannot read
    `~/.ssh`" is a test that tries, from inside the jail, and asserts the
    failure. An unexpected success fails the test *and* the boot (`00` I5).

## 5. Review checklist

Before approving a change to the engine:

- [ ] Which invariant (`00 §1`) and which doc section does this implement?
- [ ] Does it add a type outside `00 §4`? Then it goes in `00 §4` first.
- [ ] Does it add a runtime dependency, a flag, a fallback, or a catch? Which rule above permits it?
- [ ] Is the module still under its budget (`00 §8`)? If not, where is the sentence saying why?
- [ ] Do the named tests exist, and does at least one try to break the property?
- [ ] Is every user-facing string in the doc's failure-mode table?
- [ ] Did the replaced code leave with it (`00 §6`)?
- [ ] Which constraint rows (`00 §5`) does this touch, and are they still true?
