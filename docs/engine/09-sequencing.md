# Engine Plan — 09 · Sequencing

What lands in what order, what each milestone deletes, which live gaps it
closes, and what "done" means. Milestones are cut lines: each leaves the
product in a state that can ship, and nothing in a later milestone is needed
to make an earlier one true.

The ordering principle: **build downward along the dependency chain, and
remove the worst live hole at the first milestone that can remove it
honestly.** The chain is `compose → definitions → preflight → broker → proxy
→ sandbox → commands`. The worst live hole is the provider key in the child
environment; it leaves at M3, the first milestone where the supervisor has
somewhere else to put it.

Every milestone's *done* is the union of the definitions of done in the docs
it lands, plus what is listed here. Nothing is done while its doc's named
tests do not exist.

| Milestone | Lands | Deletes (00 §6) | Gaps closed |
| --- | --- | --- | --- |
| **M0** Build | scaffold, CI | — | — |
| **M1** Compose | 01 | — | — |
| **M2** Definitions | 02, 01's CLI half, cutover | `/v1/resolve`, `asset_scopes`, `(kind,name)`, Postgres-as-truth | F4's two-sources-of-truth |
| **M3** The supervisor holds the key | 03, 04 (bundled), 05, 07 (render/rehydrate/locate) | `deliver`, `model.ts`, key-in-env, `HARNESS_REDACTIONS`, redaction | G4, G5, G6, G12 (inject half), G13 (model half) |
| **M4** The fence is real | 06, 07 (denyWrite/ambientStores/probe) | `enforcers/filesystem.ts`, `deniedToolDirs` | G7, G8, G9, G13 (deny-read half), G11 (pin) |
| **M5** Commands | 08 remainder, requests endpoint | `pi/packages/harness-cli` | — |
| **M6** Customer vaults and native mode | 04 (AWS, then Azure, Vault); Spikes 2, 3 | — | — |

---

## M0 · Build works from a fresh checkout

**Why first.** Survey finding: root `npm run build` never builds either
harness package, and Pi's adapter resolves siblings by relative path, so a
fresh checkout fails at spawn. Nothing in this plan can be verified until
that is false (00 D30).

**Lands.**
1. `engine/` at the repo root with three packages (`compose`, `cli`,
   `definitions`), each with `package.json`, `tsconfig.json`, `vitest`, zero
   runtime dependencies. `engine/cli` is `pi/packages/harness-cli` moved,
   unchanged, with its tests passing from the new location; the Pi adapter's
   `locatePiBinary()` resolves the vendored bundle by an absolute path
   computed from the repo root, not `../..`.
2. Root `package.json` scripts build `pi`, `engine/*`, `web`; `npm test`
   runs every workspace; a CI workflow runs on **macOS arm64 and Linux x64**
   and both are required (06 DoD).
3. The fixture directory `engine/compose/fixtures/` exists and is empty but
   wired into `compose`'s runner now; `cli` and `definitions` run it once they have a `Reader` (M1, M2).

**Deletes.** Nothing.

**Done.** A fresh `git clone && npm ci && npm run build && npm test` is green
on both runners; `harness run pi` from the new location behaves exactly as
before the move (the existing `run.test.ts` spawn contract passes).

**Cut line.** Ship-safe at any point; this changes no behaviour.

---

## M1 · Compose and identity (01)

**Lands.**
1. `@harness/compose`: `compose(chain, reader)`, `covers()`, the `Reader`
   interface, the `Composed` result, the conflict rules, the composed tree
   builder. T1 against fixtures; T2 against a bare repo built in a tmpdir.
2. The sidecar: `asset.json` written by `adopt`; validated by compose; D3's tests (`override_keeps_id`, `new_id_at_existing_path_is_refused`,
   `rename_follows_id`).
3. The **migration exporter** (02 §11) as a dry run: Postgres → branches in a
   local bare repo, nothing cut over. Its acceptance test runs here for the
   first time: for every user in the development database, the asset set
   `/v1/resolve` returns equals the asset set `compose()` returns over the
   exported branches, by id and file bytes (D6). This is the proof that
   composition is `resolve.py`'s semantics before anything moves.
4. Hydration takes `incoming` from a composed tree behind a flag in tests
   only; the five rows pass unmodified (01 DoD).

