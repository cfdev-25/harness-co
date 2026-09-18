# Build Plan

The executable plan. Supersedes `plan-improvement.md` and
`supabase-migration-plan.md` as the source of tasks; those remain as history.

**Scope.** This plan builds two things: the **security wrapper** and the
**asset management system**. It modifies **no agent**. Not Pi, not Claude Code.
The only paths under `pi/` it touches are `pi/packages/harness-cli` and
`pi/packages/harness`, which are our own packages that happen to live in that
workspace. Support for agents other than Pi is v2.

Design sources — read the cited section before starting a task:

- [`enforcement-architecture.md`](enforcement-architecture.md) — "arch"
- [`asset-sync.md`](asset-sync.md) — "sync"
- [`enforcement-philosophy.md`](enforcement-philosophy.md) — "phil"
- [`enforcement-gaps.md`](enforcement-gaps.md) — "gaps"

## Rules for every task

1. **Do not commit.** Leave changes in the working tree and report. The owner
   commits.
2. **Do not modify any agent.** No file under `pi/` outside our two packages.
   No changes to Claude Code. If a task seems to need it, stop and report.
3. **Write the least code that satisfies the acceptance.** If a task can be
   done with less than specified, do that and say so. No configuration, flags,
   or abstractions the task does not name. If git or the OS already does it,
   call git or the OS.
4. **Acceptance is literal.** Run the listed commands and tests. Failing means
   not done.
5. **Fail closed.** A new error path leaves the agent with *less* access,
   never more. No fallback to previous behaviour.
6. **Stay in the task.** Out-of-scope items are listed so you do not do them.
7. Tests: backend `cd backend && .venv/bin/uv run pytest -q`; CLI
   `cd pi && npm test --workspace=@harness/cli`; extension
   `--workspace=@harness/pi-harness`.

**∥** marks tasks that can run in parallel within their phase.

---

## Phase 0 — Close the live holes — **DONE**

No sandbox, no backend change, no user-visible difference. Ships first.
**Land in the order 0.2 → 0.3 → 0.1** so audit forwarding never lapses.

### 0.1 Child environment allowlist — **DONE** — `gaps` G2, `arch` §2

**Files.** `pi/packages/harness-cli/src/index.ts` (`run`), new
`pi/packages/harness-cli/src/env.ts`.

**Signature.**
```ts
export function childEnvironment(input: {
  sessionId: string; sessionDir: string; proxyUrl?: string;
  adapterEnv: Record<string, string>;
}): Record<string, string>;
```

**Behaviour.**
1. Start empty. From `process.env` copy only `HOME` (verbatim), `TERM`, `LANG`,
   `TZ` if present, and `PATH` filtered to entries under `/usr`, `/bin`,
   `/sbin`, `/opt/homebrew`, `/usr/local`.
2. Set `HARNESS_SESSION_ID`, `HARNESS_SESSION_DIR`. If `proxyUrl`: set
   `HTTP_PROXY`, `HTTPS_PROXY` to it and `NO_PROXY=""`.
3. Merge `adapterEnv`; a key already present → throw
   `Error("adapter may not override core env: <key>")`.
4. `HARNESS_API_TOKEN`, `HARNESS_API_URL`, `HARNESS_REDACTIONS` are gone.
5. **Until 2.1 lands there is no adapter**, so `run` passes inline as
   `adapterEnv`: `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`,
   `PI_TELEMETRY: "0"` — the values it sets today. Dropping them sends Pi to
   `~/.pi`.
6. **Until 3.2 lands** also pass the delivered key env vars in `adapterEnv`.

**Acceptance.**
- Unit: fixture input → exactly the expected keys; a conflicting adapter key
  throws. — **DONE**, `packages/harness-cli/test/env.test.ts`, 4 tests.
