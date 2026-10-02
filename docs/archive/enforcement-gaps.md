# Enforcement Gaps

Exploitable gaps in the current code, corrections to earlier drafts, and the
line references that back them. Verified against the tree and against
`@anthropic-ai/sandbox-runtime` 0.0.26 on 2026-09-17. This document is
expected to go stale; that is its job.

Severity is relative to the threat model in
[`enforcement-philosophy.md`](enforcement-philosophy.md) §1: **the agent is the
adversary, the user is not.**

---

## G1 — The agent holds the user's control-plane token (critical, live)

`harness-cli/src/index.ts:129` places the user's credential — a PAT or Supabase
JWT — into the child environment as `HARNESS_API_TOKEN`. The extension needs
the control plane reachable to post audit and heartbeat
(`harness/src/index.ts:24-31`), so it is necessarily an allowed destination.

`POST /v1/api-keys/deliver` authorises on session ownership by the calling
principal (`routes_api_keys.py:147-153`) — the same principal. From inside the
sandbox:

```bash
curl -H "Authorization: Bearer $HARNESS_API_TOKEN" \
  "$HARNESS_API_URL/v1/api-keys/deliver" \
  -d '{"refs":["secret://acme/..."],"session_id":"'"$HARNESS_SESSION_ID"'"}'
```

returns every key visible to the org unit, in plaintext, through an allowed
destination. The same token can `POST /v1/assets` to publish poisoned skills
or memories to the team. `personal_access_tokens.expires_at` is nullable
(`0008_personal_access_tokens.sql:6`), so a leaked PAT may never expire.

**Fix.** Remove the token. Not scope it — remove it. The extension writes audit
events to `audit.jsonl` in the session directory; the supervisor tails the file
and forwards, and sends the heartbeat itself as the parent process. The control
plane leaves the allowlist. No backend change. Architecture §2.

---

## G2 — The child inherits the entire parent environment (critical, live)

`harness-cli/src/index.ts:122` spreads `...process.env` into the child. The
agent receives every credential exported in the user's shell — `AWS_*`,
`GITHUB_TOKEN`, `NPM_TOKEN`, cloud CLI state. These never passed through a
boundary, are not in `api_keys`, and are invisible to the audit log.

**Fix.** Build the child environment key by key from the allowlist in
architecture §2.

---

## G3 — `policy.json` is read once (low, live)

`loadPolicy` runs only in `session_start` (`harness/src/index.ts:99-100`);
`before_agent_start` reapplies without re-reading (`:111`).

**Status.** Not a gap under the current design. A policy change ends the
session (architecture §2), and the tool allowlist is advisory. Recorded so
nobody rediscovers it and assumes hot reload exists.

---

## G4 — The runtime's filter ignores ports (high, upstream)

`filterNetworkRequest(port, host, …)` (`sandbox-manager.js:51`) uses `port`
only in log strings. Allowing `github.com` allows `github.com:22`.

**Fix.** Ours is the only proxy (`httpProxyPort`, `sandbox-manager.js:176-179`,
makes the runtime skip starting its own). It accepts `CONNECT` to `:443` and
nothing else. No SOCKS in v1.

---

## G5 — The runtime filters the claimed target, not SNI (high, upstream)

The HTTP proxy filters the client-asserted `CONNECT` host; the SOCKS proxy
filters the SOCKS hostname. Neither parses the ClientHello. **Domain fronting
through an allowlisted CDN bypasses the allowlist**, and the runtime's README
says so.

**Fix.** In our proxy: parse SNI from the first TLS record of a tunnel and
require it to match the `CONNECT` host; refuse tunnels without SNI; refuse
IP-literal targets. Until then the honest claim is "destination allowlist,
fronting-vulnerable."

---

## G6 — A credential-attaching proxy on loopback is a confused deputy (high, macOS)

On macOS loopback is shared by every process of every user. A browser tab can
fire a cross-site `POST http://127.0.0.1:PORT/connectors/github/…`; CORS
prevents reading the response, not sending it, and the proxy would attach a
real key. Two concurrent sessions can reach each other's proxies.

Inside a Linux network namespace loopback is private and this does not apply.

