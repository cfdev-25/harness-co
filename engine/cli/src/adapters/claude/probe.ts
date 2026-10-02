import type { Blocker, ProbeRunner, RenderContext } from "@harness/compose/contracts";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Under the exact session profile (C26). It never sends a model request
 * (D93): the fence guarantees a request goes to the proxy or nowhere, and
 * `rehydrate` has already proved the config points there.
 */
export async function probe(ctx: RenderContext, run: ProbeRunner): Promise<void> {
	const located = ctx.choices.located;
	const version = await run([located.path, "--version"]);
	if (!version.stdout.includes(located.version)) {
		throw {
			code: "adapter.probe_version",
			message: `Claude Code ${version.stdout.trim() || "(no version)"} started, but ${located.version} was checked.`,
			remedy: "Re-run the command.",
		} satisfies Blocker;
	}
	for (const store of [join(homedir(), ".claude"), join(homedir(), ".config", "anthropic")]) {
		// An unexpected success is a failure (I5).
		if ((await run(["/bin/cat", store])).code === 0) {
			throw {
				code: "adapter.probe_ambient",
				message: `\`${store}\` is readable inside the session.`,
				remedy: "This is a sandbox defect; report it.",
			} satisfies Blocker;
		}
	}
	// With the proxy secret stripped: nothing else may answer for a login.
	// What this call reports *with* the token set was never measured, so the
	// plan does not assert it.
	const status = await run(["/usr/bin/env", "-u", "ANTHROPIC_AUTH_TOKEN", located.path, "auth", "status", "--json"]);
	if (/"loggedIn"\s*:\s*true/.test(status.stdout)) {
		throw {
			code: "adapter.probe_login",
			message: "Claude Code found a sign-in the harness did not provide.",
			remedy: "This is a sandbox defect; report it.",
		} satisfies Blocker;
	}
	// D144: the settings file is validated, and one bad key loses the whole
	// file — silently to us, and behind a three-option dialog to the person.
	// `doctor` is the cheapest thing that reports it: ~1 s, no sign-in, no
	// model request (D93), and it prints the offending key by name. The token
	// is stripped as above so its managed-settings step has no credential to
	// try. Only `settings.json` under `agentDir` counts: `doctor` also reads
	// the current directory's project settings, which `--setting-sources user`
	// never loads, and refusing a session over a file it ignores would be a
	// lie.
	const doctor = await run(["/usr/bin/env", "-u", "ANTHROPIC_AUTH_TOKEN", located.path, "doctor"]);
	const rejected = settingsRejected(`${doctor.stdout}\n${doctor.stderr}`, join(ctx.agentDir, "settings.json"));
	if (rejected !== null) {
		throw {
			code: "preflight.settings_rejected",
			message: `Claude Code ${located.version} rejects the generated settings file, so it would load none of it: ${rejected}`,
			remedy: "The deny list, the audit hooks and `claudeMdExcludes` all ride on that one file. This is a bug in the Claude Code adapter; report it with `harness preflight --json`.",
		} satisfies Blocker;
	}
}

/**
 * `claude doctor`'s *Invalid settings* block, narrowed to one file. Each
 * finding is one `- <file> › <key>: <sentence>` line, with an indented
 * *Suggested fix* under it; this returns the first line that names `file`,
 * without the bullet, and `null` when the block says nothing about it.
 * A pure function so the parse is tested without a subprocess.
 */
export function settingsRejected(output: string, file: string): string | null {
	for (const line of output.split("\n")) {
		const one = line.trim();
		if (!one.startsWith("- ") || !one.includes(file)) continue;
		return one.slice(2).trim();
	}
	return null;
}