- Manual: `HARNESS_HOME=$(mktemp -d) AWS_SECRET_ACCESS_KEY=leak harness run -p 'echo $AWS_SECRET_ACCESS_KEY; echo $HARNESS_API_TOKEN'` → two empty lines.
  — **BLOCKED on an interactive `harness login`.** Covered in unit form: the
  test asserts `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, and `HARNESS_API_TOKEN`
  are absent and that no key outside the allowlist appears.

### 0.2 Audit spool — **DONE** — `arch` §2

**Files.** `pi/packages/harness/src/index.ts` (`flush`, `request`) — our
extension, the only extension change in this plan.

**Behaviour.**
1. Delete `request()` and every `fetch`.
2. `flush()` appends each queued event as one JSON line to
   `${HARNESS_SESSION_DIR}/audit.jsonl` with `appendFile`, then clears the
   queue. Keep the 15 s timer. Never create the file (0.3 pre-creates it).
3. On the existing close path append `{"type":"session.close","occurred_at":…}`.
4. Remove the `PATCH /v1/sessions` heartbeat.

**Acceptance.** Extension test: two tool calls + flush → two parseable lines
with `action: "tool.call"`. `grep -c fetch pi/packages/harness/src/index.ts` → `0`.
— **DONE**, `packages/harness/test/audit-spool.test.ts`; `fetch` count is 0.

**Deviation.** The `session.close` line was dropped. `/v1/audit/batch` requires
`action` (`routes_audit.py:23`), so a `{type: …}` line would 422 and wedge the
offset forever — and the supervisor already observes the child exit directly.
`flush()` lost its `close` parameter; every spooled line is now a valid
`AttestedEvent`. Less code, no translation layer.

### 0.3 Supervisor heartbeat and forwarding — **DONE** — `arch` §2

**Files.** `index.ts` (`run`), new `pi/packages/harness-cli/src/supervise.ts`.

**Signature.**
```ts
export function supervise(input: {
  child: ChildProcess; sessionId: string; sessionDir: string;
  credentials: Credentials; intervalMs?: number;   // default 15_000
}): { stop(): Promise<void> };
```

**Behaviour.** Before spawn, create `${sessionDir}/audit.jsonl` empty, mode
`0600`. Then every `intervalMs`: (1) read new lines since the last offset,
`POST /v1/audit/batch` in batches ≤100, on failure keep the offset; (2)
`PATCH /v1/sessions/{id}` `{ last_active_at: now }`. On child exit: flush,
`PATCH … { status: "closed" }`, resolve `stop()`.

**Acceptance.** Backend running: `harness run -p 'ls'` → session row `closed`,
`audit_log` has the tool call, `audit.jsonl` existed with `0600` before spawn.
— **BLOCKED on an interactive `harness login`.** Covered in integration form:
`packages/harness-cli/test/supervise.test.ts` runs the supervisor against a
local HTTP control plane and asserts events forward exactly once across
several ticks, the heartbeat carries `last_active_at`, the final call is
`{status: "closed"}`, and a partial trailing line is not forwarded.

**Note.** `api()` moved from `index.ts` to a new `src/api.ts` so the supervisor
can use it without a circular import. No behaviour change.

**Out of scope.** TTL, termination on revocation (4.2).

---

## Phase 1 — Asset sync — **DONE**

`sync` is normative. Git does the work; we write the glue.

### 1.1 Geometry, credential move, repo init — **DONE** — `sync` §3 ∥

**Files.** `pi/packages/harness-cli/src/core.ts`, new `src/git.ts`.

**Signatures.**
```ts
// core.ts
export function harnessHome(): string;           // $HARNESS_HOME ?? ~/.harness  (unchanged)
export function credentialsPath(): string;       // $HARNESS_CREDENTIALS ?? ~/.config/harness/credentials.json
export function assetsRoot(): string;            // harnessHome()/assets
export function assetsGitDir(): string;          // harnessHome()/assets.git
export function sessionDir(id: string): string;  // harnessHome()/sessions/<id>

