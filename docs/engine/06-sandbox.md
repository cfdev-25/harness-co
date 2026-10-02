# Engine Plan — 06 · Sandbox

Process confinement of the provider. What the jail is, on each operating
system, in exact terms; what is inside it and what is not; the geometry it
enforces; the probes that prove it before anything runs; and the one answer
to every failure, which is that the session does not start.

Implements `00` I3, I5; C7, C11, C20, C25, C26, C27; D4, D12, D21.
Supersedes `sandbox-notes.md` ("wrap each spawned shell process") and its
choice of `@anthropic-ai/sandbox-runtime`. Mechanism findings from
`sandbox-notes.md` Spike 5 are load-bearing and carried forward.

## 1. Purpose

The sandbox makes `enforcement-philosophy.md` §2 true: an out-of-policy
action does not get *denied*, it has *nowhere to go*. The proxy (`05`) is the
only exit; the sandbox is the wall that makes it the only exit. Without the
sandbox the proxy is a suggestion.

## 2. Invariants

| # | Invariant | Source |
| --- | --- | --- |
| S1 | **The unit of confinement is the whole provider process and every descendant.** Not the bash tool. The provider's own HTTP client is a process like any other. | philosophy §4 rule 2 |
| S2 | **Inside:** the provider binary, its built-in tools, team tools, anything they spawn, and on Linux the forwarder. **Outside:** the supervisor, the proxy, every `git` invocation, the broker calls. | architecture §1 |
| S3 | **The jail's only network route is the proxy.** No DNS, no inbound, no other loopback port, no unix socket but the proxy's. | C24, C25 |
| S4 | **A degraded initialisation is a failed boot.** No flag, no fallback, no ask callback, no "running unsandboxed". | I5, G8 |
| S5 | **Probes run under the identical profile before the real spawn. An unexpected success aborts.** | C26 |
| S6 | **`HOME` is inside, verbatim.** Everything under it is reachable unless this document denies it by name. | C27 |
| S7 | **A denied path is denied for both reading and executing.** `file-read*` alone does not stop `execve` of a compiled binary on macOS. | Spike 5, C11 |
| S8 | **Nothing here is configurable.** The three keys that opened a second way out in the runtime are constants in code. | D21, G9 |
| S9 | **A control ships only with a choke point we own** (C4). Nothing here is advisory; what this document cannot enforce (the keychain, §6.1) is stated as open, never listed as a control. | C4 |

## 3. Contracts used

From `00 §4` by name, never redeclared: `SpawnPlan` (`filesystem.allowWrite`,
`filesystem.denyRead`, `filesystem.denyWrite`, `env`, `argv`), `Enforcer`,
`Blocker`, `ProbeRunner`, `Adapter.denyWrite`, `Adapter.ambientStores`.

The module's one export beyond the enforcer:

```ts
/** Wraps argv so that exec'ing the result runs it inside the jail. Pure: reads plan and session, writes nothing. */
function confine(
  plan: SpawnPlan,
  argv: string[],
  session: { dir: string; proxyPort: number },
): { command: string; args: string[] };
```

`session.dir` is `<sessionDir>`; `session.proxyPort` is the port the proxy
listens on (macOS) or the port the forwarder listens on inside the namespace
(Linux). Both are already encoded in `plan.env.HTTP_PROXY`; they are passed
explicitly so `confine` never parses a URL. `08` calls `confine` once for the
probes and once for the real spawn, with the same arguments.

## 4. Module layout

```
engine/cli/src/sandbox/
  geometry.ts     the `filesystem` Enforcer: computes plan.filesystem from composed + choices     ~80
  confine.ts      confine(): platform dispatch, realpath, blockers for a missing mechanism         ~30
  darwin.ts       the Seatbelt profile template and its substitution                               ~80
  linux.ts        the bwrap argv builder and the user-namespace check                              ~110
  forwarder.js    plain JS, ≤40 lines, ships as a file; runs inside the jail on Linux              ~40
  probes.ts       the six probes, run through confine()                                            ~100
engine/cli/probe/
  darwin-arm64  darwin-x64  linux-x64  linux-arm64   prebuilt static "exit 0" binaries (§8.2)
  SHA256SUMS
```

Ceiling 450 source lines for the directory. `geometry.ts` is the enforcer
that replaces `enforcers/filesystem.ts` and `deniedToolDirs`; both leave with
it (`00 §6`).

## 5. What is confined

