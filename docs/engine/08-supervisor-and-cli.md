# Engine Plan — 08 · The supervisor and the CLI

## 1. Purpose

`harness` is one process with two lives. Between sessions it is a small git
client with a login token. During a session it is the **supervisor**: the only
process on the machine that holds anything valuable — the login token, the
minted credentials (inside the proxy's memory), the assets git directory — and
the parent of a jailed provider that holds nothing. This document specifies
that process end to end, and every command a person can type.

Nothing here decides policy. Composition (01), preflight (03), the broker
(04), the proxy (05), the sandbox (06) and adapters (07) each own a decision;
this document owns the order they run in, the process that runs them, and the
words a person sees.

## 2. Invariants

| # | Invariant | From |
| --- | --- | --- |
| S1 | The supervisor is never inside the jail; the jail never holds a token, a key, or a parent-shell variable. | I3, C27, C28 |
| S2 | One work tree, whatever the harness, whatever the flag. `pull`, `status`, `reset`, `adopt`, `push` never read the selection. | C14 |
| S3 | Only hydration moves `refs/harness/remote`; `push` commits to the person's own branch and nothing else. | C31 |
| S4 | A policy change ends the session. The supervisor polls session validity, never refs. | C33 |
| S5 | Fail closed on silence: a control plane unreachable past the TTL ends the session. | I5 |
| S6 | Every git invocation carries the C30 flags; the git dir is outside the work tree. | C30 |
| S7 | The selection file is outside the agent-writable tree. | C16 |
| S8 | Every person-facing failure is a `Blocker`; a stack trace never reaches a person. | 10 §3 |
| S9 | The session records everything it was offered: `preflight.json` is written whole before any spawn. | C17 |
| S10 | An assigned id that resolves to nothing is shown, never hidden: `status` lists it as *in no harness of yours* and `preflight` reports it as a slot. | C18 |
| S11 | The hook trail (`audit.jsonl`) is telemetry; the proxy's `endpoints.jsonl` is the authoritative record, and the supervisor forwards both under their own class. | C29 |

## 3. Contracts used

From `00 §4`, by name and unchanged: `Chain`, `ChainNode`, `Composed`,
`Choices`, `SpawnPlan`, `Enforcer`, `PreflightReport`, `Blocker`, `Slot`,
`MintedCredential`, `EndpointEvent`, `EndpointTally`, `HarnessDef`,
`RenderContext`, `Adapter`, `Located`. Server endpoints from `00 §4.10`,
including `POST /v1/requests` and `POST /v1/requests/{id}/withdraw`, and
`GET /v1/me`'s `role: { level, at }`.

## 4. Module layout

`engine/cli/src/`. Ceilings: core 1,200; commands and output 700 (`00 §8`).

| File | Exports | LOC | Does |
| --- | --- | --- | --- |
| `cli.ts` | — | 12 | `#!/usr/bin/env node`; `main()` → `process.exitCode` |
| `main.ts` | `main` | 80 | argv → command; usage errors (exit 2) |
| `run.ts` | `run` | 90 | the boot table (§6) as a sequence of calls; **no logic of its own** |
| `session.ts` | `createSession`, `writeReport`, `sessionDir` | 80 | session directory, ids, spools pre-created (0600) |
| `env.ts` | `childEnvironment` | 50 | §7 |
| `spawn.ts` | `spawnConfined` | 70 | §8 |
| `supervise.ts` | `supervise` | 140 | §9 |
| `spool.ts` | `forwardSpool` | 40 | one helper for both spools (D105) |
| `exit.ts` | `closeSession`, `tally` | 60 | §10 |
| `git.ts` | `g`, `gAt`, `gNet`, `ensureRepo`, `worktreeTree`, `withIndex`, `differs`, `fetchChain` | 130 | as today plus the fetch (01 §7); `gNet` adds the login token as a header (§11 preamble, 00 D24a) |
| `hydrate.ts` | `hydrate` | 170 | `asset-sync.md` §4 unchanged plus row 0; `incoming` := `Composed.tree` (01 §7.4) |
| `credentials.ts` | `readCredentials`, `writeCredentials`, `credentialsPath` | 45 | login token; legacy migration deleted (D110) |
| `selection.ts` | `readSelection`, `writeSelection`, `selectionPath` | 45 | `$HARNESS_HOME/harness.json` |
| `api.ts` | `api` | 40 | bearer fetch; attaches `status`, `code`, `detail` |
| `commands/<name>.ts` | one verb each | ≤ 80 each, ≤ 590 together | §11 |
| `os/shell.ts` | `Shell`, `shell`, `word`, `appleString`, `psString` | 90 | the one seam every per-OS call goes through, so a test asserts all three platforms from one machine (D140) |
| `os/scheme.ts` | `registerScheme`, `unregisterScheme` | 110 | §11.22's table |
| `os/picker.ts` | `chooseWorkspace`, `alert` | 130 | §11.24's native dialogs |
| `os/terminal.ts` | `openTerminal`, `runLine` | 60 | §11.24's terminal |
| `output.ts`, `style.ts` | `say`, `blocker`, `table`, colours | 110 | §12 |

Preflight, enforcers, the proxy, the sandbox and adapters are separate modules
with their own documents; `run.ts` imports them and calls them in order.

## 5. Process model

### The session directory

`~/.harness/sessions/<id>/`, created by `createSession` before anything else
touches disk. `<id>` is a UUID minted by the CLI (the server accepts it as the
session id, as today).

| Path | Written by | Readable inside | Writable inside | Purpose |
| --- | --- | --- | --- | --- |
| `preflight.json` | supervisor, once, before spawn | yes | no | the whole `PreflightReport` (S9) |
| `agent/` | adapter `render` | yes | provider state only, per 07 | generated config, symlinks into the work tree |
| `agent/rendered.json` | adapter `render` | yes | no | what render wrote, for `rehydrate` (07 §5) |
| `audit.jsonl` | the extension / hooks | yes | **append** | the attested spool, 0600, pre-created empty (C28) |
| `endpoints.jsonl` | the proxy | no | no | the authoritative log (05); lives outside the jail's read set |
| `proxy.sock` | the proxy (Linux) | bound in | connect only | the jail's only exit (06) |
| `tmp/` | anyone | yes | yes | private temp; `TMPDIR` inside the jail |

Everything else under `~/.harness/` — `assets.git`, `harness.json`,
`agents/`, other sessions — is denied to the jail by 06's geometry.
`~/.config/harness/credentials.json` is in `denyRead` explicitly (C27: `HOME`
is real, so denial is explicit).

### What the supervisor holds

| Thing | Where | Never |
| --- | --- | --- |
| the login token | `credentials.json`, read into memory for the boot | in the child env, in any file the jail can read |
| minted credentials | the proxy's connector table, in memory | on disk, in env, in a log |
| the assets git dir | `~/.harness/assets.git` | writable from the jail |
| the session secret | the proxy URL in the child env (that is its purpose) | reused across sessions |

## 6. `run`

`harness run [<provider>] [--<harness>] [--team] [--as <member>] [--model <provider>/<id>] [--offline] [-- <passthrough…>]`

**Grammar** (agents.md §2, unchanged): exactly one undashed word before `--`
is the provider; at most one dashed word that is not a reserved flag is the
harness; everything after `--` is the provider's, verbatim and unread. An
unknown provider word is an error naming what is installed, never passed
through. One adapter installed and no word → it; several and no word → ask,
never guess.

**The boot table.** `run.ts` is this table and nothing else. Each row is one
call; each call either returns or throws a `Blocker`; the first `Blocker`
ends the boot with that message and exit code 1. Rows 1–3 are also `pull`;
rows 1–10 are also `preflight` (§11.13), which closes the proxy instead of
spawning. `--offline` skips row 1 only (below).

| # | Phase | Call | Module | Doc |
| --- | --- | --- | --- | --- |
| 0 | Parse | `parseRun(argv)`; `selectAdapter(word)` — zero I/O | `main.ts`, 07 registry | — |
| 1 | Fetch | `fetchChain(credentials)` → `Chain` (the refs the server advertised, root first) | `git.ts` | 01 §7, 02 |
| 2 | Compose | `compose(chain, reader)` → `Composed`; non-empty `conflicts` → `compose.*` blockers | `@harness/compose` | 01 |
| 3 | Hydrate | `hydrate(composed, notify)` — the full composed set, never the harness subset (S2) | `hydrate.ts` | 01 §7.4 |
| 4 | Choose | `choose(composed, { provider, harness, team, as, model })` → `Choices`; includes `adapter.locate(pin)` → `Located` (07) | 03, 07 | 03 |
| 5 | Mint | `mint(session, choices, aliases)` → `MintedCredential[]`, `Slot[]`, blockers — the aliases come from the needs walk over the loaded set | 04 client | 04 |
| 6 | Plan | `plan(composed, choices, minted)` → `SpawnPlan` through the enforcer list | 03 | 03, 05, 06 |
| 7 | Render | `adapter.render(ctx)` → `RenderReport`; dropped concerns printed once | 07 | 07 |
| 8 | Fence | `startProxy(plan, credentials)` → `{ url, retire, close }` — started before the probes so they can reach it | 05 | 05 |
| 9 | Probe | local login probes — only for a `deferred` credential slot whose `via.sources === "vault-or-local"` (00 §4.6, 04 D60); a `vault` slot is never consulted locally; `rehydrate` ≟ plan; sandbox self-test and adapter probe under the profile, via `spawnConfined` | 03, 06, 07 | 03 |
| 10 | Report | `writeReport(sessionDir, report)`; `report.passing` false → `proxy.close()`, print blockers, exit 1 | `session.ts` | 03 |
| 11 | Spawn | `spawnConfined(plan, adapter.launch(ctx, choices.located), passthrough, { dir: sessionDir, proxyPort })` | `spawn.ts`, 06 | §8 |
| 12 | Supervise | `supervise({ child, session, proxy, credentials })` | `supervise.ts` | §9 |
| 13 | Exit | `closeSession(...)`; exit code = child's | `exit.ts` | §10 |

**`--team`** runs the session on the team's version. In the branch model this
means exactly one thing: row 4 sets `Choices.view = "team"`, and the load set
(03 §5.3 step 4) replaces every asset whose winning copy is the person's own
with its `shadows` copy — the team's — or drops it when the person alone
holds it. Compose is not re-run and the chain is not truncated. Nothing
else changes: the work tree is still the person's (S2), hydration still ran
over the full chain, and any file the person edits during the session is in
their work tree and commits to their own branch on the next `push`
(prd-v2 §17.2). `--team` is a per-run override and is never written to
`harness.json`; `switch --team` persists it (§11.2).

**`--as <member>`** lets a team admin run a session on another member's
branch (prd-v2 §18). Row 0 calls `GET /v1/me?as=<member>` (00 §4.10): it
returns the member's `Chain` when the caller's `role.at` is on it, else `403`
→ `cli.as_not_admin` before any fetch. Row 1's fetch then receives the
member's user ref, which `definitions` advertises to that admin as a
`readable` ref (02 §5.2, §6.1), so a stale or forged claim fails there too.
Row 2 composes the member's chain, which ends at the member's user node as
01 §6 requires. The
session is **read-only in the one sense that matters**: `push` and `offer`
refuse while `--as` is active (`cli.read_only_as`), because a commit made
under `--as` has no branch it may honestly land on. Taking something from a
read branch is *promote*, and promote is the console's verb, not the CLI's.

**`--model <provider>/<id>`** overrides the model choice for this run. Row 4
accepts it only if it is in *approved for* at the narrowest scope that names
one — harness, then provider, then team (03) — else 03's `preflight.model_not_approved`
naming what is approved. The default is never absolute (00 D23): a person may
also `/model` mid-session within the same approved set, which the proxy's
connector for the model provider already permits because it is one upstream.

**`--offline`** skips row 1. Row 2 composes from the `Chain` recorded at the
last successful fetch in `assets.git/chain.json` (01 §7.2 step 5) against
`refs/remotes/origin/*`; no file → `cli.offline_no_refs`. Every other row
runs unchanged:
minting still needs `api`, and the supervisor's silence TTL (§9) still
applies. `--offline` is for a slow or unreachable `definitions`, not for
running without the control plane; a session with no minted credential
(native mode) is the only kind that starts with `api` down, and it ends after
the TTL like any other.

**Passthrough** is appended to the adapter's argv after the sandbox wrapper
is applied (06), so it can never place anything outside the profile.

## 7. Environment

`childEnvironment(input)` builds the child's environment from nothing. The
parent's environment is consulted only for the named keys below.

| Key | Value | Why |
| --- | --- | --- |
| `HOME` | verbatim | `~/.harness` paths must resolve inside the jail (C27); denial under it is explicit in 06 |
| `PATH` | `<envDir>/python/bin`, `<envDir>/node/bin`, then the parent's `PATH` filtered to `/usr/`, `/bin`, `/sbin`, `/usr/local/`, `/opt/homebrew/` | the harness's own interpreters and installed CLIs first (D30l); system binaries only after; no user-installed shims |
| `VIRTUAL_ENV`, `UV_PROJECT_ENVIRONMENT` | `<envDir>/python` — a venv `run` creates once per harness with `python3 -m venv`, before spawn, offline | `pip`/`uv` install here and nowhere else; `PIP_REQUIRE_VIRTUALENV=1`, `PYTHONNOUSERSITE=1` make the machine's site-packages unreachable |
| `npm_config_prefix`, `NPM_CONFIG_PREFIX` | `<envDir>/node` | `npm i -g` lands here; project-local `node_modules` stay the project's |
| `GOPATH`, `CARGO_HOME`, `GEM_HOME` | `<envDir>/{go,cargo,gem}` | the same for Go, Rust and Ruby — directories, created empty |

`envDir` is `<HARNESS_HOME>/envs/<harness id>` — one per harness, kept between sessions, inside the write geometry (06 §7.1) — or `envs/everything` for a run with no harness. Installing into it needs reach: `pypi.org`, `registry.npmjs.org` and the rest are refused by the tunnel unless `policy/reach.json` names them — `allow` with the host on the list, or `on` without it on the deny-list (01 D131, 05 §6a). A personal account is seeded with the suggested list, so a hobby user's first install works (01 D135); an enterprise starts `off` and an org admin turns it on under Boundaries → Reach. A connector for the host works too. A machine without `python3` gets every other home and one line saying so.
| `TERM`, `LANG`, `TZ` | copied if present | terminal correctness |
| `TMPDIR` | `<sessionDir>/tmp` | private temp inside the geometry |
| `HARNESS_SESSION_ID` | `<id>` | opaque; for the extension's header and the spool |
| `HARNESS_SESSION_DIR` | `<sessionDir>` | where the spool is |
| `HTTP_PROXY`, `HTTPS_PROXY` | `http://harness:<secret>@127.0.0.1:<port>` (macOS) or the forwarder's loopback port (Linux, 06) | the only exit |
| `NO_PROXY` | the proxy's own host (`127.0.0.1`) | the inject leg goes to the proxy directly; nothing else bypasses it (05 §4) |
| `HARNESS_SESSION_SECRET` | the same secret | what Pi's `models.json` presents as its API key (07 §7); worth nothing outside this session's proxy (05 §4.2) |
| adapter additions | from `adapter.launch().env` | provider state pointers, telemetry opt-outs (07) |

Absent by design, and asserted absent by test: the login token, any provider
key, any control-plane URL, `HARNESS_REDACTIONS` (deleted, 00 §6), and every
other variable in the parent shell. An adapter key that collides with a core
key is a bug: `childEnvironment` throws (not a `Blocker`) at plan time (C6,
03 §5.7 row 4).

**Tests.** `no_parent_env_leaks` — set a canary list in the parent
(`HARNESS_API_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `NPM_TOKEN`,
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SSH_AUTH_SOCK`) and assert none is in
the result. `adapter_env_override_throws` — an adapter returning `HOME` or
`HTTP_PROXY` is refused. `no_key_in_child_env` (T3) — inside the jail, no
environment variable's value equals any minted credential value; only the
session secret is present (07 DoD, 09 M3).

## 8. Spawn

`spawnConfined(plan, launched, passthrough, session)`:

1. `argv := confine(plan, [...launched.argv, ...passthrough], session)` — 06
   prepends the OS wrapper (`sandbox-exec -p <profile>` or `bwrap …`);
   `session` is `{ dir: sessionDir, proxyPort }` (06 §3). The probes (row 9)
   go through this same function with a probe argv, so the wrapper is
   identical (06 D88).
2. `env := childEnvironment({ …, adapterEnv: launched.env, proxyUrl })`.
3. `spawn(argv[0], argv.slice(1), { stdio: "inherit", env, cwd: workspace })`.
   The workspace is the directory `harness run` was invoked in.
4. Signals: `SIGINT` and `SIGTERM` in the supervisor are forwarded to the
   child; the supervisor then waits for the child to exit, runs §10, and exits
   with 130 (`SIGINT`) or the child's code. A second `SIGINT` within 5 s sends
   `SIGKILL`.
5. `error` on spawn (binary vanished between `locate` and spawn) is
   `cli.spawn_failed` with the path in the message.

If the child exits before the first supervise tick, §10 still runs: the
session is closed with whatever the spools hold, which may be nothing.

## 9. Supervise

`supervise({ child, session, proxy, credentials, intervalMs = 15_000 })`
returns `{ stop(): Promise<void> }`. One timer, one `tick`, never two ticks
in flight (`running` guard as today).

Each tick, in order:

1. **Forward the attested spool.** `forwardSpool(audit.jsonl, offset, batch =>
   POST /v1/audit/batch { events: batch })`, ≤ 100 lines per call. On failure
   the offset is kept and the tick continues (D18).
2. **Forward the authoritative spool.** `forwardSpool(endpoints.jsonl, offset,
   batch => POST /v1/sessions/{id}/endpoints { events: batch })`. Same helper,
   same offset rule (D105). The proxy appends `EndpointEvent` lines; the
   supervisor never writes this file.
3. **Heartbeat.** `PATCH /v1/sessions/{id} { last_active_at }`. Its answer
   is the session's validity — the same body `GET /v1/sessions/{id}` returns
   (D145) — so a tick is one request. `GET` is made only when the heartbeat
   failed or answered without a `status`.
4. **Validity.** The heartbeat's answer, or `GET /v1/sessions/{id}` →
   - `retired: string[]` non-empty → for each alias `proxy.retire(alias)`;
     print once per alias: *The `<alias>` credential was retired by your
     organization; requests using it will be refused from now.*
   - `status: "revoked"` → `proxy.close()`; `SIGTERM` the child; after 10 s
     `SIGKILL`; print *This session was ended by your organization: <reason>.*
     (C33). Exit code 1.
   - `status: "closed"` (closed elsewhere) → same as revoked, message *This
     session was closed from the console.*
5. **Silence.** If steps 3 and 4 both fail, note `lastOk`. The first failure
   prints once: *Cannot reach the Harness API; this session will end in 15
   minutes unless it comes back.* When `now − lastOk > ttl` (D104: 15 min),
   treat as revoked with reason *the Harness API was unreachable for 15
   minutes* (S5).

Not done here, by design: re-reading refs or `preflight.json` to detect a
policy change (S4). A tightened boundary or a narrowed grant reaches a running
session as `revoked` or `retired`, set by `api` when `definitions` reports
the policy push (02 §8.3 step 5b; 04 §5.5); the supervisor does not
second-guess it.

`stop()` clears the timer, awaits the child's exit, runs one final tick with
both spools, and returns.

## 10. Exit

### 10.0 Exit review

Before the session closes, the supervisor shows what changed and offers to
keep it. This is the moment the homepage's hero animation draws (*Keep the
change to marketing-deck?*) and it is the only prompt `run` ever makes.