// git.ts
export async function g(...args: string[]): Promise<string>;   // runs git with the §3.1 flags; throws on non-zero
export async function ensureRepo(): Promise<void>;             // init if assetsGitDir() missing
export async function worktreeTree(): Promise<string>;         // temp index: add -A, write-tree → tree id
```

**Behaviour.**
1. `readCredentials()`: if `credentialsPath()` missing and
   `harnessHome()/credentials.json` exists → `rename` (mkdir parent `0700`),
   `chmod 0600`, then read. Once.
2. `g()` always passes `--git-dir=<assetsGitDir()>`, `--work-tree=<assetsRoot()>`,
   `-c core.hooksPath=/dev/null`, `-c core.fsmonitor=false`,
   `-c user.name=harness`, `-c user.email=harness@local`. There is no code
   path that runs git without all six. The hooks and fsmonitor flags are
   security controls (`sync` §3.1): the supervisor runs git outside the jail,
   and the agent can write the work tree.
3. `ensureRepo()`: `mkdir -p` both dirs (`0700`); if `assetsGitDir()` has no
   `HEAD`, `g("init")`. Verify that `init` with `--git-dir` does not leave a
   `.git` file in the work tree; if it does, delete it.

**Acceptance.** Unit: temp `HARNESS_HOME`; old-style credentials migrate to
the new path with `0600`; `ensureRepo()` twice is a no-op; `g("rev-parse",
"--git-dir")` returns `assetsGitDir()`; `worktreeTree()` of an empty tree equals
git's well-known empty tree id `4b825dc…`. — **DONE**, `test/git.test.ts`,
5 tests, all of the above plus "no `.git` inside the work tree".

**Deviation.** The optional `home` parameter was dropped from `harnessHome`,
`credentialsPath`, `writeCredentials`, `readCredentials`, and
`materializeManifest`. Env vars alone drive the paths, so four signatures got
shorter and the tests set `HARNESS_HOME`/`HARNESS_CREDENTIALS` instead of
threading an argument. Added `gAt(workTree, …)` so a tree can be built from a
scratch directory, and `differs(a, b, path)` as the single equality test.

### 1.2 Server: version metadata and shadows — **DONE** — `sync` §3.2, §5 ∥

**Files.** `backend/app/domain/resolve.py`, `backend/tests/test_resolve.py`.

**Behaviour.** Each resolved asset gains `version_id`, `seq`, and
`shadows: null | { asset_id, org_unit_path, version_id, seq }` — the
next-farther asset with the same `(kind, name)` in the chain. Keep `choice = 2`
rows from the existing window function and join them; do not add a per-asset
query. **No file hashes** — git compares trees. `manifest_version` → `2`.

**Acceptance.** `test_resolve.py`: team + user override of one name → the
user's is returned with `shadows.org_unit_path` = team path and `shadows.seq`;
no override → `shadows: null`; every asset has `version_id` and `seq`.
— **DONE**. The repo has no database fixture, so the row→result mapping is
tested with a fake connection (and a deliberately failing assertion confirmed
the async test really executes). The SQL itself — the `choice<=2` window and
the `org_units` join — was verified separately by running it read-only against
the live database inside a rolled-back transaction.

### 1.3 Hydration — **DONE** — `sync` §4, §5 (needs 1.1, 1.2)

**Files.** new `pi/packages/harness-cli/src/hydrate.ts`; `index.ts` (`run`).

**Signature.**
```ts
export async function hydrate(manifest: Manifest, notify: (msg: string) => void): Promise<void>;
```

**Behaviour.** Exactly `sync` §4 steps 1–4 and the §5 override notice:
1. Temp index → write delivered files + `versions.json` → `write-tree` →
   `commit-tree` → `incoming`.
2. `W = worktreeTree()`; `R = refs/harness/remote` or absent.
3. Per key, rows 1, 2, 2b, 3, 4, 5 **in order, first match wins**, using
   `git diff --quiet <a> <b> -- <key>` for every equality test.
4. `update-ref refs/harness/remote incoming`.
5. Compare `versions.json` between `incoming` and `R` for `shadows` changes;
   notify per `sync` §5.

Called from `run` after resolve, before render.

**Acceptance — CLI tests, mock manifest, temp `HARNESS_HOME`:**
1. Fresh home → files present; `refs/harness/remote` exists. (row 2)
2. **Idempotency:** same manifest again → zero writes to the work tree (spy on
   `fs` or compare mtimes), remote ref unchanged.
3. Edit a file; same manifest → untouched. (row 4)
4. Edit a file; new version → untouched; notify with row-5 text. (row 5)
5. Edit a file to equal the new version's content → no write, no notice, and
   `status` reports `clean`. (row 1)
6. Clean tree; new version drops a file → file removed. (row 3)
7. Hand-made dir, no remote ref → untouched; row-2b notice.
8. Hand-made dir equal to delivered → no notice. (row 1 before 2b — the
   ordering test)
9. Asset removed from manifest, tree clean → directory removed with notice;
   tree dirty → kept with notice.
10. `shadows.version_id` changes between runs → §5 notice; unchanged → none.

— **DONE**, `test/hydrate.test.ts`, all 10 cases.

### 1.4 Push — **DONE** — `sync` §6 (needs 1.1)

**Files.** `index.ts` (`pushAsset`).

**Behaviour.**
1. Accept `tool`: a directory with an executable `run`; name from `TOOL.md`
   frontmatter or the directory name.
2. After the server accepts: `g("add", "--", key)`; `g("commit", "-m",
   message, "--", key)`.
3. `409` non-interactive (no TTY or `--non-interactive`) → both messages to
   stderr, exit 1, no second request.

**Acceptance.** Mocked API: a push produces one commit on `main` touching only
`<key>`; `409` non-interactive exits 1. — **DONE**, `test/push.test.ts`,
3 tests (skill, tool-by-`run`, non-interactive conflict).

**Deviation.** Step 2's `provenance` inspection was dropped as dead work. Push
commits to `main`; only hydration moves `refs/harness/remote`. A
`pending_review` version therefore needs no special case — resolution keeps
delivering the old one, hydration lands in row 4, and row 1 converges it on
approval. This is `sync` §6's "No special case" made real. Also: `record()`
skips assets pushed from outside the work tree rather than failing the push.

### 1.5 `status`, `reset`, `adopt` — **DONE** — `sync` §7 (needs 1.3)

**Files.** `index.ts`, `cli.ts`.

**Behaviour.** As the §7 table. `status`: for each key in `versions.json` ∪
work tree, one line `<key>  clean|modified|conflict|override (team at v<seq>)`;
`conflict` when dirty and `versions.json` seq differs between `R` and the
last-seen run — simplest correct implementation: dirty AND the key's
`version_id` in `R`'s `versions.json` ≠ the key's `version_id` when the user
last ran `status`/`run`, which you may persist in `assetsGitDir()/harness-seen.json`.
If that persistence turns out unnecessary, drop it. `reset` requires `--yes`
when not a TTY. `adopt` is a `rename` into the work tree, nothing else.

**Acceptance.** `status` shows `modified`; `reset --yes` restores the delivered
files; `status` shows `clean`. — **DONE**, `test/assets.test.ts`, 6 tests.

**Deviation — two things deleted.** (1) The `conflict` state and
`harness-seen.json` are gone. After hydration `R` has already advanced, so
"the team also moved" is not recoverable at status time — and it does not
need to be: `modified` means "yours differs from the team's current version",
which is the same situation with the same two resolutions. The conflict is
still surfaced at hydration, which is when it is actionable. One less state,
one less file, no persistence. (2) `adopt` takes no `kind` argument — it
infers the kind from the directory's shape using the same `identify()` that
`push` uses, now shared from `assets.ts`.

---

## Phase 1.6 — `harness doctor` — **DONE** (added during Phase 1)

Not in the original plan. A development inspection command: print what the
server actually decided for you, so a change made in the web console can be
confirmed to have reached the machine.

**Files.** `pi/packages/harness-cli/src/doctor.ts`; dispatcher in `index.ts`.

**Behaviour.** `harness doctor [section...] [--json]`. Sections: `identity`,
`boundary`, `model`, `assets`, `local`, `env`. No arguments prints all of
them. Everything shown is non-secret by construction — secret *values* are
never sent to the client, so the command shows a key's reference and the
variable it will arrive as, never the key. The `env` section prints exactly
what `childEnvironment` would hand the agent and asserts that no shell
credential is among it.

**Verified end to end** against the live stack: a boundary set at the root org
(`PUT /v1/org-units/{root}/boundary` with an egress allowlist and a budget cap)
appeared in `harness doctor boundary` at the user's leaf unit through
`merge_boundaries`, and was then reverted. Tightening was confirmed at the same
time: a child unit trying to add `evil.com` was refused with
`422 boundary_loosens`.

**Gap this exposed.** The console's Boundary tab is read-only — the typed
`PUT /v1/org-units/{id}/boundary` endpoint exists but nothing in the UI calls
it. Setting a boundary today requires curl. Worth a form.

## Phase 1.7 — Generality and honesty pass — **DONE**

Not in the original plan. Three changes made before Phase 2, while they were
still cheap.

**1. One `assets` array; `kind` is data.** The manifest carried fixed
`skills` / `memories` / `tools` / `connections` arrays, so a new kind meant a
migration, a `Literal`, a wire-format change, and an edit to every client.
Now: `manifest.assets: [{kind, name, files, …}]` (`manifest_version` 3), and
`asset_kinds` is a table with an FK from `assets.kind`
(`0013_asset_kinds.sql`). Adding `cron` is one `insert`. Unknown kinds return
`422 unknown_asset_kind` listing the known ones. Clients group by kind;
`hydrate`'s grouping function collapsed to four lines.

Removed while there: `run()` collected `key_ref` from `manifest.connections`,
which never carried one — the expression always produced `undefined`. It is
now just the model's.

**2. Absent is not empty** — philosophy §10. `merge_boundaries` returns `null`
where nobody defined a field, `[]` only where someone set an empty policy.
`validate_tightening` lets a child define a field an unconstrained parent left
open; `lint_files` treats absent as "nothing to violate". **This is the
answer to the cutover problem**: without it, the day egress enforcement ships,
every org that never wrote a policy loses all network simultaneously.
Verified live both ways — an explicit `[]` renders `none permitted`, no policy
renders `(not set — unrestricted)`.

**3. Doctor is honest and legible.** Every boundary line is marked
`enforced` / `advisory` / `not enforced yet`, with a closing note that nothing
is enforced yet. Freshness (`resolved Ns ago, ttl 900s`, flagged `STALE` past
the TTL) is shown. New `style.ts` adds colour that disappears on a pipe, a
dumb terminal, `NO_COLOR`, or CI — verified in all four cases.

**Also removed** (schema without behaviour, per the enterprise-gap review):
`budget_state`/`spent_usd` from the manifest, `legal_hold` and
`retention_until` from `harness_sessions` (`0012_drop_unimplemented_columns.sql`).
`boundary.budget` stays — it is declared policy, not a fake measurement.

## Phase 1.8 — Roles, grouping, `pull` — **DONE**

**Roles.** `org_unit_admins.level` existed as `admin | platform` and was read
by nothing — `is_admin` only asked whether a grant existed, so the two grades
were identical. Now `owner | admin` (`0014_roles.sql`), and the grade is read:

- `role_at(conn, user, unit)` returns the strongest grant on the ancestor
  chain and the node it was granted at. A grant covers that node's whole
  subtree, which is what makes "admin of Marketing" and "owner of the org" one
  mechanism at different heights.
- **There is no `user` row.** Membership without a grant is the `user` role;
  the absence *is* the role.
- `require_can_grant` — you may grant at a node you administer, never above
  your own grade. A team admin can appoint another team admin; only an owner
  can make an owner.
- `/v1/me` returns `role` and `role_unit`; `harness doctor` shows
  `role  owner at test-org-1`.

**Doctor groups assets by kind** rather than listing `kind/name` flat.

**`harness pull`** — hydration without a session. Assets existed server-side
but `doctor local` said "nothing delivered", because only `harness run`
hydrated and it cannot start without a model. Three lines; removes the dead
end and makes the whole Phase 1 loop usable today.

**Bug found by running it for real.** A pushed tool came back *conflicted on
first pull* and non-executable. The server stores file contents, not modes, so
hydration wrote `run` as 0644; git saw `100755 → 100644` and reported a
conflict that could never be resolved. Fixed two ways: `-c core.fileMode=false`
on every git invocation (a mode is never a difference we can act on), and
`chmod +x` on a tool's `run` after checkout, restoring the convention.
Regression test in `hydrate.test.ts`. **Residual gap:** a tool needing
executables other than `run` will not get their bit back — the real fix is
storing modes in `file_hashes`, which is a v2 schema change.

**Verified live, end to end:** pushed a skill and a tool, pulled them,
confirmed grouping, ran the tool, confirmed `pull` is idempotent across three
runs, edited an asset, saw `modified`, reset it, saw `clean`.

## Phase 1.9 — Prompts, provenance, path-collision fix — **DONE**

**`prompt` is now a kind** (`0015_prompt_kind.sql`) — and note what adding it
cost: **one `insert`**. No constraint change, no wire-format change, no client
change. That was the point of 0013.

Prompts render *before* memories in the instructions file, and within each
group **broadest scope first**, so a user's own prompt extends the team's
rather than preceding it. Ordering is by the length of the owning unit's path,
which required exposing `org_unit_path` on every resolved asset. Regression
test asserts `ORG < TEAM < USER < memories`.

Team-plus-extension therefore needs no new resolution semantics: the team
pushes `prompt/house-style`, the user pushes `prompt/my-additions`, both
resolve, both render, in the right order. Same-name still *overrides*, which
is the correct behaviour for replacing a policy.

**Asset provenance in doctor.** Each asset is marked `yours` or
`from <unit path>`, which answers "has this person extended anything" without
asking their machine — the server already knows, because an override is an
asset owned by their own unit.

**`identify()` no longer sniffs shapes inside the work tree.** It had a closed
vocabulary (`SKILL.md` → skill, `run` → tool, `.md` → memory), so a `prompt`
could not be pushed at all — the same hardcoding 0013 removed from the server.
The work-tree layout already states the kind (`<kind>/<name>/`), so that is
what is read. Shape inspection survives only for paths outside the tree, which
is `adopt`'s case. Any future kind now works with no client change.

**Path collision fixed — this was an onboarding blocker.** `slugify` deletes
every symbol, so `corbfurrer@gmail.com` and `corb.furrer@gmail.com` both
became `corbfurrergmailcom`, and `org_units.path` is unique-indexed. The
second person to accept an invite in a team would hit a unique violation and
could never onboard. New `email_label()` replaces `@` with `-at-` and `.` with
`-` instead of dropping them: `corbfurrer-at-gmail-com`. Team and org names
keep the simpler `slugify`. Regression test included.

**Verified live:** created a team prompt at the Marketing unit and a personal
one at the user unit, pulled both, confirmed doctor shows
`from test-org-1.marketing` versus `yours`, and confirmed the rendered
ordering.

## Phase 2 — The Pi adapter

One adapter. No linking, no copying: Pi is **pointed at** the canonical
directories.

### 2.1 Adapter interface and Pi adapter — `arch` §6

**Files.** new `pi/packages/harness-cli/src/adapters/{types,pi}.ts`; `core.ts`
(`materializeManifest` moves into `pi.ts`).

**Amended 2026-09-18 by `harnesses.md` §10.** `settings.json.skills` must
list `assetsRoot/skill/<name>` for the skills the selected harness contains,
not `assetsRoot/skill` wholesale — the directory form would load
every skill in the work tree whatever harness the user is in. Pi accepts
individual skill directories (a directory holding `SKILL.md` is a skill root:
`settings-manager.ts:133`, `skills.ts:164`), so this stays a list of pointers
rather than a copy. The same applies to the prompts directory and to the tool
index rendered into `AGENTS.md`. The principle of 2.1 — point, do not copy —
is unchanged; only the pointer set is per-harness.

**Behaviour.** Implement `Adapter` and `RenderContext` exactly as `arch` §6.
The Pi adapter's `render`:
- `settings.json`: current fields **plus** `skills: [ctx.assetsRoot + "/skill"]`
  (Pi reads skill directories from this list — `settings-manager.ts:133`).
- `models.json`: as today; baseUrl becomes `ctx.proxyUrl + "/connectors/model-default/"`
  and apiKey `"unused"` **in 3.2** — until then keep the current form with
  `// TODO(3.2)`.
