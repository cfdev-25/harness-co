# Engine Plan — 05 · The proxy

The fence. One process, started by the supervisor before the jail exists,
and the only thing the jail can reach. It does two jobs and keeps one
record: it decides where a packet may go (**tunnel**), it attaches a
credential the agent never held (**inject**), and it writes the
authoritative log of every attempt. `enforcement-philosophy.md` §3's clerk,
built.

## 1. Purpose

Before this document the engine has no network control of any kind and the
provider key sits in the child environment (`00 §6`). After it:

- the jail has one exit, and that exit refuses anything not derived from a
  grant or a routing decision (`prd-v2.md` §8);
- no credential value exists inside the jail — the agent is issued the
  **session secret** as its "API key", and the secret is worthless anywhere
  but this proxy (D70);
- every request, allowed or refused, is one `EndpointEvent`, and the console's
  *Endpoints reached* is built from nothing else (C29, C35).

The proxy enforces; it does not decide. `plan.hosts`, `plan.deny` and
`plan.connectors` are handed to it by preflight (03). Plan runs **after**
Mint (`00 §3` rows 5–6): `plan.connectors[alias]` is built from the minted
set joined to its `SecurityGroup` entry, whose `upstream` (an origin, no
path) and `attach` are the only source of those two fields (`00 §4.3`). The
reserved alias `model` is the exception — its upstream is
`ModelProvider.endpoints[wireFormat]`, which may carry a path prefix. So a
person who edits the plan on their own machine widens nothing: the proxy can
only attach credentials the broker was willing to mint, to the upstream the
org branch bound them to.

## 2. Invariants

| # | Invariant | Where it holds |
| --- | --- | --- |
| P1 | **One exit.** The proxy is the only listener the jail can reach; there is no SOCKS listener, no second HTTP proxy (C24, D4). | §4.1; 06 |
| P2 | **Two modes, never mixed.** A `CONNECT` never injects; a plaintext `/connectors/…` request never tunnels (C24). | §5, §6 |
| P3 | **Deny wins.** `plan.deny` is checked before `plan.hosts` and before reach, whatever reach says (prd-v2 §7 "boundaries override everything"). | §5.4 |
| P4 | **Absent is not empty.** An empty `deny` denies nothing; absent reach is `off`, and `hosts` is the derived list, never `[]` (C32, D20, D131). | §5.5 |
| P5 | **No value leaves this process.** Credentials live in memory; never in the log, never in a response body, never in an error (I3). | §7 |
| P6 | **One event per thing that happened**, refusals included (C29). An attempt is one event; a model request the proxy took a capability out of is two — the `stripped` row and the request's own (D134). | §8, §6a |
| P7 | **Fail closed.** Unknown host, unknown alias, malformed hello, unverifiable upstream certificate: refuse. No insecure option exists (I5; `10` rule 3). | §9 |
| P8 | **Authenticated callers only.** Every request carries the session secret, on both operating systems (G6). | §4.3 |
| P9 | **The proxy originates upstream TLS.** Agent → proxy is plaintext on loopback or a unix socket; proxy → upstream is TLS with certificate verification. | §6.7 |
| P10 | **A control ships only with a choke point we own** (C4). Reach by name is that choke point; what a tunnel carries is not seen and is not claimed (§10). | §10 |
| P11 | **Every refusal says which rule refused it and who owns that rule.** `EndpointEvent.reason` and `.setBy`, on the wire and in the console, so a refusal is something a person can act on rather than a mystery (D133). | §5.6, §6a, §8 |

## 3. Contracts used

From `00 §4`, by name, unchanged: `SpawnPlan` (`hosts`, `deny`, `reach`,
`connectors`), `Reach`, `EffectiveReach`, `MintedCredential`,
`EndpointEvent`, `EndpointTally`, `Blocker`, `RenderContext.proxyUrl`, and
the `POST /v1/sessions/{id}/endpoints` row of `§4.10`.

`EndpointEvent.status` includes `"sni-mismatch"` (§5 step 9) and
`"stripped"` (§6a); `EndpointEvent.reason` and `.setBy` carry why a request
was refused or shaped and which node decided (D133); `EndpointEvent.usage`
carries model token counts (§6 step 9). `EndpointTally` adds `stripped` and
`reasons`. All of them are in `00 §4.7`.

`SpawnPlan.hosts` is a list and never `"any"`: it is the credentialed hosts
plus the model endpoint host, and everything beyond it is `plan.reach`
(01 D131, D132).

## 4. Module layout

`engine/cli/src/proxy/`, ceiling **500** source lines, `node:http`,
`node:net`, `node:tls`, `node:dns`, `node:crypto`, `node:fs` only.

