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