| | Inside the jail | Outside |
| --- | --- | --- |
| Processes | provider binary; its built-in tools; every team tool's `run`; shells, interpreters, compilers it spawns; **forwarder** (Linux) | `harness` (supervisor); the proxy; every `git`; probes' *runner*, not the probes themselves |
| Holds | nothing: no login token, no credential, no control-plane URL | the login token, session credentials (in memory, in the proxy's connector table), the assets git dir |
| Network | one route: `127.0.0.1:<proxyPort>` (macOS) or `/run/harness/proxy.sock` via the forwarder (Linux) | everything |
| Writes | the geometry in §7 | everything |
| Reads | `HOME` and the system, minus the deny set in §7 | everything |

Native-mode login (`harness auth <provider>`) runs outside — it needs a
browser and a durable store, both of which the jail denies (`07`).

## 6. Profiles

### 6.1 macOS — Seatbelt

Mechanism: `/usr/bin/sandbox-exec -p <profile> <argv…>`. `sandbox-exec` is
deprecated as a public API and is still the only native process-level
mechanism on macOS; Apple's own developer tooling generates profiles for it.
The profile is passed on the command line and exists only in the
supervisor's memory — never a file the agent could read or replace.

**Template.** `‹›` marks substitution; every path is a realpath (§6.3),
escaped (§6.4). Seatbelt applies the **last matching rule**, so order is
meaning.

```scheme
(version 1)
(allow default)

;; ── Network: the proxy is the only route (S3, C24, C25) ─────────────────────
(deny network*)
(allow network-outbound (remote ip "localhost:‹proxyPort›"))
;; network-inbound, network-bind and every unix-domain socket stay denied.
;; DNS is therefore unavailable inside; the proxy resolves names (05 §4).

;; ── Writes: nothing, then the geometry (S2, §7.1) ───────────────────────────
(deny file-write*)
(allow file-write* (subpath "‹allowWrite[i]›"))          ; one line per entry — the workspace, the work tree, the agent dir, the spool, the private tmp, and the harness's `envDir` (D30l)
(allow file-write-data (literal "/dev/null"))
(allow file-write-data (regex #"^/dev/tty"))
(allow file-write* (subpath "/private/var/folders"))     ; see D86: only the session's TMPDIR is set
(deny  file-write* (subpath "‹denyWrite[i]›"))           ; one line per entry, after the allows (C7)

;; ── Reads and execution: the deny set (S7, §7.2) ────────────────────────────
(deny file-read*   (subpath "‹denyRead[i]›"))            ; one line per entry
(deny process-exec (subpath "‹denyRead[i]›"))            ; and the same path again — Spike 5
```

**Why `(allow default)` and not `(deny default)`.** A deny-default profile
must enumerate every framework, dyld cache, `/private/var/db` file and Mach
service a Bun or Node binary touches, and the list changes with each macOS
release. The property we need is not "reads only what we list" — reads are
allow-by-default in every practical sandbox (philosophy §9.3) — it is "cannot
reach *these* things, cannot write *outside these* places, cannot talk to
*anything but* the proxy." Those are three explicit deny families, and each
is probed (§8). This is the same shape `filesystem.ts` ships today, widened
from one family to three.

**What is deliberately not denied, and why.**

| Not denied | Why |
| --- | --- |
| `mach-lookup`, `ipc-posix-*`, `sysctl-read` | denying them breaks the runtime (CFPreferences, `getpwuid`, TTY handling) with no security gain inside a network-less jail |
| `process-fork`, `signal` | the provider spawns tools; that is its job |
| `file-read*` outside the deny set | S6: `HOME` is in; the deny set is the obligation, not a default |
| **Keychain** (`security` framework, `~/Library/Keychains`) | **open, and stated so.** A native Claude Code login on macOS can live in the login keychain (Spike 3, D11). Denying `~/Library/Keychains` by path does not stop `securityd` answering a Mach request. Until Spike 3 closes, native mode on macOS is refused with `adapter.native_blocked` naming Spike 3 (`07 §8`); in org mode the agent has no keychain item worth reading and the proxy is the only route regardless. This is `enforcement-philosophy.md` §9.1 and is printed by `harness preflight sandbox`. |

### 6.2 Linux — Bubblewrap

Mechanism: `bwrap`, invoked directly (D4). Requires unprivileged user
namespaces; checked once per boot (§10 `sandbox.userns_unavailable`) —
there is no privileged fallback and no setuid helper.

**Argv.** Built in this order; **later arguments override earlier ones**, so
the deny binds come after the `HOME` bind and the read-only re-binds come
after the workspace bind.

```
bwrap
  --unshare-all --die-with-parent --new-session
  --clearenv  [--setenv ‹k› ‹v›]…                       ; exactly plan.env, nothing inherited
  --ro-bind /usr /usr  --ro-bind /bin /bin  --ro-bind /sbin /sbin
  --ro-bind /lib /lib  [--ro-bind /lib64 /lib64]        ; if present
  --ro-bind /etc/passwd /etc/passwd  --ro-bind /etc/group /etc/group
  --ro-bind /etc/localtime /etc/localtime  --ro-bind /etc/ssl /etc/ssl
  [--ro-bind /etc/ca-certificates /etc/ca-certificates] ; if present
  --proc /proc  --dev /dev  --tmpfs /tmp  --tmpfs /run
  --ro-bind ‹HOME› ‹HOME›                                ; S6, C27
  [--ro-bind ‹dirname(realpath(providerBinary))› …]      ; only if not already under a bound root
  [--ro-bind ‹dirname(process.execPath)› …]              ; same rule; Node must be reachable for the forwarder and probes
  --bind ‹allowWrite[i]› ‹allowWrite[i]›                 ; one per entry, over the ro HOME
  --tmpfs ‹denyRead[i]›            (directory entries)   ; one per entry — an empty tree where the directory was
  --ro-bind /dev/null ‹denyRead[i]› (file entries)       ; one per entry — reads as empty
  --ro-bind ‹denyWrite[i]› ‹denyWrite[i]›                ; one per entry, after the workspace bind (C7); see D81
  --bind ‹sessionDir›/proxy.sock /run/harness/proxy.sock
  --chdir ‹workspace›
  -- ‹process.execPath› ‹cli›/sandbox/forwarder.js /run/harness/proxy.sock ‹proxyPort› -- ‹argv…›
```

No `--share-net`. No `--resolv.conf`: there is no network to resolve
against. No `/etc/hosts`. `--unshare-all` gives new user, pid, net, ipc,
uts and cgroup namespaces; `net` is the wall, `pid` is why `--die-with-parent`
can be trusted.

**Semantics that differ from macOS, stated once.** A denied *directory* on
Linux is an empty tmpfs: `ls` succeeds and shows nothing, `open` of a child
fails `ENOENT`. A denied *file* is `/dev/null`: `open` succeeds and `read`
returns nothing. On macOS both fail `EPERM`. The property — the content is
unreachable — holds on both; the probes assert the property, not the errno
(§8).

**`denyWrite` is a read-only re-bind of a directory.** `Adapter.denyWrite`
returns directories (the provider's per-workspace settings directory:
`<workspace>/.claude`, `<workspace>/.pi`), not files, because a file the
agent could *create* is as dangerous as one it could edit (a fresh
`disableAllHooks` file is read at the next cold start). If the directory
exists it is re-bound read-only over the writable workspace; if it does not,
a read-only `--tmpfs` is mounted at its path so it cannot be created.
Neither leaves anything on disk after the session. On macOS the same entry
is a `(deny file-write* (subpath …))`, which covers creation without a
mount point.

### 6.3 Real paths

Seatbelt and bwrap both match the path the kernel sees. `/tmp` is
`/private/tmp` on macOS; a home directory may be a symlink on either OS.
Every path in `plan.filesystem` is passed through `realpath` inside
`confine`. A `denyRead` or `denyWrite` entry that no longer exists is
**dropped** — a race between hydration and spawn that can only make the
session safer (`filesystem.ts` already does this). A missing `allowWrite`
entry other than the private tmp is a blocker (`sandbox.geometry_missing`):
the workspace and the session directory must exist before spawn.

### 6.4 Escaping

Seatbelt string literals are double-quoted; `\` and `"` in a path are
escaped as `\\` and `\"` (`escapeProfilePath`, kept as is). bwrap takes
paths as separate argv elements and needs no escaping. Neither path list is
ever interpolated into a shell.

## 7. Geometry

The `filesystem` enforcer (`geometry.ts`) writes `plan.filesystem` from
`Composed`, `Choices`, the adapter and the session. Tighten-only: it only
adds to `denyRead`/`denyWrite` and only lists the fixed `allowWrite` set.

### 7.1 `allowWrite`

| Path | Why |
| --- | --- |
| `<workspace>` | the repository the person is working in |
| `~/.harness/assets` | the work tree; the person's and the agent's edits land here (`01`) |
| `<sessionDir>/agent` | the provider's own state: transcripts, its config dir |
| `<sessionDir>/audit.jsonl` | the attested spool: pre-created `0600` by `08`; the jail appends, it cannot create or replace |
| `<sessionDir>/tmp` | private temporary directory; `plan.env.TMPDIR` points here (`08`) |

**Not writable, by omission or by rule:**

| Path | Mechanism |
| --- | --- |
| `~/.harness/assets.git` | not in `allowWrite`; on Linux under the ro `HOME` bind. An agent that could write it could forge `refs/harness/remote` or plant a hook (`asset-sync.md` §3.1). It is **readable** inside, and that is fine: the login token never enters `assets.git/config` — it travels as `-c http.extraHeader` per git invocation (`00` D24a) — so this write-deny protects ref and hook integrity, and the token's protection is the `~/.config/harness` read-deny in §7.2, not this row |
| `$HARNESS_HOME/harness.json` | the selection (C16) — same |
| `<sessionDir>/preflight.json`, `<sessionDir>/endpoints.jsonl` | the supervisor's records — same |
| `<sessionDir>/proxy.sock` | on Linux it is bind-mounted at `/run/harness/proxy.sock` and the original path is under ro `HOME`; a bind mount cannot be unlinked from inside. On macOS it does not exist (the proxy listens on loopback) |
| `<workspace>/.claude`, `<workspace>/.pi` | `denyWrite` (C7, §6.2) |

### 7.2 `denyRead` — the standing set

Every entry is also a `process-exec` deny on macOS (S7). All are realpaths
under `HOME` unless stated.

```
~/.config/harness            the login token — the one file the whole design exists to keep out
~/.ssh  ~/.aws  ~/.gnupg  ~/.kube  ~/.docker
~/.config/gh  ~/.npmrc  ~/.netrc  ~/.git-credentials
~/.config/anthropic  ~/.claude  ~/.pi          ambient provider stores (C20, G13) — except the
                                               session's own agentDir, which is never under these
~/.harness/agents                              the native-login store (07); in native mode the
                                               seeded copy lives in agentDir, so this stays denied
<sessionDir>/denied                            holds the probe binary (§8.3) and nothing else
+ adapter.ambientStores()                      whatever the chosen adapter adds (07)
+ excluded tool directories                    every ~/.harness/assets/tool/<name> the harness does
                                               not contain, or that a capability boundary excludes (03)
```

The excluded-tool rule is `deniedToolDirs` as it stands today, moved into
the enforcer: computed from what is on disk, so a stale directory hydration
left behind is denied too; a directory that cannot be classified is denied.

**macOS login keychains** are not in this set because a path deny does not
reach them (§6.1). Said here so nobody adds `~/Library/Keychains` and
believes it did something.

### 7.3 Environment

`plan.env` is the whole environment. On Linux `--clearenv` then one
`--setenv` per key; on macOS `spawn(..., { env: plan.env })` with nothing
merged. `08` owns the core set; this document only requires that `TMPDIR`
is `<sessionDir>/tmp` and that `HTTP_PROXY`/`HTTPS_PROXY` name the port in
`session.proxyPort` with `NO_PROXY` empty.

## 8. Probes

Run by `preflight()` (03 §5.9) through 08's `spawnConfined`, after the
proxy is up (`00 §3` row 8) and before the real spawn (row 9; the provider
binary was already located at Choose, row 4, so its path is known here),
each through `confine(plan, probeArgv, session)` — **the identical wrapper,
the identical profile.** Each probe is `process.execPath -e '<one line>'` so Node must be
reachable inside (it is: `/usr` or the explicit ro-bind). On Linux the probe
argv therefore runs through the forwarder too, exactly as the provider will.
Each has a 5 s timeout; the six together take under two seconds.

Probes 1–5 **must fail**. Probe 6 **must succeed**. Any other outcome ends
the boot with the blocker named.

| # | Probe | Asserts | Unexpected outcome → |
| --- | --- | --- | --- |
| 1 | `net.connect(443, "1.1.1.1")` — an IP literal, so no DNS is involved | error: `ENETUNREACH`/`EHOSTUNREACH` (Linux), `EPERM` (macOS) | `sandbox.probe_unexpected_success` (`network`) |
| 2 | `fs.readFileSync("~/.config/harness/credentials.json")` and `fs.readdirSync("<sessionDir>/denied")` | error, or (Linux) empty | `sandbox.probe_unexpected_success` (`read`) |
| 3 | `child_process.execFileSync("<sessionDir>/denied/probe")` — the **compiled** binary | exec refused (macOS `EPERM` exit 71; Linux `ENOENT` since the tmpfs is empty) | `sandbox.probe_unexpected_success` (`exec`) — the Spike 5 case |
| 4 | `fs.writeFileSync("~/.harness/assets.git/PROBE")` and `fs.writeFileSync("<workspace>/.claude/PROBE")` | `EPERM`/`EROFS` | `sandbox.probe_unexpected_success` (`write`) |
| 5 | `net.createServer().listen(0, "127.0.0.1")` | error (macOS `EPERM`); on Linux the listener binds inside the private namespace and is unreachable from outside — the probe instead asserts that a second listen on `session.proxyPort` fails `EADDRINUSE` (the forwarder holds it) | `sandbox.probe_unexpected_success` (`bind`) |
| 6 | `net.connect(session.proxyPort, "127.0.0.1")` | connects | `sandbox.proxy_unreachable` |

### 8.1 Why probe 3 needs a compiled binary

`sandbox-notes.md` Spike 5, measured on macOS 15.3: `deny file-read*` stops
`./run` (the kernel reads the shebang) and `/bin/sh run` (the interpreter
reads it) but **does not stop `execve` of a Mach-O binary** — that is a
separate operation, `process-exec`. A probe that runs a script proves the
wrong thing. Copying a system binary such as `/bin/echo` into the denied
directory is a confound: macOS's trust cache `SIGKILL`s it before the sandbox
is consulted. So the probe binary is ours.

### 8.2 Probe binary provenance

`engine/cli/probe/<platform>-<arch>` is a statically linked program whose
entire behaviour is `exit 0`: assembly or C with no libc on Linux (under 1 KiB
with `-nostdlib`), a minimal Mach-O ad-hoc signed on macOS. Built in CI,
checksummed into `SHA256SUMS`, both committed. At boot `08` copies the one
matching `process.platform`/`process.arch` into `<sessionDir>/denied/probe`
after verifying its checksum (`sandbox.probe_binary_checksum` on mismatch,
`sandbox.probe_binary_missing` on an unsupported pair). It never runs
outside the jail.

### 8.3 What the probes do not prove

That a *future* write outlives the session (philosophy §9.4); that a hostile
user cannot run the provider unwrapped (§9.1); that the keychain is closed
(§6.1). Each is stated where it applies and none is claimed.

## 9. The forwarder (Linux)

Inside a fresh network namespace the only interface is `lo`, and a proxy
outside the namespace is unreachable by TCP. The proxy therefore listens on
a unix socket, `<sessionDir>/proxy.sock`, which bwrap binds to
`/run/harness/proxy.sock` inside. Most HTTP clients cannot use a unix-socket
proxy, so a forwarder inside the jail listens on `127.0.0.1:<proxyPort>` and
pipes each accepted connection to the socket.

```js
// engine/cli/src/sandbox/forwarder.js — runs INSIDE the jail on Linux. Holds nothing.
// argv: <socketPath> <port> -- <command…>
const net = require("node:net"), { spawn } = require("node:child_process");
const [sock, port, dash, ...argv] = process.argv.slice(2);
if (dash !== "--" || !argv.length) { process.stderr.write("forwarder: bad argv\n"); process.exit(64); }
const server = net.createServer((client) => {
  const upstream = net.connect(sock);
  client.pipe(upstream).pipe(client);
  const drop = () => { client.destroy(); upstream.destroy(); };
  client.on("error", drop); upstream.on("error", drop);
});
server.listen(Number(port), "127.0.0.1", () => {
  const child = spawn(argv[0], argv.slice(1), { stdio: "inherit" });
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
});
```

It supervises nothing: it starts the provider with inherited stdio and exits
with the provider's code. It is the process bwrap's `--die-with-parent`
attaches to, and the provider is its child in the same pid namespace, so
when the supervisor dies, both go.

**Why this is not a second way out.** It connects only to a path fixed at
spawn, and that path is bind-mounted to a socket the supervisor created and
the proxy owns. An agent that connected to `/run/harness/proxy.sock` directly
would reach the same proxy under the same policy. The forwarder adds
convenience for `HTTP_PROXY` clients and no reach.

**Why Node.** It is already inside (the probes need it, Pi is a Node bundle)
and the alternative is a `socat` dependency, which D4 excludes.

## 9a. Windows

Windows is where many of the product's buyers work, so "not supported" is
a product gap, not a platform footnote. It is not an impossibility either:
Windows has native confinement primitives; nobody has built this jail on
them yet. Three paths, in the order they are pursued. Whatever ships, the
claim on the box is exactly what holds (C4).

| Path | What it is | Holds | Cost | When |
| --- | --- | --- | --- | --- |
| **W1 · WSL2** | the Linux jail (§4) unchanged inside a WSL2 distribution: `harness`, `bwrap`, the provider binary and the forwarder all run in the distro; the person's Windows terminal attaches to it; the workspace is a path under the distro or `/mnt/c/…` | everything the Linux jail holds — the namespace, the socket-only exit, the probes | packaging and an installer (`harness setup windows` installs the distro, `bwrap`, Node and the CLI; checks `wsl --status`); documentation; `/mnt/c` I/O is slower and Windows-side tools cannot see the jail | **spike at M4**, ships M5 as *Windows via WSL2*, with that said plainly |
| **W2 · native AppContainer** | the provider spawned with an AppContainer token (`CreateProcess` + `STARTUPINFOEX` with `SECURITY_CAPABILITIES`): low-integrity, capability-gated, **no network unless the `internetClient` capability is granted — it is not**; loopback to the proxy allowed via a per-session loopback exemption; filesystem reach by ACLs on the AppContainer SID (allowWrite = explicit ACEs, denyRead = absence); probes unchanged in meaning | the same three properties, natively; no WSL dependency; the Windows user's own files and tools | a Windows-specific `confine()` (~300 lines of `koffi`-free `node:`-only code is *not* possible — this needs a small native helper or PowerShell shim, which is a dependency decision) and Windows CI; the least-known of the three | **spike at M6**; ships when the probes pass on a Windows runner |
| **W3 · unfenced, by explicit organization decision** | no jail; the proxy still holds the credentials (I3 holds; the key is never in the environment); egress is not restricted and every session says so | credentials only — *the agent reaches only what it was granted* is **not** claimed | none — it is the M3 state, labelled | never silently; only as an org-level approval an org admin turns on with the sentence *Windows sessions run without a fence* shown on every such session and in the console's provider row. **Not a flag on the CLI** (10 rule 3); a policy commit on the org branch |

W1 is the answer for the first Windows customer; W2 is the right answer;
W3 exists so an organization can choose credentials-only over nothing, with
its eyes open. `sandbox.unsupported_platform` names all three.

## 10. Failure modes

Every row is a `Blocker`. `code` is unique across the engine; `message` is
what the person sees; `remedy` is always present.

| Code | Message | Remedy |
| --- | --- | --- |
| `sandbox.unsupported_platform` | The harness confines the agent with a sandbox, and there is no native sandbox for Windows yet. It will not start a session it cannot confine. | Run it inside WSL2 (`harness setup windows` installs what is needed, §9a W1), or on macOS or Linux. If your organization has approved unfenced Windows sessions, `harness preflight` will say so instead of this. |
| `sandbox.sandbox_exec_missing` | `/usr/bin/sandbox-exec` is not present on this Mac, so the harness cannot confine the agent. | This binary ships with macOS; check for a managed configuration that removed it. |
| `sandbox.bwrap_missing` | `bwrap` (Bubblewrap) is not installed, and the harness cannot confine the agent without it. | Install it: `apt install bubblewrap` or `dnf install bubblewrap`. |
| `sandbox.userns_unavailable` | Linux user namespaces are disabled on this machine (`kernel.unprivileged_userns_clone=0` or `user.max_user_namespaces=0`). The harness cannot confine the agent and will not start it. | Ask your administrator to enable them, or run on another machine. |
| `sandbox.geometry_missing` | The directory `‹path›` must exist before a session starts, and it does not. | `mkdir -p ‹path›`, or run from inside a repository. |
| `sandbox.probe_binary_missing` | No sandbox probe binary is built for `‹platform›-‹arch›`, so the harness cannot prove the sandbox holds here. | This platform is not yet supported; see `docs/engine/06-sandbox.md` §8.2. |
| `sandbox.probe_binary_checksum` | The sandbox probe binary for `‹platform›-‹arch›` does not match its recorded checksum. The harness will not run an unverified binary. | Reinstall the harness CLI. |
| `sandbox.probe_unexpected_success` | The sandbox self-test for `‹network\|read\|exec\|write\|bind›` succeeded when it should have been refused. The jail does not hold on this machine, so no session will start. | Run `harness preflight sandbox` and send its output to your administrator. Nothing you can change will make this session safe. |
| `sandbox.proxy_unreachable` | The agent cannot reach the harness proxy from inside the sandbox, so it would have no network at all. | Run `harness preflight sandbox`. On Linux, check that `‹sessionDir›/proxy.sock` was created. |
| `sandbox.forwarder_failed` | The in-sandbox forwarder exited before the agent started (`‹stderr›`). | Run `harness preflight sandbox`. |
| `sandbox.probe_timeout` | The sandbox self-test `‹name›` did not finish within 5 seconds. | Retry; if it repeats, run `harness preflight sandbox`. |

Not a blocker: a `denyRead`/`denyWrite` path that does not exist (dropped,
§6.3).

## 11. Tests

All **T3** (a spawned child on this OS) unless marked; each runs on both CI
runners and is skipped, never faked, where the platform lacks the mechanism.

| Name | Asserts |
| --- | --- |
| `denied_host_has_no_route` | probe 1 fails with the platform's errno; a control run outside `confine` connects |
| `denied_path_unreadable` | every path in a fixture `denyRead` is unreadable inside (macOS: `EPERM`; Linux: empty), readable outside |
| `compiled_binary_in_denied_dir_does_not_exec` | the shipped probe binary in `<sessionDir>/denied` will not exec inside; **the same binary execs outside**; a *script* in the same place is also refused |
| `write_outside_geometry_fails` | writes to `assets.git`, the selection file, `preflight.json`, `<workspace>/.claude/x` fail; a write to each `allowWrite` entry succeeds |
| `listener_bind_refused` | probe 5's platform-specific assertion |
| `proxy_reachable_from_inside` | probe 6 connects; a request through it with the session secret is answered by a stub proxy |
| `unexpected_success_aborts_boot` | with `denyRead` deliberately emptied, `08`'s boot ends with `sandbox.probe_unexpected_success` and no provider process was spawned (assert by pid) |
| `deny_write_settings_file_holds` | creating and editing `<workspace>/.claude/settings.json` fails inside whether or not `.claude/` existed before; nothing is left on disk after (Linux) |
| `forwarder_only_reaches_socket` | (Linux) inside the jail, `connect` to any loopback port other than `proxyPort` fails; `connect` to `proxyPort` reaches the stub on the socket |
| `windows_refuses_plainly` | **T1**: `confine` on `win32` returns `sandbox.unsupported_platform` with the exact message; no child is spawned |
| `profile_is_deterministic` | **T1**: `darwin.ts`/`linux.ts` over a fixture plan produce byte-identical output on repeated calls, and every `denyRead` entry appears in both `file-read*` and `process-exec` lines (macOS) |
| `realpath_applied` | **T2**: a symlinked `HOME` and `/tmp` produce profiles naming the resolved paths |
| `env_is_exactly_plan_env` | inside the jail `process.env` equals `plan.env` — nothing inherited, `TMPDIR` inside `<sessionDir>` |

Security properties have negative tests (`10` rule 20): every row above that
asserts a failure also asserts the matching success outside the jail, so a
broken mechanism cannot pass by failing for the wrong reason.

## 12. Decisions

| # | Decision | Why | Reverse by |
| --- | --- | --- | --- |
| D80 | macOS profile is `(allow default)` with three explicit deny families | a deny-default profile enumerates the OS and rots per release; the probed properties are the three families | writing the deny-default profile and its allow list, and maintaining it per macOS version |
| D81 | `denyWrite` entries are **directories**, made read-only in full | a file the agent can *create* is the `disableAllHooks` case; a read-only directory covers create and edit with one mount | per-file binds plus a tmpfs on the parent when absent — more moving parts, same property |
| D82 | On Linux a denied file reads as empty (`/dev/null`) and a denied directory as an empty tmpfs; probes assert content absence, not errno | bwrap has no "deny" primitive; hiding is the mechanism | none needed; the property holds |
| D83 | Ship prebuilt static probe binaries per platform/arch, checksummed | the only way to exercise `process-exec` (Spike 5); system binaries are trust-cache confounds | building at install time — needs a toolchain on the person's machine, which is worse |
| D84 | The forwarder starts the provider and exits with its code | one process bwrap's `--die-with-parent` attaches to; no separate lifecycle inside | running forwarder and provider as siblings under a tiny init — more code for no property |
| D85 | DNS is unavailable inside on both OSes; the proxy resolves | a name resolver is a route; the proxy is the only route (`05` resolves proxy-side, refuses IP literals) | binding a resolver in — a second way out |
| D86 | Private tmp is `<sessionDir>/tmp`, `TMPDIR` set; macOS additionally allows `/private/var/folders` because system frameworks write there regardless of `TMPDIR` | a session that cannot create a temp file does not start; framework writes there are per-user and not policy-bearing | denying `/private/var/folders` and enumerating exceptions per framework |
| D87 | Keychain stays open on macOS. What it exposes is an ambient Claude Code login inside the jail; the risk is an **enterprise org-mode** session using it instead of the org's key. Closed at M4 by no-route (00 D11), not by deny-read; before M4, enterprise org mode on macOS says so on the session. Personal accounts are unaffected — the login is the person's own. | a path deny does not reach `securityd`; saying otherwise would be a claim the code cannot earn | none needed; the fence is the control |
| D88 | Probes run through the **same** `confine` call as the spawn, including the forwarder on Linux | a probe under a different wrapper proves a different jail | none |

## 13. Enforced and intercepted — where the line is

`prd-v2` §7 gives a boundary one of two words, and this is what each means
in terms of this document's geometry.

**`enforced`** is a boundary this layer holds, and it holds whether or not
anything cooperates: there is no route (an endpoint boundary, through the
proxy and the tunnel, `05`), the file is not readable or not writable (a
filesystem boundary, through `confine()`'s deny sets, §7), or the binary is
not on the agent's path at all. The agent cannot try and fail; it cannot
try. Nothing it is told matters, which is why §7's geometry is the control
and 07's `permissions.deny` file denies are only the sentence beside it.

**`intercepted`** is a boundary the **runtime** holds, at the moment the call
is made, because nothing outside the runtime can see it coming. A command
line is the whole of that category: it exists for an instant, inside the
agent's own tool call, before any process this layer could fence has been
created. `rm -rf /` is not a file to deny and not a host to refuse — it is an
argument string, and the only thing that reads it before the kernel does is
the program that was about to run it.

So a boundary of kind `command` is `intercepted`, always, and the two
runtimes hold it in the two places they can (07 §6, §8.1, W6-D9): Pi's
harness extension refuses the `bash` tool call in `tool_call`, and Claude
Code refuses it with a `permissions.deny` rule in the session's settings.
Both read the same pattern, compiled once by `@harness/compose`.

**What that costs, said plainly.** Interception is weaker than enforcement
and the product does not pretend otherwise:

- It holds against the thing attempted **directly**, not the same thing
  written another way. `rm -rf /*` does not catch a shell script that does
  it, a Python `shutil.rmtree`, or `$(echo rm) -rf /`. The scale's own
  sentence in `sentences.py` has said this since it was registered.
- It depends on the runtime honouring its own configuration. The jail does
  not: that is the difference, and it is why the filesystem a command would
  destroy is *also* fenced wherever it matters.
- A pattern only one runtime can hold is shown as held by that runtime
  alone, never as both (07 §8.1 rule 4). The console row says which.

A command boundary is therefore a **guardrail against the accident**, which
is what almost every one of them is for, and never the thing standing between
an adversary and the disk. That is still §7.

## 14. Out of scope

- **A shim ahead of the real binary** — interception below the runtime, so a
  command boundary holds for a process the agent spawned rather than for the
  tool call it made. W6-D9 put interception in the two runtimes, which is
  where the command line is legible; a shim is the next step and is not this
  wave's.
- **seccomp** filters, per-session OS users, cgroup limits: not needed for
  any property this plan claims.
- **Windows**: refused plainly (§10). A WSL2 path is a later decision.
- **Isolation between concurrent sessions of one OS user** beyond the profile
  (philosophy §9.8).
- **Persisting the profile** for audit: `preflight.json` records the plan
  the profile was generated from, which is sufficient and smaller.

## 15. Definition of done

- [ ] `confine()` wraps argv on macOS and Linux from `plan.filesystem` alone; `enforcers/filesystem.ts` and `deniedToolDirs` are deleted with their tests.
- [ ] The six probes run before every spawn through the same `confine` call, and `unexpected_success_aborts_boot` passes on both OSes.
- [ ] Every test in §11 exists by name and passes in CI on **both** a macOS arm64 runner and a Linux x64 runner; neither is optional and a skip on either is a CI failure.
- [ ] The four probe binaries and `SHA256SUMS` are built by CI and committed; the checksum check refuses a tampered binary (`sandbox.probe_binary_checksum` has a test).
- [ ] `harness preflight sandbox` prints, for this machine: mechanism, user-namespace availability (Linux), the resolved geometry, each probe's result, and the keychain limit on macOS (§6.1) — probed answers, never static ones (C3).
- [ ] `HARNESS_REDACTIONS` and the Pi extension's transcript redaction are gone (`00 §6`): no value exists inside to redact.
- [ ] The directory is under 450 source lines, or the PR says why.
- [ ] Every string in §10 appears verbatim in the code and nowhere else.