| File | Exports | LOC | Does |
| --- | --- | --- | --- |
| `proxy.ts` | `startProxy(opts): Promise<Proxy>` | ~120 | listener (TCP or unix socket), authentication, dispatch to tunnel or inject, the `Proxy` handle |
| `tunnel.ts` | `tunnel(req, socket, head, ctx)` | ~110 | `CONNECT` policy, proxy-side DNS, SNI gate, byte splice |
| `hello.ts` | `serverName(buf): string \| null \| "incomplete"` | ~80 | pure ClientHello parse (§5.8); T1-tested |
| `inject.ts` | `inject(req, res, ctx)` | ~140 | connector rewrite, header policy, upstream TLS, streaming, usage sniff |
| `log.ts` | `openLog(path): EndpointLog` | ~50 | append-only `endpoints.jsonl`, `tally()` |

```ts
interface ProxyOptions {
  plan: Pick<SpawnPlan, "hosts" | "deny" | "connectors">;
  credentials: MintedCredential[];
  secret: string;                          // 32 random bytes, base64url; generated by 08
  sessionDir: string;
  listen: { kind: "tcp" } | { kind: "unix"; path: string; port: number };  // §4.1
  notify: (message: string) => void;       // one line to the person; 08 prints it
}

interface Proxy {
  readonly url: string;                    // http://harness:<secret>@127.0.0.1:<port>
  retire(alias: string): void;             // §7.2
  close(): Promise<void>;                  // §7.3
  tally(): EndpointTally[];
}
```

`ProxyOptions` and `Proxy` are private to this module; they are not
contract types because nothing outside `08` constructs or holds them.

### 4.1 Listener

| OS | Listens on | The jail reaches it by |
| --- | --- | --- |
| macOS | `127.0.0.1:0` — an ephemeral TCP port, read back after `listen` | the Seatbelt profile allows outbound to `localhost:<port>` and nothing else (06) |
| Linux | a unix stream socket at `<sessionDir>/proxy.sock`, mode `0600`, created after `listen` with `chmod` | 06 bind-mounts the socket into the namespace at the same path and runs the **forwarder** inside, which listens on `127.0.0.1:<port>` and pipes bytes to the socket. `port` is chosen by 08 before spawn and passed to both. |

The socket contract for 06's forwarder: a stream socket speaking HTTP/1.1
proxy protocol exactly as the TCP listener does; the forwarder copies bytes
and interprets nothing. Everything below applies identically to both.
**Until the jail lands** (09 M4), Linux listens on loopback TCP exactly as
macOS does — `listen: { kind: "tcp" }` — and the unix-socket form is
switched on with 06. Nothing else in this document changes between the two.

The child environment (08) carries:

```
HTTP_PROXY=http://harness:<secret>@127.0.0.1:<port>
HTTPS_PROXY=http://harness:<secret>@127.0.0.1:<port>
NO_PROXY=127.0.0.1
```

`NO_PROXY` names the proxy's own host and nothing else: the inject leg is a
plain request to that origin, and a client that honours `HTTP_PROXY` for
every request — undici's `EnvHttpProxyAgent`, which Pi installs as its
global dispatcher — would otherwise `CONNECT` the proxy to itself (found
28 Sep on the first real model call; the tunnel refused it, correctly, as
loopback). No inherited default can exempt any other host.

**Why the secret is still required on Linux.** Inside a network namespace
loopback is private, but the unix socket is a file: a concurrent session of
the same OS user, or any process of that user outside the jail, can connect
to it. `0600` narrows that to the user; the secret narrows it to this
session (G6, belt and braces).

### 4.2 The session secret is the agent's key

Every provider is configured with the secret as its credential —
`ANTHROPIC_AUTH_TOKEN=<secret>` for Claude Code, `apiKey: "$HARNESS_SESSION_SECRET"`
in Pi's `models.json` with `HARNESS_SESSION_SECRET` in the child environment
(07 §7, 08 §7) — and with its base URL pointing at
`<proxyUrl>/connectors/model/`. The agent therefore presents the secret on
every model call in whatever header its client uses, and the proxy swaps it
for the real credential. One secret, one place it is honoured, nothing to
steal.

### 4.3 Authentication

Accepted carriers of the secret, checked in this order and all stripped
before anything is forwarded:

| Mode | Header | Form |
| --- | --- | --- |
| tunnel, inject | `Proxy-Authorization` | `Basic base64("harness:" + secret)` — standard proxy auth from `HTTP_PROXY`; the proxy reads what follows the first `:`. The username is a constant because undici's `ProxyAgent` (Pi's dispatcher) sends **no** `Proxy-Authorization` for a URL with an empty username — found 28 Sep: every tunnel from Pi was refused `bad-secret` |
| inject | `Authorization` | `Bearer <secret>` — what Claude Code and OpenAI-shaped clients send (C23) |
| inject | `x-api-key` | `<secret>` — what Anthropic-shaped clients send (D70) |