1. `W₁ := worktreeTree()`; `W₀ := preflight.composed.tree` (recorded at boot,
   01 §7). `changed := keys where differs(W₀, W₁, key)`, sorted. `made :=
   directories <kind>/<name>/ on disk under the work tree that hold at least
   one file, no `asset.json` and no key in W₀` — what the agent created this session
   (07 §6a tells it where), sorted. `removed := keys in W₀ with no directory
   on disk` — what the session deleted (D130), sorted, minus two kinds of
   absence that are not deletions:
   - a key the subscription never materialised (01 §8 row 0) — `W₀` is every
     winning asset on the chain and the work tree is only what this person is
     subscribed to, so the rule is `hydrate.ts`'s `subscription` and there is
     no second copy of it;
   - a **required** key (W5-D10), which is in every session's load set and so
     cannot leave a harness. One line says so — *`skill/harness-authoring` is
     required, so it stays in every harness; the next session delivers it
     again.* — and the review never offers it, because a question it would
     then refuse is worse than the sentence that explains it.
2. `changed`, `made` and `removed` all empty → print nothing and continue to
   `closeSession`.
3. Not a TTY, or `--non-interactive` → print one line per key and the exact
   `harness push <key> --message "…"` for each, and one line per `made`
   directory with the exact `harness adopt ~/.harness/assets/<kind>/<name>`,
   and one per `removed` key with `harness remove <key> --harness "<name>"`;
   continue. Never a prompt.