**Fix.** Require a per-session secret via standard `Proxy-Authorization`,
delivered in the `HTTP_PROXY` URL. Every client already supports it.

---

## G7 — Filesystem reads are allow-by-default (high, design)

The runtime allows reads everywhere and honours only explicit denials
(Seatbelt: `(allow file-read*)` then deny rules; Linux: `--ro-bind / /`).
Linux denial has no glob support and only blocks files that exist at start.

Without a mandatory deny set the agent reads the user's credential — the same
one as G1, by another route — plus `~/.ssh`, `~/.aws`, and the rest.

**Fix.** Move the credential out of `~/.harness/` to
`~/.config/harness/credentials.json` so that `~/.harness/assets` can be the
writable work tree (asset-sync §3; build-plan 1.1). Ship the deny set in
architecture §4. `~/.harness/assets.git` and `policy.json` are outside the
write geometry; `audit.jsonl` and `sessions/<id>/agent` are inside it. Every
git invocation from the supervisor passes `-c core.hooksPath=/dev/null` — an
agent-planted hook would otherwise run outside the jail.

---

## G8 — The runtime degrades instead of failing closed (high, upstream)

Missing seccomp binaries: warn and continue without Unix-socket blocking
(`linux-sandbox-utils.js:201-203`, `:577-579`). `enableWeakerNestedSandbox`
drops `--proc` (`:652`). A `sandboxAskCallback`, if supplied, turns an
unmatched destination into a prompt instead of a denial
(`sandbox-manager.js:71-77`).

**Fix.** Treat every degraded initialisation as a failed boot. Never pass an
ask callback. Run the probes in architecture §2 so we observe the boundary
rather than assume it.

---

## G9 — Three config keys open a second way out (high, config)

- `allowLocalBinding: true` emits `(allow network-outbound (local ip
  "localhost:*"))` (`macos-sandbox-utils.js:373`) — outbound to every loopback
  service on the machine.
- `allowAllUnixSockets: true` emits `(allow network* (subpath "/"))` (`:378`).
- `allowUnixSockets` opens named sockets individually (`:381-385`).

**Fix.** Hard-code all three closed. They never appear in the plan.

---

## G10 — Writes outlive the session (medium, stated limit)

The agent writes a `postinstall`, `Makefile`, `.envrc`, or build hook. It runs
outside the sandbox with the user's full credentials the next time the user
builds. Mandatory denies cover `.git/hooks` and shell rc files, not build
scripts.

**Position.** Not fixable inside our threat model. Stated as philosophy §9.4.

---

## G11 — Supply chain is unpinned (medium)

`harness-cli/src/index.ts:117-119` resolves the Pi entrypoint, extension, and
theme by relative path with no integrity check. The runtime is 0.0.26, a
self-described Beta Research Preview, shipping prebuilt seccomp binaries in
`vendor/`, built on `sandbox-exec`, which Apple has deprecated.

**Fix.** Pin versions, checksum vendored bytes, re-audit the generated profile
on each bump. Document that a `pi` on the user's `PATH` is not what we run.

---

## G12 — No revocation path for a running session (medium)

`api_key_versions` models `active` / `grace` / `retired`, but a session that
received a key holds it for life, and nothing stops a session. The extension's
15-second flush updates `last_active_at`; the control plane can see a session
but cannot end it.

**Fix.** Once the proxy holds the keys, revocation is one check on the
supervise interval: key retired or session closed → refuse injection and
terminate. Control plane unreachable past the manifest TTL → terminate.

---

## G13 — The agent authenticates from the user's own profile (high, live)

`harness run claude` appeared to work against an org with **no `model-default`
connection at all**. It was not using the org's model. It was using the
developer's personal Anthropic credential.

`CLAUDE_CONFIG_DIR` relocates `~/.claude` — settings, history,
`.credentials.json`, and the macOS Keychain entry. It does **not** relocate
`~/.config/anthropic`, where the Anthropic profile (`active_config`,
`configs/`, `credentials/`) lives. `childEnvironment` passes `HOME` verbatim by
design (`env.ts:26` — `~/.harness` paths must resolve inside the jail), so the
profile stays reachable. With a fresh config dir there is no `/login`
credential to outrank it, so the active profile wins outright.