- `AGENTS.md`: memories concatenated as today, followed by the tool index in
  the `arch` §7 format with absolute `run` paths.
`launch` returns the current argv and `{ PI_CODING_AGENT_DIR,
PI_CODING_AGENT_SESSION_DIR, PI_TELEMETRY: "0" }`, removing them from 0.1's
inline list. `run` selects `pi` unconditionally in v1; if
`boundary.allowed_agents` is present and excludes `"pi"`, refuse to start.

**Acceptance.** Existing CLI tests pass with `materializeManifest` deleted.
`harness run -p 'list your skills'` names a hydrated skill without any file
under `sessions/<id>/agent/skills/`. `AGENTS.md` has a `## Team tools` section
with absolute paths.

**Out of scope.** Any other agent. Linking. Copying.

---

## Phase 3 — The proxy

### 3.1 Tunnel mode — `arch` §3

**Files.** new `pi/packages/harness-cli/src/proxy.ts`; `run`.

**Signature.**
```ts
export async function startProxy(input: { hosts: string[]; secret: string;
  connectors?: Record<string, { upstream: string; header: string; value: () => string }>;
  log: (entry: ProxyLog) => void }): Promise<{ port: number; socksRefusePort: number; close(): Promise<void> }>;
```

**Behaviour.** `CONNECT host:443` with valid `Proxy-Authorization` and `host ∈
hosts` → tunnel. Otherwise `403`/`407` + log. Refuse non-443. Resolve DNS
proxy-side; refuse IP literals. Also listen on `socksRefusePort` and close
every connection immediately. `run` passes the URL as 0.1's `proxyUrl`. Fed by
`boundary.egress_allowlist`.