4. TTY → render the **exit frame** (`screens.ts` `exitScreen`, W5-D12): the
   same header the boot screen opened with (§11.1), then one column of keys
   with `+n −m` per changed key (from `git diff --numstat`), `made`
   directories as *made this session* and `removed` keys as *removed this
   session*, then ask once:
   **`Keep these as yours? All / None / Pick`**. The prompt is the
   frame's last line and the caller asks it rather than printing it, so there
   is one question and one copy of its words (`KEEP_PROMPT`). Keeping
   a `made` directory is `adopt` in place (§11.11: the sidecar is minted, the
   kind checked against `policy.kinds`) and then the same `push`.
   - `a` → `push` every key with one message prompt (`--message` applies to
     all; per-key messages are what `pick` is for).
   - `n` → continue; the work tree is untouched and `harness status` shows
     it later.
   - `p` → a checklist (space toggles, enter confirms); each ticked key gets
     its own message prompt; unticked keys are left as they are.
5. Every push is 01 §7.3 exactly — one path, one commit on the user branch,
   one refspec.
4c. **Keeping a removal** (D130) deletes the person's own copy from their
   branch when the delivered copy was theirs (`PushSource.kind: "absent"`);
   a copy the team or organization holds is not theirs to delete. Then 5b.
5a. **Kept assets join the session's harness** (D118, D119). The review never
   asks which: the person ran *in* a harness — the one they switched to, or
   the one `--<name>` named — and what they kept is their version of it.
   Non-TTY prints each `harness push … --harness "<name>"`, naming that
   harness, because a `--<name>` run leaves no selection behind. Then, after
   the pushes: `harnesses/<id>.json` is pushed onto
   the person's own branch — the harness's id kept (D3, the person's version
   of it), `assets` extended with the kept ids — as one commit, and *Added to
   <name> (your version): …* is printed. No selection, or nothing new: nothing
   happens. Nothing here can reach the team branch; *offer* is a
   separate verb the summary names: *`harness offer <key>` proposes it to
   Marketing.*
