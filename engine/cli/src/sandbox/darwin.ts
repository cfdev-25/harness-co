import { existsSync } from "node:fs";
import type { Blocker } from "@harness/compose/contracts";
import type { Geometry } from "./confine.js";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/**
 * The macOS jail: a Seatbelt profile passed on the command line, so it lives
 * only in the supervisor's memory and is never a file the agent could read or
 * replace (06 §6.1). `(allow default)` with three explicit deny families —
 * network, writes, reads-and-execution — is D80; each family is probed (§8).
 */
export function confineDarwin(
	geometry: Geometry,
	argv: string[],
	proxyPort: number,
): { command: string; args: string[] } {
	if (!existsSync(SANDBOX_EXEC)) {
		throw {
			code: "sandbox.sandbox_exec_missing",
			message: "/usr/bin/sandbox-exec is not present on this Mac, so the harness cannot confine the agent.",
			remedy: "This binary ships with macOS; check for a managed configuration that removed it.",
		} satisfies Blocker;
	}
	return { command: SANDBOX_EXEC, args: ["-p", profile(geometry, proxyPort), ...argv] };
}

/** The §6.1 template, in its order: Seatbelt applies the last matching rule, so
    every deny that must win is written after the allows it overrides. */
function profile(geometry: Geometry, proxyPort: number): string {
	return [
		"(version 1)",
		"(allow default)",
		";; Network: the proxy is the only route (S3, C24, C25)",
		"(deny network*)",
		`(allow network-outbound (remote ip "localhost:${proxyPort}"))`,
		";; network-inbound, network-bind and every unix-domain socket stay denied.",
		";; DNS is therefore unavailable inside; the proxy resolves names (05 §4).",
		";; Writes: nothing, then the geometry (S2, §7.1)",
		"(deny file-write*)",
		...geometry.allowWrite.map((path) => `(allow file-write* (subpath "${escapeProfilePath(path)}"))`),
		'(allow file-write-data (literal "/dev/null"))',
		'(allow file-write-data (regex #"^/dev/tty"))',
		";; D86: system frameworks write here whatever TMPDIR says",
		'(allow file-write* (subpath "/private/var/folders"))',
		...geometry.denyWrite.map((path) => `(deny file-write* (subpath "${escapeProfilePath(path)}"))`),
		";; Reads and execution: the deny set (S7, §7.2)",
		...geometry.denyRead.map((path) => `(deny file-read* (subpath "${escapeProfilePath(path)}"))`),
		// Spike 5: `deny file-read*` does not stop `execve` of a Mach-O binary.
		// `process-exec` is a separate operation and every denied path gets both.
		...geometry.denyRead.map((path) => `(deny process-exec (subpath "${escapeProfilePath(path)}"))`),
	].join("\n");
}

/** Escapes a path for embedding inside a double-quoted Seatbelt string literal
    (§6.4); kept as it stands in `enforcers/filesystem.ts`. */
function escapeProfilePath(path: string): string {
	return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
