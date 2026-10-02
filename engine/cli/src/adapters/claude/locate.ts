import { accessSync, constants, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { Blocker, HarnessProvider, Located } from "@harness/compose/contracts";

const run = promisify(execFile);

/** C21 — the customer's own managed tier. Harness policy sits below it and
    never fights it: a machine whose device admin forced a login method
    cannot run an organization model, and says so by name. */
const MANAGED = {
	darwin: "/Library/Application Support/ClaudeCode/managed-settings.json",
	linux: "/etc/claude-code/managed-settings.json",
} as const;

export function managedTier(): Blocker | null {
	const path = MANAGED[process.platform as keyof typeof MANAGED];
	if (!path) return null;
	let settings: Record<string, unknown>;
	try {
		settings = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return null; // Absent or unreadable: there is no managed tier to obey.
	}
	for (const key of ["forceLoginOrgUUID", "forceLoginMethod"]) {
		if (!(key in settings)) continue;
		return {
			code: "adapter.managed_tier",
			message: `This machine's managed Claude Code settings set \`${key}\`, so an organization model cannot be used here.`,
			remedy: "Ask the device admin, or run `harness run pi`.",
		};
	}
	return null;
}

/** The first executable `claude` on `PATH`. */
export function claudeOnPath(): string | null {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		try {
			accessSync(join(dir, "claude"), constants.X_OK);
			return join(dir, "claude");
		} catch {
			// Not here; keep looking.
		}
	}
	return null;
}

const parts = (version: string) => version.split(".").map((n) => Number.parseInt(n, 10) || 0);

export function atLeast(found: string, floor: string): boolean {
	const [a, b] = [parts(found), parts(floor)];
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	}
	return true;
}

/** Runs *before* login is checked: a wrong binary is wrong regardless of who
    is signed in. Zero I/O beyond `stat`/`--version` (07 §5). */
export async function locate(pin: HarnessProvider["pin"]): Promise<Located> {
	if (!("binary" in pin)) {
		throw {
			code: "adapter.pin_shape",
			message: "Claude Code is located on the machine, but this pin names a repo and a commit.",
			remedy: "Pin Claude Code to a binary and a version floor on the Providers screen.",
		} satisfies Blocker;
	}
	const managed = managedTier();
	if (managed) throw managed;
	const path = claudeOnPath();
	if (!path) {
		throw {
			code: "adapter.not_installed",
			message: "Claude Code is not installed.",
			remedy: "Install it from https://claude.com/claude-code, or run `harness run pi`.",
			link: "https://claude.com/claude-code",
		} satisfies Blocker;
	}
	const { stdout } = await run(path, ["--version"]);
	const version = stdout.trim().split(/\s+/)[0] ?? "";
	if (!atLeast(version, pin.minVersion)) {
		throw {
			code: "adapter.below_min_version",
			message: `Claude Code ${version} is installed; your organization requires ${pin.minVersion} or later.`,
			remedy: "Update Claude Code.",
		} satisfies Blocker;
	}
	return { path, version };
}