5b. **Kept removals leave the session's harness**: the ids come out of the
   person's version of the harness definition, one commit — the mirror of 5a.
   Removing every asset this way empties the harness; the harness itself is
   not deletable from a session (that is the console's verb).
6. A push that fails (`409`, network) is printed with its blocker and the
   review continues with the next key; the session still closes.

Test: `exit_review_lists_only_changed_keys`, `exit_review_pick_pushes_subset`,
`exit_review_non_tty_prints_commands`, `exit_review_never_touches_team_ref`,
`exit_review_lists_made_directories`, `exit_review_keep_adopts_then_pushes`,
`exit_review_kept_callback_gets_every_kept_key_once`,
`exit_review_never_offers_to_remove_a_required_asset`,
`exit_review_ignores_a_key_the_subscription_never_materialised`,
`required_assets_cannot_leave_a_harness`. The two frames are
`engine/cli/test/screens.test.ts`, snapshotted with colours stripped, with
and without a drawing, at eighty columns.

### 10.1 Closing

`closeSession({ session, proxy, child, adapter, choices })`:

1. Final tick (§9) so nothing is left in either spool.
2. `tally(endpoints.jsonl)` → `EndpointTally[]`, grouped by `(host, port,
   alias)`, `refused` counting `mode: "refused"` rows.
3. `PATCH /v1/sessions/{id} { status: "closed", endpoints: tally }`.
4. `proxy.close()` — connector table zeroed.
5. If `choices.model` is native mode: `harvestAgentCredentials` (07 §11; the
   OAuth refresh may have rotated the file).
6. Print one line:
   `Session 4f2a · 41 min · 3 endpoints reached · 0 refused · 12 files changed — \`harness status\` to review`
   where *files changed* is `worktreeTree()` vs `refs/harness/remote`, counted
   by key.
7. Exit with the child's code (or 130).

If step 3 fails, the tally is written to `<sessionDir>/close.json` and the
next `harness` invocation of any kind retries it before doing its own work
(`session.ts` `flushPendingClose`). A session is never silently unclosed.

**The controls (1 Oct).** The review is drawn, not typed at. No landing
on the way out — the person has just left the session and knows where they
were. `<harness> changes`, then every change on its own line, sorted by
kind: the kind in grey, the name, and what happened — `+n` in green, `−m` in
red, *new* in green, *removed* in red. Then a cursor menu (`prompt.ts`)
offers **All**, **None** and **Pick**; arrows or `j`/`k` move, enter chooses,
escape or `q` is *None*. Only *Pick* opens a checklist of the same rows,
space ticking and enter keeping. Then **one** message for everything kept:
the line shows *enter for the default* as a placeholder until the first
character, then only what is typed; enter alone takes the default,
`Update <key>` per key. While the pushes go out the
loading pixels say *saving*; the one closing line is a green `✓ progress
saved to your <harness>`, and nothing when nothing was kept. The per-key
*Pushed … to your version* and *Added to …* lines the verbs print are quiet
inside the review, and the old *Session … — `harness status` to review*
summary is gone (the console has it). A pipe still gets step 3's commands,
since a pipe cannot move a cursor.

## 11. Commands

Each subsection: syntax · does · git underneath (always through `g()`, which
carries `-c core.hooksPath=/dev/null -c core.fsmonitor=false
-c core.fileMode=false` and `--git-dir` outside the work tree, S6; network
invocations go through `gNet()`, which adds
`-c http.extraHeader=Authorization: Bearer <token>` on the command line and
**never** writes the token to `assets.git/config` — 00 D24a) · server calls ·
output · exit codes · failure modes. The verbs match the console's
command sheet (`prd-v2.md` §17.2) word for word; `harness commands` prints
that sheet.

### 11.1 `run`

A session always runs in a harness (D119): the selection, or `--<name>` for
this run; neither is `cli.no_harness`.

§6. Exit: the child's code; 1 on a blocker; 2 on usage; 130 interrupted.

**The loading pixels** (1 Oct). The moment `run` starts — before
credentials, compose or preflight — `loading.ts` draws one line in place: a
six-cell strip with a lit run sweeping across it in the accent, and the word
*starting*; it is cleared the instant the landing is ready, so the wait is
visibly a wait. The same strip says *closing* from the child's exit until the
review has something to say. Not a TTY: nothing is drawn.

**The landing** (W5-D12; redrawn 1 Oct, twice). `landing.ts` draws what a
session *is* — the harness's drawing, its name in a pixel font, its
description and four facts — for a given width, and two things show it:

- **A runtime that draws its own start-up** (Claude Code; `Adapter.landing`
  absent or `"theirs"`): `run` prints the landing after preflight passes and
  before the spawn, then a rule across the terminal naming the provider.
  Ours ends at the rule; the provider's splash follows and we do not cut in.
- **A runtime whose landing is ours** (Pi; `Adapter.landing: "ours"`): `run`
  prints only the rule, and Pi draws the landing as its own **header**, so
  the person arrives at the frame with the prompt box under it, and the
  frame is re-laid-out at every resize. The Pi adapter writes `quietStartup`
  into the session's settings (Pi's start-up listing is off — the landing is
  the introduction) and a `landing` entry into `policy.json`: the frame's
  inputs as data and the path to this CLI's own `dist/landing.js`, which the
  extension imports at `session_start` and calls with the width Pi gives
  its header. One renderer, three places; the extension never holds a copy
  of the font or the drawing code. A renderer that cannot be imported is a
  notice, never a failed session.

```
                     ▄▀▀▀▀ █   █ █▀▀▀▄ █▀▀▀▄ ▄▀▀▀▄ █▀▀▀▄ ▀▀█▀▀
       ██████        ▀▄▄▄  █   █ █▄▄▄▀ █▄▄▄▀ █   █ █▄▄▄▀   █
    █████████   █        █ █   █ █     █     █   █ █ ▀▄    █
    █████████  ▄█    ▀▀▀▀   ▀▀▀  ▀     ▀      ▀▀▀  ▀   ▀   ▀
      ▄▄█████████
        ███████▀
          ▀███
        ▀▀▀▀▀

  The support desk's harness.
  delivers  3 skills · 1 prompt · 2 memories
  model     anthropic · claude-sonnet-5
  reach     allow-list, 6 hosts
  in        /tmp/marketing-deck

  ── Starting Claude Code ──────────────────────────────────────────────────────
```

- **The drawing** is `HarnessDef.icon` in half-block cells, two pixel rows
  per line (`pixels.ts` `renderIcon`, the same function `switch` uses):
  sixteen columns by eight rows. A cell whose two pixels share a colour is a
  full block in the foreground alone; two colours are the upper as the glyph
  over the lower as background; a half-lit cell leaves the terminal's own
  background where the drawing is clear. (A first redraw used solid background cells,
  sixteen rows by thirty-two columns — robust, and too big beside a prompt.)
  A harness with no palette yet — what `harness new` mints — is a grey
  square, so the frame keeps its shape.
- **The name** is drawn in a 5×7 pixel font (`font.ts`, capitals,
  half-blocks, four rows a line) beside the drawing, and the layout follows
  the room there: one line when it fits, wrapped at hyphens to two when it
  does not, and plain bold text when even two lines would not hold it. The
  **description** is the first line of the facts below the block. Whose
  version this is is not said here: the exit review and the console say it
  where it matters.
- **delivers** is `layout.ts`'s `deliveredCounts(deliveredSets(loaded))` —
  the same count the brief's *This harness delivers…* line uses, computed
  once (W5-D12).
- **model** is `modelBrief(choices)`: `provider · model`, or *your own
  sign-in · not metered* for a native session (C22). The one-line
  `Using your organization's model…` summary `run` used to print above the
  frame is gone; the frame says it.
- **reach** is `reachBrief(plan.reach)`: *off* · *allow-list, n hosts* ·
  *on* · *on, n hosts denied*. The long form the preflight report prints is
  `reachWords` in `preflight/report.ts`; neither is a copy of the other.
- **The facts** sit below the block at the gutter, and the exit review's
  table takes the same column. Everything is cut to the width with an
  ellipsis; colour is off whenever `style.ts` says so (`NO_COLOR`, not a
  TTY, `TERM=dumb`, CI).
- **delivers** is `layout.ts`'s `deliveredCounts(deliveredSets(loaded))` —
  the same count the brief's *This harness delivers…* line uses, computed
  once (W5-D12).
- **model** is `modelBrief(choices)`: `provider · model`, or *your own
  sign-in · not metered* for a native session (C22). The one-line
  `Using your organization's model…` summary `run` used to print above the
  frame is gone; the frame says it.
- **reach** is `reachBrief(plan.reach)`: *off* · *allow-list, n hosts* ·
  *on* · *on, n hosts denied*. The long form the preflight report prints is
  `reachWords` in `preflight/report.ts`; neither is a copy of the other.
- Everything is cut to the terminal's width with an ellipsis, and the frame
  reads at eighty columns. Colour is off whenever `style.ts` says so
  (`NO_COLOR`, not a TTY, `TERM=dumb`, CI).
- **Not a TTY**: the same facts as plain lines, no drawing —
  *test-harness-1 — <its description>*, then `delivers`,
  `model`, `reach`, `in`. The existing one-line summary (§12) stays above it.

The exit review (§10.0) opens with the same header, which is what makes the
two frames one visual language rather than two screens.

### 11.2 `switch [<name> | <unit-path>/<name>] [--team] [--none]`

`--none` clears the selection; the next `run` then needs `--<name>` (D119).

Picks the harness the next `run` uses, and which version. Writes
`$HARNESS_HOME/harness.json` = `{ harness_id, name, version: "mine" | "team" }`
(S7). Name matching is 03 §5.2 step 4's function, so the two commands cannot
disagree: ambiguity lists the qualified forms (`preflight.harness_ambiguous`);
no match lists what exists (`preflight.harness_unknown`); exit 1. `--none`
deletes the file.
Harnesses are read from `Composed.harnesses` after rows 1–2 (no server call
beyond fetch). Output: the harness card (drawing left, name and description
right) then *`harness run` to start* or, with `--team`, *`harness run` to
start on the team version — anything you change still lands on your version.*

### 11.3 `pull`

Rows 1–3. Prints each hydration notice as it happens and one closing line:
*Up to date. `harness status` shows what you have changed.* No selection is
read (S2). Exit 0; 1 on a compose blocker.

### 11.4 `status [--json]`

No network. For every key in `versions.json` at `refs/harness/remote`:
`clean` · `modified` · `conflict` (dirty **and** the delivered tree moved
since — detected as in `asset-sync.md` §4) · `override (team at v<n>)`.
Then keys present in the work tree and absent from `versions.json`: *`<key>`
is yours only — `harness push` to keep it, `harness adopt` if you made it by
hand.* `--json` emits `[{ key, state, shadows }]`. Exit 0 always.

### 11.5 `diff [<key>] [--team] [--git]`

