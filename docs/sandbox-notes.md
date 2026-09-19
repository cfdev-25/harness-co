# Sandbox Evaluation

## Decision

Use `@anthropic-ai/sandbox-runtime` as the Phase 2 integration layer, replacing
Pi's built-in `bash` tool with a sandboxed implementation and handling
`user_bash` with the same operations wrapper. It already selects the native
mechanism by host OS: Seatbelt (`sandbox-exec`) on macOS and Bubblewrap on
Linux. Keep the Harness policy as the only source of configuration; do not load
project-local `.pi/sandbox.json`.

Initialization must fail closed. If the requested sandbox cannot initialize,
shell tools remain unavailable rather than silently running unsandboxed.

## `@anthropic-ai/sandbox-runtime`

- Filesystem: supports denied read paths, allowed write paths, and denied write
  patterns. The working directory and a private temporary directory can be the
  only writable locations.
- Network: supports domain allowlists and denylists through a managed proxy.
- Operating systems: macOS and Linux. Windows is unsupported and must fail
  closed until a native or VM-backed implementation exists.
- Integration: Pi's vendored sandbox example proves both required hooks:
  `createBashTool(..., {operations})` wraps model-issued shell calls, while the
  `user_bash` event wraps direct `!`/`!!` commands.
- Risk: this library is an orchestration layer, not a kernel boundary itself.
  Security properties still depend on the selected native mechanism and its
  installed helpers.

## macOS Seatbelt (`sandbox-exec`)

- Filesystem: mature deny/allow profiles can limit reads and writes.
- Network: profiles can deny all networking, but hostname-level allowlisting
  requires a proxy because Seatbelt rules operate below DNS names.
- Operating systems: macOS only; `sandbox-exec` is deprecated as a public API,
  though still present. Treat it as a supported adapter, not our direct public
  abstraction.
- Integration: wrap each spawned shell process, not the whole Harness process;
  the Harness still needs backend and model-provider access.

## Linux Bubblewrap

- Filesystem: strongest of the evaluated options. Mount namespaces can expose
  the working directory read/write, selected system paths read-only, and hide
  everything else.
- Network: `--unshare-net` provides a hard deny. Domain allowlisting requires a
  proxy/socket explicitly mounted into the namespace.
- Operating systems: Linux only; requires `bwrap`, user namespaces, and the
  helper stack used by sandbox-runtime (`socat`, `ripgrep`).
- Integration: wrap each shell process through the shared sandbox-runtime
  operations adapter.

## Spike 5: does `deny file-read*` actually stop execution on macOS?

`agents.md` §7.1.1 and §13 raise the doubt directly: the generated Seatbelt
profile carries `allow process*` (`macos-sandbox-utils.js:227`), so execution
is not denied by name — the claim was that denying *read* is enough, because
exec has to read the binary first. Verified empirically rather than assumed,
on macOS 15.3 (Darwin 24.3.0, arm64), `sandbox-exec` at `/usr/bin/sandbox-exec`.

**The claim is half true.** It holds for a script with a shebang. It does
**not** hold for a compiled Mach-O binary — `execve` of one is a distinct
Seatbelt operation, `process-exec`, and `deny file-read*` does not gate it.
A team tool's `run` file can be either (`hydrate.ts` only `chmod`s it
executable; nothing constrains its format), so the read-only claim is not
safe to ship as-is.

**Setup.** `/private/tmp/spike5-test/` (its realpath — macOS resolves `/tmp` to
`/private/tmp`, and a profile written against the symlinked path would not
match), containing `run` (a `#!/bin/sh` script) and `bin/hello` (a locally
compiled, ad-hoc-signed Mach-O binary — a copied *system* binary like `/bin/echo`
gets `SIGKILL`ed by macOS's own trust-cache/library-validation before the
sandbox is even consulted, which is a confound, not a sandbox result, and is
excluded from the findings below).

Control profile:
```
(version 1)
(allow default)
```
Deny profile (read only):
```
(version 1)
(allow default)
(deny file-read* (subpath "/private/tmp/spike5-test"))
```

| Access mode | Control | `deny file-read*` only |
| --- | --- | --- |
| `cat run` | prints script, exit 0 | `Operation not permitted`, exit 1 |
| `./run` (kernel reads the `#!` shebang) | runs, exit 0 | `Operation not permitted`, exit 126 |
| `/bin/sh run` (interpreter reads the script) | runs, exit 0 | `Operation not permitted`, exit 126 |
| `./bin/hello` (compiled binary, direct exec) | runs, exit 0 | **runs, exit 0 — not blocked** |
| `cat bin/hello` | prints bytes, exit 0 | `Operation not permitted`, exit 1 |

The binary's *bytes* are unreadable (`cat` is denied) but `execve` of the same
path succeeds anyway. Adding `(deny file-map-executable (subpath ...))`
alongside the read deny made no difference — still ran, no error, no stderr.
What actually stops it is a third, separate operation:

```
(deny process-exec (subpath "/private/tmp/spike5-test"))
```
This alone blocks `./bin/hello` (`execvp() ... Operation not permitted`, exit
71) — but *only* execution: `cat run` still succeeds under a `process-exec`-only
deny, since reading is a different operation from executing.

**Combined profile, the one to actually ship:**
```
(version 1)
(allow default)
(deny file-read* (subpath "<realpath>"))
(deny process-exec (subpath "<realpath>"))
```
Verified against all four access modes on the same paths: `cat run` denied,
`./run` denied, `/bin/sh run` denied, `./bin/hello` denied — all exit non-zero
with `Operation not permitted`. `ls` of the denied directory is also denied
(metadata read is under `file-read*`), so the directory does not merely fail
to run, it stops appearing to exist. A control run against a path *outside*
the denied subpath (`/bin/echo`) still succeeds under the same profile, so
the deny is scoped, not global.

**Conclusion.** §7.1.1's mechanism is real but was mis-specified: on this
macOS version, "a binary that cannot be read cannot be executed" is false for
compiled binaries. The correct, verified rule is **"a path denied both
`file-read*` and `process-exec` cannot be read or executed."** The
implementation (`pi/packages/harness-cli/src/enforcers/filesystem.ts`) denies
both operations together for every path in the deny set, not read alone.

**Honest limits.** Only tested on macOS 15.3 arm64 with `sandbox-exec`
(deprecated as a public API, per this file's own note above, but still the
only native mechanism available). Not tested against a hardened runtime
process, a codesigned+notarized `run` binary, or Rosetta-translated x86_64.
Linux bind-mount exclusion (`bwrap`) is unaffected by this finding — a path
never bound into the mount namespace has no separate "can't read but can
exec" failure mode, since there is no path to resolve at all — but it was not
re-verified here; this spike is macOS-only.

## Phase 2 acceptance criteria

1. A shell command can write inside the granted working directory.
2. Reads of `~/.ssh`, `~/.aws`, Harness credentials, and process-environment
   files are denied.
3. Writes outside the working directory and private temp directory are denied.
4. Network is denied by default; only domains in the resolved
   `egress_allowlist` are reachable.
5. Model tool calls and direct user shell commands receive identical controls.
6. Initialization failure disables shell execution and emits an authoritative
   diagnostic; there is no unsandboxed fallback.
7. macOS and Linux behavior is covered by platform CI; Windows reports the
   unsupported guarantee plainly.