Demonstrated:

```
CLAUDE_CONFIG_DIR=$(mktemp -d) claude -p '...'                    → OK
HOME=$(mktemp -d) CLAUDE_CONFIG_DIR=$(mktemp -d) claude -p '...'  → Not logged in
```

Three separate problems, and the third is the worst:

1. **The boundary leaks.** §4's mandatory deny-read lists `~/.config/harness`
   and not `~/.config/anthropic`. Once the sandbox lands, an agent could read
   the user's personal provider credential — the same class as `~/.aws`, and
   missing for the same reason `~/.config/harness` was missing before G7.
2. **Metering and revocation are bypassed.** Traffic billed to a personal
   account is invisible to the org: not in `api_keys`, not in the audit log,
   not revocable by closing the session.
3. **It is silent, and the two agents disagree.** On the identical manifest,
   Pi refused (`No model is configured for your workspace.`) and Claude Code
   ran anyway. One of those is right and neither is honest: the user was told
   nothing about which credential paid for the session. `agents.md` §0 requires
   a difference between agents to be *declared, not discovered*; this one was
   discovered by accident.

**Fix.** Add `~/.config/anthropic` — and each adapter's own ambient credential
locations — to the deny-read set, sourced from the adapter rather than a fixed
list, since this is per-agent knowledge that moves with the agent. Independent
of the sandbox, make a null `manifest.model` resolve through
`boundary.model_policy` (`agents.md` §5.1) so both adapters reach the same
decision and say which credential a session is about to use. Native mode stays
available — but as a mode the org chose, not as an accident of `$HOME`.


## Corrections to earlier drafts

| We said | Correction |
| --- | --- |
| Mint a *scoped* session token for the agent | The agent needs no token. Audit goes to a local file the supervisor tails; heartbeat is the supervisor's. See G1. |
| Three network components — the runtime's HTTP proxy, its SOCKS proxy, ours on top | One proxy. `httpProxyPort` makes the runtime use ours and start none. |
| "Refuse `CONNECT`" *and* set `HTTPS_PROXY` | Contradictory — `HTTPS_PROXY` makes clients `CONNECT`. Two modes: tunnel (`CONNECT :443`, never inject) and inject (plaintext `/connectors/…`, never `CONNECT`). |
| `HARNESS_PROXY_TOKEN` as a custom header | Standard `Proxy-Authorization` via the `HTTP_PROXY` URL. |
| A `reconcile()` method and a hot/cold table | Removed. A policy change ends the session. |
| "The network namespace is removed entirely" | A *new* namespace with loopback only. `socat` relays inside forward to host Unix sockets. |
| "macOS allows one localhost port" | Two. |
| Bash-only sandboxing "misses fetch tools and MCP servers" | Pi has neither (`core/tools/index.ts:95`). The real reasons: `bash` spawns anything; the agent's own HTTP client is a process too. |
| "Hostname filtering operates on SNI" | Client-asserted target. G5. |
| "The proxy terminates TLS" | It *originates* upstream TLS; agent→proxy is plaintext on loopback. |
| Provider-issued narrow credentials are "cryptographic" | Enforced by the provider's authorization engine. Sufficient; not cryptography. |
| "RFC 8693 token exchange" as a general option | Present at Google, Okta, Auth0, Keycloak; absent from most SaaS APIs. |
| "Read-only is real against GitHub" | Only with `/graphql` refused and method-override headers stripped. |
| "Initialisation fails closed" | The runtime degrades. G8. |
| Egress allowlist is "cold" | Moot — nothing is hot. Policy change ends the session. |

---

## Priority

**Now, no sandbox needed:** G1, G2, G13 (the model-policy half). One `harness-cli` refactor, no backend
change, no user-visible difference. Until it lands, "the agent holds nothing"
is false.

**With the proxy:** G4, G5, G6, G12.

**With the sandbox:** G7, G8, G9, then probes.

**Standing:** G11. **Recorded, not gaps:** G3. **Stated limit:** G10.