`diff <key>`: work tree vs `refs/harness/remote` at `<key>` — yours against
what was delivered. `diff <key> --team`: work tree vs the team's copy — the
`shadows.tree` recorded for the key in `versions.json` (01 §7.5), or the
delivered tree itself when the key is not an override. No `<key>`:
every key that differs, one line each (*`skill/brief` · 3 lines changed · you,
2 days ago*). Default output is a plain sentence per hunk group (*Added the
retry rule. Removed the old timeout paragraph.* — from the commit message when
one exists, else *N lines added, M removed*); `--git` prints the raw hunk.
Underneath: `g("diff", a, b, "--", key)` with `a`/`b` tree-ish. Exit 0; 1 if
`<key>` is unknown (`cli.key_unknown`).

### 11.6 `log [<key>] [--team] [--git]`

`log <key>`: commits touching `<key>` on the person's branch (`main`, as
today); `--team`: on the team branch. Each version is a sentence with the
files it touched underneath and its short hash as a chip; `--git` prints
`git log --oneline`. Underneath: `g("log", "--format=…", ref, "--", key)`.
Exit 0.

### 11.7 `push <path> --message "…" [--harness <name>]`

*Keep as mine.* Publishes the person's version to their own branch only —
nobody reviews it, it follows them between machines, and it shadows the
team's copy for them alone. **A push always lands in a harness** (D118): the
selected one, or the one `--harness` names; with neither the push is refused
`cli.no_harness_target` before anything moves. After the asset's commit, a
second commit puts the person's version of that harness on their branch with
the asset listed (01 D3 extended; §10.0 step 5a) — *Pushed `<key>` to your
version. Added to <harness> (your version).* An asset already listed adds no
commit. Nothing is ever loose on a branch, so the console never needs a page
for assets in no harness.

The algorithm is 01 §7.3, steps 1–9, and lives in `git.ts`; this command
adds the words. In short: `key := relative(assetsRoot, path)`, inside the
work tree or `repo.not_in_work_tree`; a missing sidecar is `repo.no_sidecar`
(remedy `harness adopt <path>` — `push` never mints an id, D3, C15); an id
differing from the composed set's at that path is `repo.id_mismatch`; the
branch tree is built from the person's branch plus this one path (never the
work tree), committed on `main`, and pushed with **exactly one refspec,
`main:refs/heads/users/<id>`** — there is no flag, no argument and no code
path that names a team or org ref (test `push_never_targets_team_ref`). If
the server refuses a push to a team ref it says *use `harness offer`* (02
§10 `definitions.not_your_ref`), and `offer` is the verb. A non-fast-forward
is `repo.branch_moved`. The server's pre-receive validates the sidecar and
refuses a new id at an existing path (02 §7 step 9). Print *Pushed `<key>`
to your version.*