**Acceptance.** Unit: allowed host tunnels to a local TLS echo; disallowed →
403; wrong secret → 407; `:8080` → 403; one log entry per request;
`socksRefusePort` closes on connect.

### 3.2 Inject mode — `arch` §3 (needs 3.1)

**Behaviour.** Plaintext `/connectors/<name>/<path>` with a matching connector
→ strip `Authorization`, `Cookie`, `X-HTTP-Method-Override`; refuse
absolute-form; set the connector's header from `value()`; forward to
`upstream + path` over TLS. `credentials` enforcer builds `connectors` from
`manifest.model` and each connection's `key_ref`, calling `/v1/api-keys/deliver`
**in the supervisor**. Pi adapter's `models.json` switches to the proxy URL and
`apiKey: "unused"`. Delivered keys leave `adapterEnv` (closing 0.1 step 6).

**Acceptance.** Unit: `/connectors/x/foo` reaches a local upstream with the
injected header and without the client's `Authorization`. Manual: `harness run
-p 'say hi'` works with no `*_API_KEY` in the child env.

---

## Phase 4 — The sandbox

### 4.1 Enforcers and the wrapper — `arch` §4–§5; `gaps` G7–G9

**Files.** new `pi/packages/harness-cli/src/enforcers/{types,network,credentials,filesystem,environment}.ts`, `sandbox.ts`.

**Behaviour.**
1. **First, verify what the runtime injects.** Read
   `wrapCommandWithSandboxMacOS`/`…Linux` in
   `node_modules/@anthropic-ai/sandbox-runtime/dist/sandbox/` and record in
   `docs/build-decisions.md` whether they set `HTTP_PROXY`/`HTTPS_PROXY` on
   the child. If so, it is **without our `:secret@`** and every request 407s.
   Resolve by setting our URL after the wrapper, or via a runtime env hook if
   one exists. **Never by dropping the secret** — that is fail-open.
2. Build `SpawnPlan` via the four enforcers (`arch` §5 table). Wrap
   `adapter.launch()` with `@anthropic-ai/sandbox-runtime`:
   `network.httpProxyPort` = our port, `network.socksProxyPort` =
   `socksRefusePort`, `allowedDomains: []`, `allowLocalBinding: false`,
   `allowUnixSockets: []`, `allowAllUnixSockets: false`, `filesystem` from the
   plan — `arch` §4 write geometry (**`assets.git` is not in it**) and deny set.
3. Any runtime warning about missing helpers or any thrown error → abort boot
   with the message. **Never pass `sandboxAskCallback`.**
4. Add `@anthropic-ai/sandbox-runtime` to `harness-cli` at the exact version in
   `pi/package.json`.

**Acceptance.** `harness run -p 'curl -s https://example.com; cat
~/.ssh/id_rsa; touch /tmp/outside; touch ~/.harness/assets.git/x'` → all four
fail. Same session, curl to an allowlisted host succeeds and `touch
~/.harness/assets/skill/probe` succeeds.