Comparison is constant-time: SHA-256 both sides, `crypto.timingSafeEqual`.
A missing or wrong secret on any request → `407 Proxy Authentication Required`,
`Proxy-Authenticate: Basic realm="harness"`, **no body**, event
`status: "bad-secret"`. The person is notified once per session on the first
`bad-secret` (it means something on the machine is probing the proxy).

## 5. Tunnel mode — `CONNECT host:port`

Numbered; the code names the step.

1. **Parse.** `CONNECT authority HTTP/1.1`. `authority` must be `host:port`
   with a numeric port. Anything else → `400`, `status: "no-route"`.
2. **Authenticate** (§4.3).
3. **Port.** `port !== 443` → refuse, `403`, body
   `Only port 443 is reachable through the harness.`, `status: "no-route"`
   (G4).
4. **Normalise host.** Lower-case; strip one trailing dot. An IPv4 dotted
   quad or bracketed IPv6 literal → refuse, `403`,
   `Connect by name, not by address.`, `status: "ip-literal"`.
5. **Deny.** If `host` matches any pattern in `plan.deny` → refuse, `403`,
   `<host> is blocked by a boundary set by <org|team>.`, `status: "denied"`.
   A pattern is an exact host or `*.suffix` (matches any subdomain, not the
   apex); optional `:443` is ignored. Deny is evaluated before allow and
   under `"any"` (P3).
6. **Route.** One call: `routable(plan, host, port)` (§6a). `{ ok: true }`
   continues; `{ ok: false, reason }` refuses, `403`,
   `status: "no-route"`, with `event.reason` set to the reason and
   `event.setBy` to `plan.reach.setBy`, and the body
   `<host> is not reachable from this harness: <why>.` — one sentence per
   reason, from §6a's table. Nothing here consults grants: reach is
   `policy/reach.json`, composed (01 D131, D132).
7. **Resolve.** `dns.promises.lookup(host, { all: true })` — proxy-side, so
   the jail never needs a resolver (06 gives it none). Failure → `502`,
   `Could not resolve <host>.`, `status: "no-route"`. Under `"any"` only:
   if every address is loopback, link-local, RFC 1918, CGNAT or ULA →
   refuse, `403`, `<host> resolves to a private address.`, `status: "denied"`
   (D71). A host in `plan.hosts` is exempt — an admin chose it. The rule now
   applies to anything reach let through, which is where it was always aimed.
8. **Accept the tunnel.** Write `HTTP/1.1 200 Connection Established\r\n\r\n`.
   Do **not** connect upstream yet.
9. **SNI gate** (G5). Buffer client bytes (any `head` bytes first) until
   `serverName()` returns a name or `null`, up to 16 KiB or 5 s. Then:
   `"incomplete"` at the cap or timeout, or a first byte that is not `0x16` →
   close the socket, `status: "no-sni"`. `null` (a ClientHello with no
   `server_name`) → close, `status: "no-sni"`. A name ≠ `host` → close,
   `status: "sni-mismatch"`. After a `200` the only refusal available is
   closing; the person gets the notice.
10. **Connect and splice.** `net.connect(443, address)` (first resolved
    address, then the rest on `ECONNREFUSED`). On connect, write the buffered
    hello, then `socket.pipe(upstream)` and `upstream.pipe(socket)`. Count
    bytes each way. When either side ends, end the other. Nothing after the
    hello is read by the proxy — it is TLS the proxy cannot see and does not
    try to (P9 is about the *inject* leg; a tunnel is opaque by design).
11. **Log** one event: `mode: "tunnel"`, `host`, `port: 443`, `status: 200`
    or the refusal status, `bytesOut` (agent → upstream), `bytesIn`.

Timeouts: 10 s to connect upstream (`502`, `status: "no-route"`); no idle
timeout on an established tunnel (an editor session can sit for hours).

### 5.8 `serverName(buf)` — the ClientHello byte-walk

Pure, in `hello.ts`. Offsets are into `buf`; every length check that fails
returns `"incomplete"`; every structural check that fails throws
`hello.malformed`, which the tunnel treats as `"no-sni"`.

| Step | Bytes | Check / take |
| --- | --- | --- |
| 1 | `[0]` | content type must be `0x16` (handshake) else throw |
| 2 | `[1..2]` | legacy record version; ignored |
| 3 | `[3..4]` | record length `L`; need `5 + L` bytes, else `"incomplete"` |
| 4 | `[5]` | handshake type must be `0x01` (ClientHello) else throw |
| 5 | `[6..8]` | handshake length; must equal `L - 4` else throw |
| 6 | `[9..10]` | client version; ignored |
| 7 | `[11..42]` | 32 bytes random; skip |
| 8 | `[43]` | session-id length `s` (0–32); skip `s` |
| 9 | next 2 | cipher-suites length `c` (even, ≥ 2); skip `c` |
| 10 | next 1 | compression-methods length `m` (≥ 1); skip `m` |
| 11 | next 2 | extensions length `e`; if absent (buffer ends here) → `null` |
| 12 | loop | extension `type` (2), `len` (2), `data` (`len`); walk until `e` consumed |
| 13 | type `0x0000` | `server_name`: list length (2); entries of `name_type` (1) `name_len` (2) `name`; the first entry with `name_type === 0` is the host name, decoded as ASCII, lower-cased, trailing dot stripped → return it |
| 14 | end of extensions | no `server_name` → `null` |