Only the one path is committed (01's `push_commits_one_directory`).
`refs/harness/remote` is untouched (S3). Refused under `--as`
(`cli.read_only_as`).

### 11.8 `offer <path> --message "…" [--title "…"]`

*Offer to the team.* `push` (11.7), then open a request the team's admins
decide: `POST /v1/requests { title, reasoning, subject: { kind: "promotion", paths, commit, harness? } }` — the request primitive has two subjects (00 §4.10); the CLI only ever opens the promotion kind
(00 §4.10) — `title` defaults to the message, `reasoning` is the message,
`paths` the keys, `commit` the branch commit the push produced, `harness`
the selected harness's id when one is selected. The response's `id` is
printed. Prints *Offered `<key>` to Marketing · request `r-7f3a` — `harness
withdraw r-7f3a` to take it back.* Several paths may be offered in one request
by passing several `<path>` arguments. Exit 0; 1 if the request is refused
(`cli.offer_refused` with the server's reason).

### 11.9 `withdraw <request-id>`

`POST /v1/requests/{id}/withdraw` (00 §4.10) → `204`. Author only. Prints
*Withdrawn.* Exit 0; 1 if not yours or not open (`cli.withdraw_refused`).

### 11.10 `reset <key> [--yes]` · `reset --all [--yes]`

Discards the person's changes to `<key>` and takes the delivered copy:
`rm -rf <key>`; `g("checkout", "refs/harness/remote", "--", key)`. Confirms
unless `--yes`; non-TTY without `--yes` refuses (`cli.reset_needs_yes`).
`--all` covers every key in the selected harness, or every delivered key when
no harness is selected (D106), listing them before the one confirmation.
Prints *Reset `<key>` to the team's version.* Exit 0; 1 declined.

### 11.11 `adopt <path> [--new-id]`

Moves a hand-made directory into the work tree under `<kind>/<name>/` and
**mints a sidecar** when the directory has none: `asset.json` =
`{ id: <new uuid>, kind }` (D3). A directory that already carries a sidecar
keeps its id — unless its id collides with an asset already on the chain, in
which case `adopt` refuses with `cli.id_collision` and the remedy is
`harness adopt --new-id <path>`, which mints a fresh id regardless. The flag
exists for one more reason: the migration re-ids legacy overrides to their
ancestor's id (02 D46), and a person whose old copy no longer matches is
told to run it. A directory already placed under
`<assetsRoot>/<kind>/` names its kind by where it is (07 §6a — the exit
review's printed `adopt` lines point there, and a `prompt/x/x.md` must not be
re-filed as a memory); otherwise the kind
is asked for if it cannot be told from the shape (`SKILL.md` → skill;
executable `run` → tool; one `.md` → memory); an unknown kind is refused
against `Composed.policy.kinds` (`cli.kind_unknown`). No git operation; the
next `run`/`pull` converges it (asset-sync §4 row 1/2b). Prints *Adopted
`<kind>/<name>`. `harness push <path> --message "…"` to keep it.*

### 11.12 `new "<name>" [--from <harness>] [--team <path> | --org]`

Creates a harness: `harnesses/<id>.json` = `HarnessDef { id: uuid, name,
description: "", icon: blank, assets: [] }` — or, with `--from`, a copy of
that harness's `assets` (ids).

**Where it lands is explicit, and the command says so** (D116). Without a
flag it goes on the person's branch: the file is written to a scratch path
and committed and pushed by 01 §7.3's steps with path `harnesses/<id>.json`
(the same tree-building push as an asset, a different source). Nobody
approves it: it inherits exactly what the person already holds (prd-v2
§17.4). With `--team <path>` (a dotted team path, or the team's last segment
when it is unambiguous on the person's chain) or `--org`, the harness is an
admin's — the CLI calls `POST /v1/harnesses { …, scope }` (00 §4.10), the
same write the console makes, and the server refuses `harness.not_yours` for
anyone who does not administer that node; the CLI prints the server's
sentence. No composition logic lives in the CLI for this: the server commits
on the named ref through D9's helper.

Prints the card, then one landing line in every case:

```
Created on your branch. Only you have it.  (`--team marketing` would make it Marketing's.)
Created on Marketing's branch. Everyone on Marketing inherits it.
Created on the organization's branch. Every team inherits it.
```

then *`harness switch <name>` to pick it up* (for `--team`/`--org`: *`harness
switch "<name>" --team`* — the team's version, §11.2). A duplicate name on the target branch is
`cli.harness_name_taken`. The hint in the first line names the person's
own team; a person on no team (personal) gets no hint.

### 11.13 `preflight [<provider>] [--<harness>] [<section>…] [--json]`  (alias: `doctor`)

Rows 1–10 with no spawn — the proxy is started for the probes and closed
again; renders the `PreflightReport`. It takes the same provider word and
`--<harness>` override as `run` (the console's sheet passes a harness name
this way), so it answers *would this exact run start*. Sections are 03's:
`identity` · `harness` · `provider` · `model` · `credentials` (each slot with
its evidence and `resolved from`) · `reach` (the mode in words, the node that
set it, the credentialed hosts and the deny list — absent is not empty, C32,
and absent reach is `off`, 01 D131) · `assets` (ids, from which node, in this harness or
not) · `drift` · `local` (work tree state) · `env` (what the child would
receive). Each boundary line is labelled `enforced` / `intercepted` /
`advisory` from the plan, never from a static table. `--json` prints
`preflight.json` verbatim; the rendered view and the JSON are the same object
(test `preflight_matches_json`). Exit 0 passing; 1 failing.
`doctor` remains as an alias for one release (D101).

### 11.14 `login [--api-url <url>] [--token <pat>]`

Validates the PAT against `GET /v1/me`, writes `~/.config/harness/
credentials.json` (0600, directory 0700). `--sso` is Later (D29). The
pre-assets-layout migration in `readCredentials` is deleted (D110). Both
refusals name one place for the token — the console's *How this works* page,
under *Set up*, which prints this whole line, origin and token included
(console D105); neither restates the flag the person just typed.

### 11.15 `auth <provider>` · `auth --list` · `auth --logout <provider>`

Runs the provider's own login **outside the jail** into
`~/.harness/agents/<provider>/` (07 §11; C22). Until Spikes 2 and 3 close
(00 D11), `auth pi` and `auth claude` on macOS print the blocking notice from
07 and exit 1.

### 11.16 `whoami`

*acme › Marketing › jo@acme.co* · role · selected harness and version · API
URL. One `GET /v1/me`.

### 11.19 `import <provider> [--from <dir>] [--workspace <dir>]`

Reads an existing provider setup into assets and a harness on the person's
own branch (07 §4a). Prints the fidelity table — carried, partial, dropped —
and ends with `harness switch <name>` and `harness run pi --<name>`.
Nothing is pushed; the exit review or `push` does that. Exit 0 even when
things were dropped (the table is the answer), 1 only when nothing at all
could be read. Test: `import_claude_reports_dropped_hooks`,
`import_is_idempotent`.

A word with no importer (`harness import codex`) is `cli.import_unknown_provider`
(§13) — a refusal whose remedy is the agentic path: start a session and ask
the assistant to extract the setup, which the built-in `harness-authoring`
skill (D30j) knows how to do for the common tools, in the same
carried / partial / dropped terms. Test: `import_unknown_provider_refuses_with_the_agentic_remedy`.

### 11.23 `remove <path…> [--harness <name>]`

The standalone form of §10.0 step 4c/5b, for a removal the review did not
see (the directory was deleted outside a session, or the session predates
D130). Against `refs/harness/remote`, since the directory may be gone: each
person's-own copy is deleted from their branch when the delivered copy was
theirs; the ids leave their version of the harness in one commit; the
directories are removed from the work tree. `--harness` as for `push`
(D118). Prints *Deleted `<key>` from your branch.* per own copy and
*Removed from <harness> (your version): <keys>.*

A key on the organization's `required` list (W5-D10) is refused
`cli.asset_required` **before anything is deleted**: it is in every session's
load set (03 §5.3), so removing it from a harness would be a decision the
next boot undoes. The same guard sits inside `leaveHarness`, which both this
verb and the review go through, so there is one rule and one sentence.

### 11.20 `providers` · `providers approve|beta|decline <id> [--reason "…"] [--teams <path,…>]`

The Providers screen's catalogue from the terminal, for the same person the
console would allow (org admin). Bare `providers` prints one row per runtime
of the composed `policy.harnessProviders` — id, approval, scope, pin, reason
— with no I/O beyond `run`'s own fetch. The three verbs call `PUT
/v1/providers/harness/{id}` with the approval, the reason (`decline` refuses
locally without one — the console asks too) and `scope` (`--teams`, default
*all*). Prints the server's `CommitResult` as *pi approved for every team ·
commit abc1234*. Refusals are the server's sentences (`provider.org_admin_
required`).

### 11.21 `keys add <provider> [--model <id>]`

The model tab's **Set up** verb. `<provider>` must be a row of the composed
`policy.modelProviders` (the seeded presets and anything added since) — a
typo prints the rows. The key is **prompted, never a flag or an argument**:
a key on the command line lands in shell history and `ps`. Non-TTY reads it
from stdin. Calls `POST /v1/providers/model/{id}/setup { key, model }` (00
§4.10) and prints what the one commit did, from its payload: *openrouter ·
key stored in the bundled vault · default for the organization · commit
abc1234*. Personal and enterprise are the same command; on a personal
account the words are the same because they are true.

### 11.22 `setup` · `setup --unregister`

The admin's first hour as a checklist, derived and never stored: fetch,
compose, then five lines from the composed policy and `/v1/me` — a runtime
approved · a model provider with a key · a routing default reaching the
person · a security group granted (enterprise only; personal has `my-keys`
seeded) · a harness the person holds. Each line is ✓ with the fact, or ✗ with
the **exact command** that closes it (`harness providers approve pi`,
`harness keys add openrouter`, `harness new "…"`) and the console route that
does the same. Exit 0 when every line is ✓, else 1. It is the same set of
facts the console's first-run notices read (console 04 §10, 05 §12); there
is no second list.

`setup` also registers the `harness://` link type for the person who ran it
(D140), which is not a checklist line: there is nothing for them to do and
nothing to be ✗ about, so it is done and said — *`harness://` links open
this machine's harness: `<path>`*. It is idempotent. `--unregister` is the
inverse and **only** the inverse: no login, no fetch, no composition, so a
person taking it off a machine can do so with the API down.

Per operating system, exactly (`os/scheme.ts`, one `registerScheme` /
`unregisterScheme` pair):

| OS | Registered | Removed by |
| --- | --- | --- |
| macOS | an AppleScript applet at `~/Applications/Harness.app` whose `on open location` runs the CLI, compiled with `osacompile`, given `CFBundleIdentifier` `co.harness.cli` and `CFBundleURLTypes` (`CFBundleURLName` Harness, `CFBundleURLSchemes` `[harness]`) with `plutil`, then `lsregister -f` | `lsregister -u`, then the bundle |
| Windows | `HKCU\Software\Classes\harness` with `URL Protocol` and `shell\open\command` = `"<node>" "<cli.js>" open "%1"`, three `reg add`s | `reg delete … /f` |
| Linux | `~/.local/share/applications/harness.desktop` with `Exec=<node> <cli.js> open %u` and `MimeType=x-scheme-handler/harness;`, then `xdg-mime default` and `update-desktop-database` when it exists | the file, then `update-desktop-database` |

Nothing is machine-wide (`HKCU`, `~/Applications`, `~/.local/share`), so no
registration asks for a password. The handler names the node binary and
`dist/cli.js` **absolutely**: a handler the operating system launches
inherits none of the person's `PATH`, so `#!/usr/bin/env node` on a machine
whose node is under nvm or Homebrew would fail with no terminal and nobody
to tell.

### 11.24 `open <url>`

What a `harness://` link does when the operating system hands it over
(D140). There is no listener and no daemon: the console writes a link, the
OS finds this CLI, and this verb turns the link into a terminal the person
is looking at.

The one shape: `harness://run?harness=<id>&provider=<id>[&workspace=<abs path>]`.
Anything else — another scheme, another host, a missing parameter, a
relative `workspace` — is `cli.link_malformed`. Then rows 0–2 (`cli.not_logged_in`
if there is no login), the harness by id or name through the same
`resolveHarness` every other verb uses, and the provider both in this CLI's
registry and in the composed `policy.harnessProviders`.

Without `workspace` it asks, natively, because there is no terminal to ask
in: **Open an existing folder** or **Create a new workspace**, then the
folder, then — for the second — the new folder's name, which it creates.
macOS `osascript` (`display dialog`, `choose folder`), Windows PowerShell
(`MessageBox`, `FolderBrowserDialog`, `InputBox`), Linux `zenity` falling
back to `kdialog`. A closed dialog is a cancel: *Nothing was chosen, so no
session was started.*, exit 0. A Linux machine with neither picker prints
the exact `harness run …` command instead (`cli.no_picker`).

Then a terminal in that folder running `harness run <provider> --harness <id>`:
macOS `open -a Terminal` of a 0700 starter script (`$TERM_PROGRAM=iTerm.app`
gets the iTerm equivalent, which only happens when `open` was typed in an
iTerm shell — an Apple Event carries no `TERM_PROGRAM`); Windows `wt -d` when
`wt` is installed, else `cmd /c start cmd /k`; Linux `x-terminal-emulator`,
else `gnome-terminal --working-directory`. A machine with none of them prints
the command.

Every refusal before the terminal exists is shown in a **native dialog** as
well as printed (`display dialog` / `MessageBox` / `zenity --error`): a link
that fails silently is the one failure this verb must not have. Exit 0 when
a terminal was opened or the person cancelled; 1 on a refusal.

### 11.17 `commands`

Prints the command sheet — the same headings and rows as the console's
*Commands* modal, generated from one table in `commands/sheet.ts` that the
web build also imports (build once). Exit 0. The sheet gains a fifth group,
*Set up*, for §11.20–11.22 and `new --team`.

**Not wrapped, deliberately:** `branch`, `rebase`, `cherry-pick`, `stash`,
`tag`. *Clone it, it is real git.* The sheet's last row prints the exact
`git` invocation with the C30 flags, so nobody has to remember them; there is
no separate flag for it.

## 12. Output rules

1. Plain words, one line per event, present tense: *Updated `skill/brief` to
   v4.* Never *Hydration completed successfully.*
2. A `Blocker` renders as three lines: the message; `→ ` the remedy; the link
   if any. Colour from `style.ts`; none when not a TTY.
3. Never a stack trace to a person. An unhandled error prints *Something went
   wrong in harness itself (not your organization's policy). Run with
   `HARNESS_DEBUG=1` for the trace.* and exits 1.
4. `--json` on `status` and `preflight` prints the object and nothing else.
5. Exit codes: `0` ok · `1` blocker · `2` usage · `130` interrupted · child's
   own code after `run`.
6. Notices that repeat (a retired alias) print once.

## 13. Failure modes

| Code | When | Message | Remedy |
| --- | --- | --- | --- |
| `cli.not_logged_in` | no credentials file | You are not logged in. | `harness login` |
| `preflight.api_unreachable` | fetch failed before a session — 03's code, raised by `fetchChain` so one situation has one code | Could not reach the Harness API at `<url>`. | Is it running? `harness preflight identity`. |
| `cli.provider_unknown` | `run <word>` not in the registry | "`<word>`" is not a provider this CLI knows. You have: pi, claude. | `harness run pi` |
| `cli.provider_ambiguous` | several adapters, no word | Say which provider: pi, claude. | — |
| `cli.as_not_admin` | `--as` and fetch did not advertise the ref | You are not an admin of a team `<member>` is in, so their version is not yours to open. | Ask an organization admin. |
| `cli.read_only_as` | `push`/`offer` under `--as` | You are reading `<member>`'s version; changes cannot be pushed from here. | Promote from the console instead. |
| `cli.offer_refused` | server refused the request | The team declined to receive this: `<reason>`. | — |
| `cli.reset_needs_yes` | non-TTY, no `--yes` | This discards your changes to `<key>`. | Re-run with `--yes`. |
| `cli.key_unknown` | `diff`/`log`/`reset` on an unknown key | Nothing called `<key>` has been delivered to you. | `harness status` lists what you have. |
| `cli.kind_unknown` | `adopt` with a kind not in `kinds.json` | "`<kind>`" is not a kind your organization uses. Kinds: … | — |
| `cli.harness_name_taken` | `new` duplicate | You already have a harness called "`<name>`". | Pick another name, or `harness switch <name>`. |
| `cli.team_ambiguous` | `new --team <segment>` matches several teams on the chain | `<segment>` names more than one team you are on: `<paths>`. | `harness new "…" --team <first path>` |
| `cli.reason_required` | `providers decline` without `--reason` | Declining a runtime needs a reason: everyone who tries to run it is shown it. | `harness providers decline <id> --reason "…"` |
| `cli.key_required` | `keys add` given an empty key | No key was given, so nothing was stored. | `harness keys add <provider>` |
| `cli.no_harness_target` | `push` with no selection and no `--harness` | Every push lands in a harness, and none is selected. | `harness switch <name>` picks one for every push; `--harness <name>` names one for this push. |
| `cli.no_harness` | `run` with no selection and no `--<name>` | Every session runs in a harness, and none is selected. | `harness switch <name>`, or `harness run <provider> --<name>`; `harness new "<name>"` makes one. |
| `cli.asset_required` | `remove`, or the exit review, naming a key on the organization's `required` list (W5-D10) | `<keys>` is required: every session loads it, so it cannot be removed from a harness. | An organization admin decides what is required, on the organization's Assets screen. |
| `cli.import_unknown_provider` | `import <word>` with no importer | No importer for `<word>`. Harness reads Claude Code and Pi setups itself; for anything else the assistant can do it. | `harness run pi`, then: *Extract my `<word>` setup into this harness.* |
| `cli.offline_no_refs` | `--offline` with no prior fetch | Nothing has been fetched on this machine yet, so there is nothing to run offline. | `harness pull` when you are online. |
| `cli.id_collision` | `adopt` of a directory whose sidecar id already exists on the chain | `<path>` carries the id of `<kind>/<name>`, which already exists. | `harness adopt --new-id <path>` |
| `cli.withdraw_refused` | not the author, or not open | That request is not yours to withdraw, or is already closed. | — |
| `cli.link_malformed` | `open` given anything but `harness://run?harness=&provider=`, or a relative `workspace` | "`<url>`" is not a link this CLI understands. | A harness link looks like `harness://run?harness=<harness id>&provider=<provider id>`. |
| `cli.provider_not_listed` | `open`'s provider is a real adapter the organization does not list | Your organization does not list "`<id>`" as a runtime, so this link cannot start a session. | Runtimes you have: … |
| `cli.workspace_gone` | `open` given a `workspace` that is not a folder on this machine | There is no folder at `<path>` on this machine any more. | Use the card's own button, which asks where to run. |
| `cli.no_picker` | `open` with no `workspace` on a Linux machine with neither `zenity` nor `kdialog` | This machine has no folder picker (`zenity` or `kdialog`), so the folder cannot be asked for. | In the folder you want, run: `harness run <provider> --harness <id>` |
| `cli.spawn_failed` | binary gone at spawn | Could not start `<path>`. | `harness preflight provider` |
| `supervise.retired` | alias retired mid-session | The `<alias>` credential was retired by your organization; requests using it will be refused from now. | — |
| `supervise.revoked` | session revoked | This session was ended by your organization: `<reason>`. | `harness run` starts a new one under the current policy. |
| `supervise.unreachable` | TTL exceeded | The Harness API was unreachable for 15 minutes, so this session has ended. | `harness run` when it is back. |
| `supervise.close_deferred` | close failed at exit | This session could not be closed; it will be closed the next time you run `harness`. | — |

Blockers from other modules (`compose.*`, `repo.*`, `preflight.*`,
`broker.*`, `proxy.*`, `sandbox.*`, `adapter.*`) are rendered by §12 rule 2
unchanged. In particular `switch` and `run --<harness>` raise 03's
`preflight.harness_*`, `push` raises 01's `repo.*`, and `--model` raises
03's `preflight.model_not_approved`; this document owns no second spelling
of those.

## 14. Tests

| Tier | Name | Asserts |
| --- | --- | --- |
| T1 | `no_parent_env_leaks` | canary list absent from `childEnvironment` output |
| T1 | `adapter_env_override_throws` | adapter env with a core key → `childEnvironment` throws (a bug, not a `Blocker`) |
| T2 | `push_commits_only_the_key` | two dirty keys, `push` one → one commit, one path |
| T2 | `push_never_targets_team_ref` | the only refspec `gNet` receives is `main:refs/heads/users/<id>`; no argument changes it |
| T2 | `adopt_keeps_existing_id` | a directory with a sidecar keeps its id |
| T2 | `adopt_new_id_reids` | `--new-id` replaces the sidecar id; without it a collision is `cli.id_collision` |
| T2 | `offline_uses_last_refs` | `--offline` composes from `assets.git/chain.json` + `refs/remotes/origin/*`; no file → `cli.offline_no_refs` |
| T1 | `model_flag_within_approved` | `--model` outside *approved for* → `preflight.model_not_approved` (03) |
| T1 | `deferred_slot_consults_local_only_when_allowed` | `via.sources: "vault"` → no local probe; `"vault-or-local"` → probe runs |
| T1 | `token_header_never_in_config` | `gNet` passes the header on argv; `assets.git/config` never contains `Authorization` |
| T2 | `new_mints_sidecar_id` | `new` writes a `HarnessDef` with a fresh uuid and commits it |
| T2 | `adopt_mints_sidecar` | `adopt` writes `asset.json` with a fresh uuid and the right kind |
| T2 | `reset_all_scopes_to_harness` | with a selection, `--all` lists exactly the harness's keys |
| T2 | `team_view_loads_shadows` | `run --team` sets `view: "team"`; the load set holds the team's copies for every override; work tree untouched |
| T3 | `spool_forward_keeps_offset_on_failure` | a failing `send` leaves the offset; the next tick resends the same batch |
| T3 | `retired_alias_stops_injection` | `GET` returns `retired: ["crm"]` → `proxy.retire("crm")` called once; notice printed once |
| T3 | `revoked_session_terminates_child` | `status: revoked` → SIGTERM, then SIGKILL after 10 s if alive |
| T3 | `unreachable_control_plane_ends_after_ttl` | heartbeat failing for > TTL → child terminated with `supervise.unreachable` |
| T3 | `exit_posts_tally` | close PATCH body carries `EndpointTally[]` from the spool |
| T3 | `child_exit_before_first_tick_still_closes` | immediate child exit → session closed once |
| T3 | `close_deferred_is_retried` | failing close → `close.json`; next command retries and deletes it |
| T4 | `as_member_requires_admin` | `role.level: member` → `cli.as_not_admin` before fetch; a forged claim → fetch advertises no such ref → same blocker |
| T4 | `offer_opens_request` | `offer` → one push, one `POST /v1/requests` with the paths and commit |
| T3 | `preflight_matches_json` | rendered sections derive from the same object `--json` prints |
| T3 | `no_key_in_child_env` | §7 |

## 15. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D101 | The command is `preflight`; `doctor` is an alias for one release. The console's sheet says *preflight*; 00 §3 said *doctor*. | swapping which is the alias |
| D102 | `switch` persists `version: "mine" \| "team"`; `run --team` is a per-run override and never writes the selection. | making `--team` persist |
| D103 | `--as <member>` is read-only for `push`/`offer`; promotion from a read branch is the console's verb. | adding `harness promote` |
| D104 | Control-plane silence TTL is 15 minutes from the last successful validity check. | one constant |
| D105 | One `forwardSpool(path, offset, send)` serves both spools. | — |
| D106 | `reset --all` = every key in the selected harness, else every delivered key. | — |
| D107 | `new` commits and pushes the `HarnessDef` immediately, so the console sees it at once. | making `new` local until the next `push` |
| D108 | `offer` = `push` + `POST /v1/requests`; `withdraw` = `POST /v1/requests/{id}/withdraw` (00 §4.10). The CLI opens and withdraws; it never decides. | — |
| D109 | Exit code after `run` is the child's; blockers 1; usage 2; 130 on interrupt. | — |
| D110 | The legacy `~/.harness/credentials.json` migration in `readCredentials` is deleted. | — |
| D115 | **Exit review** (§10.0): the one prompt `run` makes; three answers; non-TTY prints commands. Push only, never offer. | dropping the prompt and leaving it to `status` — loses the moment the product is sold on |
| D111 | Only one file is called `harness.json`: the selection. The rendered card is a field of `<agentDir>/policy.json` (07 §7); there is no second file. | — |
| D112 | `--model` is honoured only within *approved for*; the default is never absolute (00 D23). | — |
| D113 | `--offline` skips fetch only; it is not a no-control-plane mode. | — |
| D114 | `adopt` mints an id only when there is no sidecar; `--new-id` mints one regardless and is the remedy for an id collision and for the 02 D46 migration. | — |
| D116 | **Every command that creates or administers something takes an explicit scope and prints where the thing landed and who can see it.** The default is the person's own branch; `--team <path>` / `--org` are the admin forms and go through the server's write endpoints (00 §4.10), never through a local commit on a ref the CLI does not hold. | a silent default — the reason an owner on a team could not tell where `new` had put a harness |
| D118 | **A commit never lands loose: every push names a harness and goes to the person's version of it.** `push` takes the selected harness or `--harness`; the exit review's target is the session's harness (D119); the asset's commit is followed by the harness's (01 D3 extended to harness definitions). The team's version is reached only by `offer`. Found 28 Sep when six pushed skills sat on a branch in no harness and the console, which shows assets by harness, had nowhere to show them. | a *loose assets* page in the console — a second place to look for the same thing |
| D130 | **A removal is a change.** A key the boot tree delivered and the session deleted is listed by the exit review as *removed this session* and kept like any other change: the person's own copy leaves their branch, the id leaves their version of the harness. Before this, deletions were invisible — the review only walked what was on disk — and the next hydration silently restored them, so *delete everything* did nothing and reported *0 files changed*. `harness remove` is the standalone verb. | treating a missing directory as noise |
| D119 | **A session is always in a harness.** `run` needs the selection or `--<name>` and refuses `cli.no_harness` otherwise; there is no *everything loaded* session. A person is always on their own version of a harness, so the exit review's target is never a question — it is the harness they were in — and `envs/<harness id>` is never `everything`. Found 28 Sep when the review asked *Add to which harness?* of a person who had just spent an hour in `test-harness-1` via `--test-harness-1`. | keeping a harness-less run for the person with no harness yet — `harness new` is one command, and `setup` already says so |
| D140 | **A card opens a terminal through a registered link type, not a listener.** `harness setup` registers `harness://` for the person (§11.22); `harness open <url>` (§11.24) parses it, checks the login and the composition, asks natively where to run when the link does not say, and opens a terminal there running `harness run <provider> --harness <id>`. Nothing listens on the machine, nothing is machine-wide, and the browser can detect none of it — so the console says so in one line rather than guessing (WS5b, console 04 §4). The enterprise pattern: *Open in VS Code*, JetBrains, Slack, Figma all work this way. | dropping the buttons and printing the command for people to copy |
| D141 | **A session records the folder it ran in and the machine it ran on, and only its owner ever reads them.** `POST /v1/sessions` carries `workspace` and `hostname` (00 §4.10); the broker stores them on the row and **not** in the `session.open` audit payload (04 §5.3), because audit is admin-readable and a person's paths are not. The card's `lastWorkspace`/`lastHost` and the session page's `workspace`/`host` are `null` for anyone but the owner and under `?as`. Both fields are optional so a CLI one version behind still opens a session. The claim is about *these two fields*: `SessionView.preflight` already hands an admin the whole posted report, whose `plan.allowWrite` names the workspace directory — a pre-existing exposure this decision does not widen and does not close. | putting the path in the audit payload, which would make every admin a reader of every person's disk |
| D142 | **The session has a face, and it is one face.** `screens.ts` draws the boot screen (§11.1) and the exit review (§10.0) from one `Frame` and one header: the harness's drawing in half-block cells, its name in the pixel font and its description, what it delivered, the model, the reach and the workspace, and a rule naming the provider where ours ends — and for Pi the same frame is the runtime's header (`landing.ts`, imported by the extension). Both frames line up on the same text column, colour follows `style.ts`, and a pipe gets the same facts as plain lines. The numbers are `layout.ts`'s, the drawing is `pixels.ts`'s and the reach words sit beside the report's — the module composes, it does not recompute. | printing the facts as loose lines, which is what `run` did when the only thing between preflight and Claude Code's splash was a one-line summary |
| D145 | **A tick is one request.** The heartbeat `PATCH` answers with the session's validity (`status`, `retired`, `revoked_reason`), read from the row the same transaction locked, and the supervisor acts on that answer; `GET /v1/sessions/{id}` is the fallback for a heartbeat that failed. Fifteen seconds, one request, per live session: at a thousand sessions that is 67 requests a second, each a read of one row and a write of one column, which a single Postgres carries without notice; the second request was pure duplication. A retirement set between the row read and the update is seen one tick later, the same lag the second request had. Also: a deferred close the server answers `409` to (the session is already closed or revoked) is finished, not replayed on every CLI invocation for ever — the three `409 Conflict` lines at the top of a dev log were exactly that. | a longer interval (revocation would reach a session later for no gain in load); a server push (a connection per session is more state than a request per fifteen seconds) |
| D143 | **A required asset cannot leave a harness, and the review never offers it.** `cli.asset_required` from `leaveHarness` (§11.23), and the exit review filters a required key out of `removed` with one sentence rather than asking a question it would then refuse. The console's `DELETE /v1/assets/{id}` refuses the same id with `asset.required` (WS3a), so the two surfaces say the same thing. | offering it and refusing the answer |
| D117 | **Admin verbs in the CLI follow the setup path first**: `new --team/--org`, `providers`, `keys add`, `setup` (§11.12, §11.20–11.22). Groups, boundaries, routing cells and vault edits stay console-only until a person asks for them from the terminal; when they come they are the same write endpoints, one verb each. | adding them now — more surface, no user |

## 16. Out of scope

Exit reconciliation (prd-v2 §22 Later — `closeSession` posts a tally, records
no new needs). `harness provider add` and managed installs (00 D10).
`login --sso` (D29). `harness promote` (D103). Command interception (05/06
Later). Windows (06: fails closed with a named blocker). CLI verbs for
groups, boundaries, routing cells and vaults (D117).

## 17. Definition of done

- A fresh checkout builds `engine/cli` from the root (`00` D30) and `harness
  --help` lists exactly the commands in §11.
- `harness run pi` on macOS and Linux completes rows 0–13 against a local
  `definitions` + `api`; `preflight.json` exists before the provider process
  does; the child environment matches §7's table exactly.
- `harness commands` and the console's *Commands* modal render from one table.
- Every test in §14 exists by name and passes in CI on both OSes (T3/T4
  gated on the sandbox and services being present).
- No module exceeds its ceiling without a sentence in the PR.
- `pi/packages/harness-cli` is deleted in the same change that lands
  `engine/cli` (00 §6).