### 4.2 Probes and termination — `arch` §2; `gaps` G8, G12

**Behaviour.** Before `exec`, run `/bin/sh -c` under the identical profile for
each `arch` §2 Probe assertion; unexpected success aborts. In `supervise`: if
`GET /v1/sessions/{id}` is `closed`, or `issued_at + ttl_seconds` passed and
re-resolve fails → `SIGTERM`, 5 s, `SIGKILL`.

**Acceptance.** A deliberately loose profile fails boot at Probe. Closing the
session in the console ends `harness run` within one interval.

---

## Phase 5 — Layman docs in the web console  ∥ (from Phase 1 onward)

**Files.** `web/app/docs/layout.tsx`, `web/app/docs/page.tsx`, one
`web/app/docs/<slug>/page.tsx` per row. Plain TSX + Tailwind. **No MDX, no
CMS, no search.** Left nav of six links.

Each page ≤ 500 words, no code, for someone who has never opened a terminal.
Each derives from one design section; when it changes, the page changes.

| Slug | Title | Derived from |
| --- | --- | --- |
| `what-is-harness` | The room and the clerk | `phil` §3 |
| `your-teams-library` | Skills, memories, tools, connections | `sync` §2, `arch` §7 |
| `your-personal-branch` | Why your edits are never overwritten | `sync` §0, §1, §4 |
| `improving-a-tool` | Edit, push, promote | `sync` §1, §6 |
| `what-is-protected` | What the boundary does and doesn't stop | `phil` §1, §9 |
| `set-up-your-agent` | Pi today; more agents coming | `arch` §6 contract |

**Acceptance.** `npm run build` in `web/` succeeds; `/docs` renders the nav
and every page; `npx eslint app` clean.

---

## v2 backlog — not in this plan

Claude Code adapter (config-only tier); managed installs (`harness install
<agent>`); request-shape capabilities; budget enforcer; provider downscoping;
trusted tools (`provenance.trusted_by`, `/trust`, outside-jail execution); MCP
interchange; SNI parsing in tunnel mode (`gaps` G5); remote gateway; `git
merge` in `reset`; exposing the control plane as a git remote.