A ClientHello split across two TLS records is treated as `"incomplete"` until
the first record is whole; the parse never spans records. `hello.ts` is
T1-tested with captured hellos from Node, curl, and Go (§10).

## 6. Inject mode — `METHOD /connectors/<alias>/<path>`

1. **Form.** The request target must be origin-form beginning
   `/connectors/`. Absolute-form (`http://…`) → `400`,
   `Use the connector path, not a full URL.`, `status: "no-route"`.
   Any other origin-form path → `404`, `status: "no-route"`.
2. **Alias.** `/connectors/<alias>/<rest>`; `alias` matches
   `^[a-z0-9][a-z0-9-]{0,63}$`. Unknown in `plan.connectors` → `404`,
   `No connector named "<alias>" in this session.`, `status: "no-route"`.
3. **Authenticate** (§4.3), any of the three carriers.
4. **Credential state** (§7). Retired or expired → `403`,
   `The credential for "<alias>" was rotated; start a new session to use it.`,
   `status: "retired"`. Proxy closed → `503`, no body, `status: "retired"`.
5. **Upstream.** `url = connector.upstream` with any trailing `/` removed,
   then `/` + `rest` + the original query. For an entry alias `upstream` is
   an origin (`https://api.stripe.com`); for `model` it is the endpoint URL
   and may end in a path (`https://openrouter.ai/api/v1`). Both are `https://`
   by construction (03 refuses anything else at plan time). `plan.deny` is
   checked against the upstream host — deny wins here too (P3); match →
   `403`, `status: "denied"`.
6. **Headers out.** Copy every request header except: hop-by-hop
   (`Connection` and the headers it names, `Keep-Alive`, `Proxy-*`, `TE`,
   `Trailer`, `Transfer-Encoding`, `Upgrade`), `Cookie`,
   `X-HTTP-Method-Override`, `Host`, and the three secret carriers. Set
   `Host` to the upstream host. Set `attach.header` to
   `attach.prefix + value` — this is the **replace** of C23: the secret came
   in on `Authorization`; the real credential goes out on `Authorization` (or
   `x-api-key`), and the inbound value is gone. `Upgrade` requests are
   refused (`426`, `status: "no-route"`) — WebSockets are out of scope (§12).
7. **TLS.** `https.request` with `servername = upstreamHost`, the default CA
   store, and `rejectUnauthorized` **not** exposed as an option. A certificate
   failure → `502`, `Could not verify <host>.`, `status: 502`. Connect timeout
   10 s; idle timeout 300 s (a streaming model response can pause; a dead one
   should not hold the connection forever).
8. **Stream.** `req.pipe(upstreamReq)`; on response, copy status and headers
   minus hop-by-hop, `res.flushHeaders()`, `upstreamRes.pipe(res)`. Nothing is
   buffered; `text/event-stream` flows chunk by chunk. Upstream status is
   returned as-is, including `4xx`/`5xx` — the proxy never rewrites an
   upstream error into its own.
9. **Usage** (`alias === "model"` only). A
   tee of the response body (capped at 1 MiB) is inspected after the response
   ends: for JSON, `usage.input_tokens`/`usage.output_tokens` or
   `usage.prompt_tokens`/`usage.completion_tokens`; for SSE, the last event
   carrying a `usage` object (Anthropic `message_delta`, OpenAI final chunk).
   Either shape is accepted so the plan needs no wire-format field (D73).
   Absent → `usage: null`. Native mode has no `model` connector — model
   traffic is a tunnel — and the console shows *not metered*, never zero
   (C22).
10. **Log** one event: `mode: "inject"`, `host` = upstream host, `port: 443`,
    `alias`, `method`, `path` with the query removed, `status` = upstream
    status or the refusal, `bytesOut`, `bytesIn`.

**One connector per wire format.** A model provider exposing two formats at
two URLs is two connectors (`model` for the chosen format only — `Choices`
already picked one) — a connector is a URL, and D27 stands: only the
credential and the allowlist are shared.

## 6a. Reach — the two questions

Three days of the endpoint log said the fence held: every search engine,
package registry and source host the agent tried was refused, and the only
host reached was the model provider's. Fresh web content still arrived,
because a model request can ask the provider to browse **on the provider's
own servers**, where there is no packet for a fence to see.

Reach is therefore two policies, not one, and this section is both:

1. **Where may the machine connect?** — `routable`, below, used by §5 step 6.
2. **What may a model request ask the provider to do?** — `shapeModelRequest`,
   below, used by §6 step 7a.