**Deletes.** Nothing. `/v1/resolve` still serves the CLI.

**Done.** 01 DoD; the exporter's byte-identical test is green against the
development database; `engine/compose` ≤ 600 lines.

**Cut line.** Ship-safe; nothing user-visible changed.

---

## M2 · The definition plane is git (02 + 01's CLI half)

**Lands, in this order inside the milestone.**
1. `definitions` serves an org: smart-HTTP, `Authorization: Bearer` resolved
   through `GET /v1/internal/principal`, per-ref advertisement via
   `GIT_CONFIG_PARAMETERS` (D1), receive-pack limited to the person's own ref,
   pre-receive validation = `compose()` over the pushed chain (02 §7),
   post-receive → `POST /v1/internal/index`. T4: `user_cannot_fetch_sibling_team_ref`,
   `user_cannot_push_team_ref`, `reindex_equals_fresh_index`.
2. `api` gains the internal endpoints (00 §4.10), the `idx_*` tables and
   the `idx_stale` rule, and `/internal/commit` on `definitions` for
   promote/accept/rollback — the existing `promote`/`rollback`/`approve`
   routes call it instead of copying rows.
3. The CLI: `git fetch` with `-c http.extraHeader` (D24a), `compose`,
   hydrate from the composed tree (01 row 0 sparse materialisation),
   `push` building the user-branch tree from the pushed key only (01 §7.3).
   `harness run` still calls the old `deliver` and still renders as today;
   only where the manifest comes from changes.
4. **Cutover**, one maintenance window per org: run the exporter for real;
   flip `definitions` to authoritative; delete `GET /v1/resolve`,
   `asset_scopes` (table, endpoints, predicate), `harness_assets`'
   `(kind,name)` in favour of ids, and the assets tables' role as source of
   truth (they remain as the index's storage or are replaced by `idx_*` —
   02 decides). The console's `api` endpoints read `idx_*`. The D6 test is
   the gate: it runs against production data before the flip and must be
   byte-identical.

**Deletes.** `/v1/resolve`; `asset_scopes`; `(kind,name)` keying; Postgres
as the definition source of truth; `identify()` by shape for `push`; the
dead `automation_runners` table and the three dead functions (00 §6).

**Done.** 02 DoD; 01 DoD's CLI items; the console shows the same harness
contents it showed before cutover for every fixture user; `promote` reaches
the team's members (the survey's finding that it did not is now a T4 test,
`promote_reaches_members`).

**Cut line.** Ship-safe after step 3 without step 4 (both stores alive,
`definitions` shadowing). Step 4 is the one irreversible step in the plan
and has the same rollback as v3's backfill: restore Postgres from the
pre-window snapshot and point the CLI back at `/v1/resolve`.

**Risk.** D1's operational shape. Mitigation is in 02 §12 (volume snapshot +
nightly `git bundle`, sharding by org, one push at a time per repo). If the
service cannot meet the restore-order test (`repos → reindex → records`
yields an identical index), M2 does not cut over.

---

## M3 · The supervisor holds the key (03, 04 bundled, 05, 07 partial)

The biggest milestone, and deliberately one: splitting it would leave a
release where a credential is in two places at once.

**Lands, in this order inside the milestone.**
1. **Adapters' render restructure** (07): `RenderContext`/`Adapter` per
   00 §4.8; `rendered.json`; `rehydrate()`; `locate()` with the pin;
   `capabilities` and `RenderReport`; `claude-settings.json` carrying
   `permissions.deny` and both hooks; Pi's `models.json` and Claude's
   `ANTHROPIC_BASE_URL` pointed at `<proxyUrl>/connectors/model`. The
   extension loses redaction and its allowlist becomes a notice (07 D94).
2. **Preflight** (03): choose → needs → *(mint)* → plan → render → fence →
   probe → report; the enforcer list; `preflight.json`; `harness preflight` =
   `preflight({spawn:false})`, with `doctor` as its alias for one release.
   `model.ts` and `layout.ts`'s gating helpers deleted.
