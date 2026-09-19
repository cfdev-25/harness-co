import { realpathSync } from "node:fs";
import { platform } from "node:process";

/**
 * agents.md §7.1.1: a team tool the selected harness excludes, or that
 * `tool.<name>` does not permit, must stop existing for the session — not
 * merely go unlisted in an advisory allowlist. This is that enforcement,
 * applied at the one place `index.ts`'s `run()` actually creates the child
 * process, which is what makes it agent-agnostic: it wraps argv after
 * `adapter.launch()` has already built it, so neither Pi nor Claude Code (nor
 * whatever runs after them) can be the reason it does or doesn't apply.
 *
 * There is no `SpawnPlan`/enforcer registry here on purpose (agents.md §14.1's
 * note: that abstraction is Phase 4, and one implementation with one caller
 * would just be a `SpawnPlan` with extra steps). This is called directly by
 * `run()`.
 *
 * Spike 5 (docs/sandbox-notes.md) found the obvious version of this claim —
 * "deny file-read* on the path, since exec has to read the binary first" —
 * false for a compiled binary on macOS 15.3: `execve` of one is gated by a
 * separate Seatbelt operation, `process-exec`, which `file-read*` does not
 * cover. `file-read*` alone *is* sufficient for a script with a shebang
 * (the interpreter has to read it), but a team tool's `run` file is not
 * guaranteed to be one, so both operations are denied together, verified
 * against all four access modes the spike checked (`cat`, direct exec, exec
 * via `/bin/sh`, and a compiled binary).
 */
export function denyReadArgv(argv: readonly string[], denyRead: readonly string[]): string[] {
	if (denyRead.length === 0) return [...argv];
	if (platform !== "darwin") {
		// No unsandboxed fallback (docs/sandbox-notes.md's own Phase 2 rule):
		// a boundary this session cannot actually enforce must refuse to
		// start, not start anyway and silently leave the excluded tool
		// reachable. Linux bind-mount exclusion is believed sound
		// (agents.md §13, spike 5's note) but was not verified here — this
		// environment cannot run it — so it is not shipped as a claim.
		throw new Error(
			"This session's harness excludes a tool your account can otherwise see. Read-deny enforcement " +
				`is only implemented on macOS today (this host reports "${platform}"). Refusing to start rather ` +
				"than run without the boundary it depends on.",
		);
	}
	// Seatbelt matches real paths: `/tmp` resolves to `/private/tmp` on macOS,
	// so a profile written against the given path could silently fail to
	// match (docs/sandbox-notes.md, Spike 5's setup note). A path that no
	// longer exists by the time we get here (removed between hydration and
	// spawn) has nothing to resolve and is dropped rather than crashing the
	// launch over a race that only ever makes the session *safer*.
	const resolved = denyRead.flatMap((path) => {
		try {
			return [realpathSync(path)];
		} catch {
			return [];
		}
	});
	if (resolved.length === 0) return [...argv];
	const profile = [
		"(version 1)",
		"(allow default)",
		...resolved.map((path) => `(deny file-read* (subpath "${escapeProfilePath(path)}"))`),
		...resolved.map((path) => `(deny process-exec (subpath "${escapeProfilePath(path)}"))`),
	].join("\n");
	return ["/usr/bin/sandbox-exec", "-p", profile, ...argv];
}

/** Escapes a path for embedding inside a double-quoted Seatbelt string
    literal — `~/.harness` paths live under `$HOME`, which on this machine
    could contain either character. */
function escapeProfilePath(path: string): string {
	return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