Both read one value: `plan.reach`, the `EffectiveReach` the composition and
the chosen harness produced (01 D131). The proxy never derives it and never
consults a grant.

### 6a.1 `routable(plan, host, port)` — D133

Pure, exported from `tunnel.ts`. It answers `{ ok: true }` or
`{ ok: false, reason }`, and the reason is the whole of why:

| `reason` | When | The sentence |
| --- | --- | --- |
| `port` | `port !== 443` | `only port 443 is open` |
| `reach.off` | `mode === "off"` and the host is not credentialed | `reach is off for this harness` |
| `reach.not-listed` | `mode === "allow"` and no pattern matches | `it is not on the allow-list` |
| `reach.denied` | `mode === "on"` and a pattern matches | `it is on the deny-list` |

Three rules make it, in this order:

- **A host in `plan.hosts` is always routable on 443.** It is there because
  a credential is attached to it or because it is the model endpoint; reach
  is about the rest of the internet.
- **Host matching is exact, or `*.` and a suffix** matching any subdomain
  but not the apex — D77's rule, one implementation
  (`compose/src/reach.ts hostMatches`), shared with `plan.deny`.
- **`plan.deny` is not here.** A boundary beats everything and is checked
  before this, in §5 step 5, with `reason: "boundary"` and `setBy` the node
  that set it (P11, P3).

Every refusal writes `event.reason` and `event.setBy` — the node whose
policy decided, or `harness:<id>`. That pair is what the console's Endpoints
tab groups by and what its **Allow** action writes against; the screen that
reads them, and the one that sets `plan.reach` in the first place, are
[console 04](../console/04-screens.md) §14.1 and §9.1.

### 6a.2 `shapeModelRequest(wireFormat, body, reach)` — D134

Pure, exported from `inject.ts`, called by §6 step 7a on `POST` to the
`model` connector when `reach.mode !== "on"`. It parses the JSON body,
removes every capability that makes the provider browse or execute on its
side, and returns the new bytes with the names of what it removed:

| Wire format | Removed |
| --- | --- |
| `anthropic-messages` (and `bedrock-converse`) | `tools[]` of type `web_search_*`, `web_fetch_*`, `code_execution_*`; top-level `mcp_servers`; top-level `container` |
| `openai-completions` / `openai-responses` | `tools[]` of type `web_search`, `web_search_preview`, `mcp`, `code_interpreter`; top-level `web_search_options` |
| OpenRouter (the OpenAI shape) | the model's `:online` suffix; `plugins[]` entries with `id: "web"` |

**`allow` strips too, and that is the point.** An allow-list is a list of
hosts the *machine* may reach; a fetch made on the provider's servers does
not pass the fence and cannot be held to a list. So only `on` — *reach
anything but this deny-list* — permits provider-side browsing, and `off` and
`allow` both take it out. A body that does not parse as a JSON object is
passed as it came: there is nothing in it to shape, and the provider will
refuse it on its own terms.

The wire format comes from `plan.connectors.model.wireFormat`, which 03's
`credentials` enforcer sets from `Choices.model.wireFormat`. This reverses
half of D73: the *usage* sniff stays shape-agnostic, because both field
shapes are cheap to accept; *which key names a capability* is not guessable
and the plan says it.

Each strip is one `EndpointEvent`: `mode: "inject"`, the model host,
`status: "stripped"`, `reason: "stripped:<comma-separated names>"`, `setBy`
the node reach came from, and zero bytes each way. The request's own event
follows when it completes, which is why P6 is worded *one event per thing
that happened*: the strip is a thing that happened. The one-line terminal
notice stays, and now names the mode and the node, so the person knows where
to go.

The advisory half of the same rule lives in the adapters: Claude's generated
`settings.json` denies `WebSearch` and `WebFetch` on exactly the same
condition (`plan.reach.mode !== "on"`), so the model reads a refusal instead
of a silence. `layout.ts reachLine()` puts one sentence in every brief
saying what this session can reach and who decides — intercepted, not
enforced (prd-v2 §7); this section is the enforced half.

## 7. The credential table

Loaded once from `MintedCredential[]` at start: `alias → { value, kind,
expiresAt, retired: false }`. Because the plan is built from the minted set,
every alias in `plan.connectors` has an entry by construction; `startProxy`
still checks and throws `proxy.missing_credential` if not, since a plan
with a connector and no credential is a bug in 03, and a proxy must never
start with a hole (I5).

1. **Lookup** happens per request (§6.4). `expiresAt` in the past is treated
   as retired; the broker sized the lease to the session, so this means the
   session outlived its credentials and 08 will end it on the next tick.
2. **`retire(alias)`** — called by 08 when `GET /v1/sessions/{id}` returns
   the alias in `retired`. Per 04, this is what a **rotated key** does: that
   alias is refused from the next request on and **the session continues**
   (G12). An in-flight stream is not cut — it already holds an upstream
   connection the proxy cannot un-send. A **grant or boundary change** is not
   a retire: 04 revokes the whole session (`status: "revoked"`), 08 calls
   `close()` and terminates the child (C33). The proxy never decides which;
   it has two verbs and 08 picks.