3. **Broker** (04): `POST /v1/sessions` mint against the bundled resolver;
   groups and grants read from the index; approval and sources enforced at
   mint; `Slot.via`; the session record; revoke/retire; `GET /v1/sessions/{id}`;
   `POST /v1/sessions/{id}/endpoints`; audit events; partition rollover and
   grace expiry fixed. `POST /v1/api-keys/deliver` deleted.
4. **Proxy** (05): listener per OS (the Linux socket exists now; the jail
   that needs the forwarder arrives in M4 — until then the Linux listener is
   loopback TCP with the secret, and 05's unix-socket path is enabled in M4),
   tunnel and inject modes, SNI, the credential table, `endpoints.jsonl`.
5. **Supervisor** (08 §9–§10): the tick gains `GET /v1/sessions/{id}`,
   retire/close, endpoint spool forwarding, the tally at exit.

**Deletes.** `deliver`; `model.ts`; the key in the child environment and
`credentialEnvVar`; `HARNESS_REDACTIONS`; transcript redaction in the
extension; `Manifest` and `RenderContext` as they exist today.

**Done.** 03, 04, 05 DoD; 07 DoD minus the probe/deny items marked M4;
`harness preflight env` shows no credential variable (05 DoD); the T3 test
`no_key_in_child_env` passes; `enforcement-gaps.md` G4, G5, G6, G12
(inject half), G13 (model half) are marked closed by the docs that close
them.

**Cut line.** Not ship-safe before step 4 — the key would have nowhere to
go. Ship-safe after step 5.

**What is honest to claim after M3.** The provider key is no longer on the
person's machine in any place the agent can read; egress is *not yet*
restricted (there is no jail), so 05's allowlist is a fence with no walls
until M4. `harness preflight` says so, per C4: reach rows read *not
enforced yet*.

---

## M4 · The fence is real (06 + 07's probe and deny items)

**Lands.**
1. `confine()` on macOS (Seatbelt) and Linux (bwrap + forwarder + the unix
   socket listener from 05); geometry from `SpawnPlan.filesystem`; the six
   probes through the same `confine` call; the probe binaries built and
   checksummed in CI (06 D83).
2. `Adapter.probe` for both adapters (`denyWrite` and `ambientStores` exist
   from M3's restructure and become enforced here); C7's two independent
   chokepoints; C21's managed-tier blocker.
3. Windows: `sandbox.unsupported_platform`, plainly worded.

**Deletes.** `enforcers/filesystem.ts`; `deniedToolDirs`; every "not
enforced yet" label on reach rows in `harness preflight`.

**Done.** 06 DoD in full (both runners required); 07 DoD in full;
`enforcement-gaps.md` G7, G8, G9, G11 (pin), G13 (deny-read half) marked
closed. The claim in `enforcement-philosophy.md` §2 — *no route exists* — is
true for the first time and `homepage-promises.md` §4.3's blocked arrow is
earned.

**Cut line.** Ship-safe. This is the release that makes the product's
central security claim true; nothing after it is required for the claim.

**Risk.** Linux user namespaces disabled on a customer machine → the
session refuses with `sandbox.userns_unavailable` and the remedy names the
sysctl; there is no fallback (I5). macOS `sandbox-exec` deprecation is a
standing risk with no current alternative (06 §6.1); tracked, not mitigated.

---

## M5 · Commands and console parity (08 remainder)

**Lands.** `diff`, `log`, `offer`, `withdraw`, `new`, `reset --all`, **exit review** (08 §10.0), **`import claude`** and `import pi` (07 §4a — the acquisition test `imported_claude_harness_runs_on_pi`),
`commands`; the `requests` endpoints in `api` (00 §4.10) and the console's
Requests panel reading them; `switch` persisting `version`; `--team`,
`--as`, `--model`, `--offline`; the one table that renders both
`harness commands` and the console's Commands modal; output rules and exit
codes throughout; `pi/packages/harness-cli` deleted.

**Deletes.** `pi/packages/harness-cli`; the legacy `readCredentials`
migration; the second file named `harness.json` (the card is a field of
`policy.json` — 08 D111). Also lands here: the terminology rename through
`agents.md`, the CLI and the homepage (prd-v2 §22 Add 18).

**Done.** 08 DoD; the console's command sheet and `harness commands` are
byte-identical for the same fixture; every command has its failure-mode
strings in code verbatim.

**Cut line.** Ship-safe at any command boundary; each command is
independent.

---

## M6 · Customer vaults and native mode

**Lands.** First `api`'s **OpenID issuer** (11 §4 — the prerequisite for every customer vault except in-AWS role trust; ≈80 lines, its JWKS published at a stable URL). Then 04's AWS resolver (`AssumeRole` with session tags; `minted`
credentials; server-side fetch, D68), then Azure Key Vault, then HashiCorp
Vault, each behind the same `Resolver`; the console's vault rows show *connected*, *reachable now* (observed) and *secrets listable* — no grade (prd-v2 §6.2).
(macOS Keychain vs deny-read) closed with written results; native mode
unblocked per outcome, or left refused with the blocker naming why (D11,
06 D87).

**Deletes.** Nothing.

**Done.** 04 DoD's customer-vault items; T3 `aws_resolve_tags_and_scopes_session`;
`homepage-promises.md` §3.3's vault logos are earned one at a time, and the
page shows only the ones that are.

**Cut line.** Each resolver ships alone.

---

## Later (unchanged from prd-v2 §22)

Exit reconciliation (03 §10, 08 §16); the secrets inventory (04); command
interception (06 §13); OpenBao as the bundled vault; brokered OAuth;
`harness provider add` and managed installs (D10); `login --sso` (D29); a
publisher above the orgs; request-shape capabilities on connectors (05
D76); budgets and rate limits.

---

## Tracks

Three engineers can work in parallel from M1 with these seams:

| Track | Owns | Talks to |
| --- | --- | --- |
| **A · client** | 01 compose and CLI half, 03, 07, 08 | B for the endpoints in 00 §4.10; C for `SpawnPlan` |
| **B · services** | 02, 04 | A for `Reader` conformance fixtures; the console team for `idx_*` reads |
| **C · fence** | 05, 06 | A for `SpawnPlan` and `RenderContext.proxyUrl`; B for `MintedCredential` and retire/close |

Track C can begin 05 at M1 against a hand-written `SpawnPlan` fixture and
06 against a hand-written geometry; neither needs M2. Track B's M2 gates
Track A's M2 step 3. M3 is the one milestone where all three tracks land
together, in the order given.

---

## Risk register

| Risk | Where it bites | Mitigation | Owner |
| --- | --- | --- | --- |
| The git server's operational shape (D1) | M2 | 02 §12; the restore-order test; no cutover until it passes | B |
| The cutover migration | M2 step 4 | D6 byte-identical test against production data; snapshot rollback | B |
| Compose semantics ≠ `resolve.py` | M1 | the exporter's acceptance test runs at M1, a milestone before anything moves | A + B |
| Spike 2 / Spike 3 (native mode) | M3–M4 | neither gates native mode (00 D11): seed-and-harvest is v1 for Pi; the Keychain risk is enterprise-org-mode-only and closed by no-route at M4 (`ambient_token_has_no_route_in_org_mode`); until M4, enterprise org-mode sessions on macOS carry the sentence | A |
| `sandbox-exec` deprecation | M4 onward | none available; tracked in 06 §6.1 | C |
| Linux userns unavailable | M4 | refuse plainly with the sysctl in the remedy | C |
| **Windows has no jail** — and the buyers are departments, many on Windows | from M4; a product gap | three paths (06 §9a): **W1 WSL2 spike at M4, ships M5** as *Windows via WSL2*; **W2 native AppContainer spike at M6**; **W3 credentials-only by explicit org approval**, labelled on every session. The M4 spike's pass criterion is the six probes green inside a stock WSL2 Ubuntu on a Windows runner. | C |
| Claude Code managed tier | M4 | `adapter.managed_tier` blocker; never fought (C21) | A |
| Index staleness at mint | M3 | synchronous indexing; `broker.index_stale` refuses (02 D44) | B |
| Scope creep in M3 | M3 | the order inside the milestone is fixed; nothing from M4/M5 is pulled forward | all |

---

## Definition of done for the plan itself

The plan is done when a fresh engineer can pick any milestone and find, in
the docs it names: the types (00 §4), the algorithm as numbered steps, the
file paths, every user-facing string, the named tests, and the definition
of done — without asking the architect a question that the docs should
have answered. Questions that do come up are answered by amending the doc,
never in chat.