3. **`close()`** — called by 08 at session end. Sets a closed flag: every
   subsequent request in either mode is refused (`503`, `status: "retired"`),
   open tunnels are destroyed, the listener closes, the socket file is
   removed, the log is flushed, and every `value` string is overwritten with
   zeros before the map is cleared (best effort in a managed runtime; the
   habit costs nothing).

Values are never interpolated into any string the proxy writes — not the
log, not a response, not an `Error` message. Test
`values_never_in_log_or_body` asserts it by grepping both.

## 8. The authoritative log

`<sessionDir>/endpoints.jsonl`, created `0600` by the supervisor before
spawn alongside `audit.jsonl` (C28), appended by the proxy, **outside the
jail** — the geometry (06) denies the jail read and write on it. One line
per `EndpointEvent`, written before the response is sent so a crash cannot
lose a refusal.

| Logged | Not logged |
| --- | --- |
| time, mode, host, port, alias, method, path without query, status, reason, setBy, bytes each way | request or response bodies; any header; query strings; DNS answers; anything inside a tunnel; the names in `reason` are capability *types*, never content |

08 batches new lines to `POST /v1/sessions/{id}/endpoints` on the supervise
tick and sends `tally()` with the closing `PATCH` (`00 §4.10`). The server
writes each event to the audit chain as `session.endpoint`, authoritative
class — the proxy is outside the jail and the person cannot forge a line
without also owning the supervisor, which the threat model concedes
(`enforcement-philosophy.md` §1).

`tally()` groups by `(host, port, alias)`: `count`, `refused`, `stripped`,
`reasons` (reason → how many carried it), `firstAt`, `lastAt`. The console's
Endpoints tab groups the events themselves one step finer — by
`(host, outcome, reason, setBy)` — because a host refused for two reasons is
two things to do something about. This is what makes *"api.openai.com
appeared in the log and became a boundary the same week"* (prd-v2 §7)
possible, and what makes the refusal actionable rather than just visible.

## 9. Failure modes

Every refusal has a code, what the agent sees, what the person sees, and the
event status. The agent is untrusted but the person reads the transcript, so
a body is one sentence in plain words, never a stack trace.

| Code | Mode | Agent sees | Person sees (once per host per session) | `status` |
| --- | --- | --- | --- | --- |
| `proxy.auth.bad_secret` | both | `407`, no body | `Something on this machine tried the proxy without the session secret.` | `bad-secret` |
| `proxy.tunnel.port` | tunnel | `403 Only port 443 is reachable through the harness.` | `<host>:<port> refused — only 443 is open.` | `no-route` |
| `proxy.tunnel.ip_literal` | tunnel | `403 Connect by name, not by address.` | `A connection to <ip> was refused — addresses are not allowed.` | `ip-literal` |
| `proxy.tunnel.denied` | tunnel | `403 <host> is blocked by a boundary.` | `<host> refused by boundary "<reason>".` | `denied`, `reason: "boundary"` |
| `proxy.tunnel.not_routable` | tunnel | `403 <host> is not reachable from this harness: <why>.` (§6a.1's four) | `<host> refused — <why> (set by <setBy>).` | `no-route`, with `reason` and `setBy` |
| `proxy.tunnel.dns` | tunnel | `502 Could not resolve <host>.` | — | `no-route` |
| `proxy.tunnel.private_address` | tunnel | `403 <host> resolves to a private address.` | `<host> refused — it points inside your network.` | `denied` |
| `proxy.tunnel.no_sni` | tunnel | socket closed after `200` | `<host> refused — the connection did not name a server.` | `no-sni` |
| `proxy.tunnel.sni_mismatch` | tunnel | socket closed after `200` | `<host> refused — the connection was for <sni>, not <host>.` | `sni-mismatch` |
| `proxy.tunnel.upstream` | tunnel | socket closed | — | `no-route` |
| `proxy.inject.absolute_form` | inject | `400 Use the connector path, not a full URL.` | — | `no-route` |
| `proxy.inject.unknown_alias` | inject | `404 No connector named "<alias>" in this session.` | `Something asked for a connector "<alias>" this session does not have.` | `no-route` |
| `proxy.inject.retired` | inject | `403 The credential for "<alias>" was rotated; start a new session to use it.` | `The credential for "<alias>" was rotated; requests to it are refused until your next session.` | `retired` |
| `proxy.inject.denied` | inject | `403 <host> is blocked by a boundary.` | as tunnel | `denied` |
| `proxy.inject.upgrade` | inject | `426 WebSockets are not available through connectors.` | — | `no-route` |
| `proxy.inject.upstream` | inject | `502 Could not reach <host>.` / `502 Could not verify <host>.` | `<alias> is unreachable: <one line>.` | `502` |
| `proxy.inject.body_too_large` | inject | `413 A model request must be under 16 MiB to be inspected.` | — | `no-route` |
| — (not a refusal) | inject | nothing: the request goes, one capability lighter (§6a.2) | `<names> not sent: reach is \`<mode>\` for this harness (set by <setBy>), so the provider may not browse on its own side either.` | `stripped`, `reason: "stripped:<names>"` |
| `proxy.closed` | both | `503`, no body | — | `retired` |
| `proxy.missing_credential` | boot | — (the session does not start) | Blocker: `The broker did not supply a credential for "<alias>".` remedy: `Run harness preflight credentials; the slot names the group that should cover it.` | — |

Anything else thrown inside a handler is a bug: the request is destroyed
(`socket.destroy()`) and the exception propagates to 08, which ends the
session (`10` rule 12).

## 10. Threat notes

What this proxy claims and does not, in `enforcement-philosophy.md`'s terms.

- **Structural, claimed.** Destination allowlist by name, verified against
  SNI, port 443 only, proxy-side DNS, IP literals refused: domain fronting
  through an allowed CDN is closed (G5 → closed). A credential the agent
  never possessed is attached per request (§3 clerk). Every request logged.
  Confused deputy on shared loopback closed by the per-session secret (G6 →
  closed). Port-blind filtering closed (G4 → closed). Revocation mid-session:
  a rotated key retires one alias and the session continues; a grant or
  boundary change revokes the session and 08 closes the proxy (G12 → closed
  for injected credentials; a tunnel already open is not cut, stated).
- **Shape-blind inside a tunnel, by design.** A tunnel is TLS the proxy does
  not terminate. It cannot tell a `git push` from a `git fetch` to an allowed
  forge. *Exfiltration through allowed destinations* (§6) is therefore not
  addressed here: the answer is request-shape capabilities on connectors,
  which are Later (§12), and provider-issued narrow credentials (§7), which
  are the broker's business (04).
- **ECH.** A client using Encrypted Client Hello sends a public outer name,
  which will not match the `CONNECT` host and is refused as `sni-mismatch`.
  Node, curl and Go do not send ECH by default; if a provider binary ever
  does, the fix is to allow that provider's published outer name for its
  hosts — not to drop the SNI check (D78).
- **Private-address refusal under `"any"`** (D71) stops an outside-endpoints
  grant from becoming a route into the customer's LAN via a DNS name the
  agent controls. Listed hosts are exempt because an admin listed them.
- **Not claimed.** Semantic inspection of anything. Protection against a
  person who owns the machine. Isolation between two concurrent sessions
  beyond the secret. Body-level scope reduction.

## 11. Tests

T1 (`hello.ts`): `hello_parses_sni_node`, `hello_parses_sni_curl`,
`hello_parses_sni_go`, `hello_returns_null_without_server_name`,
`hello_incomplete_on_short_buffer`, `hello_malformed_on_non_handshake`,
`hello_ignores_second_record`.

T3 conformance (`proxy.test.ts`, a real listener and a local TLS upstream
with a self-signed CA injected only into the test's upstream, never into the
proxy — the proxy must refuse the self-signed cert in
`inject_refuses_unverified_upstream` and accept it only when the test
provides a CA through the standard `NODE_EXTRA_CA_CERTS`):

`tunnel_refuses_non_443` · `tunnel_refuses_ip_literal` ·
`tunnel_refuses_sni_mismatch` · `tunnel_refuses_no_sni` ·
`tunnel_allows_listed_host` · `tunnel_refuses_unlisted_host_when_reach_is_off` ·
`tunnel_allows_unlisted_host_when_reach_is_on` ·
`tunnel_refuses_a_host_on_the_deny_list_under_reach_on` ·
`tunnel_refuses_a_host_off_the_allow_list` · `deny_beats_reach` ·
`deny_wildcard_matches_subdomain_not_apex` ·
`private_address_refused_under_reach` · `listed_private_address_allowed` ·
`inject_replaces_authorization` · `inject_accepts_x_api_key_carrier` ·
`inject_strips_cookie` · `inject_strips_method_override` ·
`inject_refuses_unknown_alias` · `inject_refuses_retired_alias` ·
`inject_refuses_expired_credential` · `inject_refuses_absolute_form` ·
`inject_refuses_upgrade` · `inject_refuses_unverified_upstream` ·
`inject_returns_upstream_status_unchanged` · `bad_secret_407_no_body` ·
`sse_streams_without_buffering` (assert the first event arrives before the
upstream closes) · `every_request_logged_including_refusals` ·
`log_has_no_query_string` · `values_never_in_log_or_body` ·
`retire_takes_effect_on_next_request` · `closed_proxy_refuses_all` ·
`unix_socket_listener_requires_secret` (Linux CI) ·
`tally_groups_by_host_port_alias`.

`inject_shapes_the_model_request_unless_reach_is_on` ·
`inject_leaves_the_model_request_alone_when_reach_is_on`.

T1 (`reach.test.ts`, §6a's two functions, pure): `routable` over each of the
four reasons and the credentialed-host exemption; `shapeModelRequest` over
each row of §6a.2's table, over `on` leaving a body untouched, and over a
body that is not JSON.

Idempotency (`10` rule 19): `close_twice_is_harmless`.

## 12. Decisions

| # | Decision | Reverse by |
| --- | --- | --- |
| D69 | Two verbs, two causes (per 04): `retire(alias)` for a rotated key, session continues; `close()` for a revoked session, 08 terminates. The proxy never infers which | — |
| D70 | The session secret is the agent's credential everywhere; three carriers accepted (`Proxy-Authorization`, `Authorization: Bearer`, `x-api-key`) | dropping `x-api-key` — but Pi's Anthropic-shaped client then cannot present the secret |
| D71 | A host reach let through — one not in `plan.hosts` — resolving only to loopback/link-local/private/CGNAT/ULA is refused; a host in `plan.hosts` is exempt | one predicate in `tunnel.ts` step 7 |
| D72 | After `200 Connection Established` the only refusal is closing the socket; refusals before it carry a one-sentence `403` body | — inherent to `CONNECT` |
| D73 | Usage is sniffed shape-agnostically (both Anthropic and OpenAI field names); no wire-format field is added to `SpawnPlan` | adding `wireFormat` to `connectors[alias]` in `00 §4.5` |
| D74 | Inject logs the path without its query; tunnel logs the host only | — |
| D75 | Linux listens on a unix socket in `sessionDir` and the jail reaches it through a forwarder (06); the secret is still required | a `veth` pair and a loopback TCP listener — more moving parts for the same property |
| D76 | Request-shape capabilities (`GET`-only connectors, path allowlists) are Later; the hook point is a per-connector predicate in `inject.ts` step 5 | — |
| D77 | Deny patterns are exact host or `*.suffix`; no regex, no CIDR | — |
| D78 | ECH clients are refused by the SNI check; the remedy if one appears is to allow the provider's published outer name, never to drop the check | — |
| D79 | Idle timeout: none for tunnels, 300 s for inject; connect timeout 10 s for both | constants in `proxy.ts` |
| D133 | **The tunnel decides by rule, and says which.** One function, `routable(plan, host, port)`, returns `{ ok: true }` or `{ ok: false, reason }` with `reason` one of `port`, `reach.off`, `reach.not-listed`, `reach.denied`; a host in `plan.hosts` is always routable on 443 and `plan.deny` is checked before it. `EndpointEvent` gains `reason` and `setBy`, so every refused row in the console names the rule and the node that owns it, and the **Allow** action knows where to write | folding the four reasons back into one `no-route`; the console then shows a refusal nobody can act on, which is what §6a exists to end |
| D134 | **A model request is shaped, not just routed.** Unless `reach.mode === "on"`, `shapeModelRequest` removes every provider-side browsing and execution capability from the body, per wire format, and logs one `stripped` event naming them. `allow` strips too: a fetch made on the provider's servers cannot be held to a host list. `plan.connectors.model.wireFormat` carries the format — half of D73 reversed, for shaping only | letting `allow` keep provider-side browsing; the fence would then be a fence with a published hole |

## 13. Out of scope

SOCKS. Ports other than 443. HTTP/2 or HTTP/3 to the proxy (clients speak
HTTP/1.1 to a proxy; upstream HTTP/2 is Node's default negotiation and needs
nothing from us). WebSocket upgrade through connectors. Request-shape
allowlists and body inspection (Later, D76). Budgets and rate limits (Later;
the counter would live in the credential table). A remote gateway (a
different `upstream`, nothing else moves). Provider-issued narrow credentials
(04). The forwarder binary (06). Which hosts and connectors end up in the
plan (03).

## 14. Definition of done

- `engine/cli/src/proxy/` exists under 500 lines with the five files in §4
  and no dependency outside `node:*`.
- Every test in §11 passes on macOS and Linux CI; the Linux run exercises the
  unix-socket listener.
- `harness run` in org mode starts the proxy, the provider's model traffic
  goes through `/connectors/model/`, and **the provider key is absent from
  the child environment** — `harness preflight env` shows no credential
  variable and `HARNESS_REDACTIONS` no longer exists (`00 §6` rows 1–2
  deleted, with their tests).
- `<sessionDir>/endpoints.jsonl` is produced for every session; a refused
  host appears in the console's *Endpoints reached* within one supervise
  tick.
- `enforcement-gaps.md` G4, G5, G6 and the injected-credential half of G12
  are marked closed by this document.
- Every code in §9 is spelled as in `00 §4.7`'s style rule and appears in code verbatim, once.
