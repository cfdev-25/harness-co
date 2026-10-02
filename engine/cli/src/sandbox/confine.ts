import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import type { Blocker, SpawnPlan } from "@harness/compose/contracts";
import { confineDarwin } from "./darwin.js";
import { confineLinux } from "./linux.js";
import { refuseUnsupportedPlatform } from "./windows.js";

/** `plan.filesystem`, every path resolved to the one the kernel matches (06 §6.3).
    Private to the sandbox module: Seatbelt and bwrap both take realpaths, so the
    resolution happens once, here, and neither profile builder resolves anything. */
export interface Geometry {
	allowWrite: string[];
	denyRead: string[];
	denyWrite: string[];
}

/**
 * Wraps argv so that exec'ing the result runs it inside the jail (06 §3).
 * Pure: reads plan and session, writes nothing. `08` calls it once for the
 * probes and once for the real spawn, with the same arguments (D88).
 */
export function confine(
	plan: SpawnPlan,
	argv: string[],
	session: { dir: string; proxyPort: number },
): { command: string; args: string[] } {
	const geometry = resolveGeometry(plan.filesystem, session.dir);
	if (process.platform === "darwin") return confineDarwin(geometry, argv, session.proxyPort);
	if (process.platform === "linux") return confineLinux(plan, geometry, argv, session);
	// 06 §9a: Windows is the platform people ask for and the one row §10 names;
	// any other platform has no jail we can prove either, and the answer is the
	// same — the session does not start.
	return refuseUnsupportedPlatform();
}

function resolveGeometry(filesystem: SpawnPlan["filesystem"], sessionDir: string): Geometry {
	return {
		// The workspace, the assets work tree, the agent dir and the spool must
		// exist before spawn (§6.3); the private tmp is the stated exception —
		// `08` creates it, and the profile names it either way.
		allowWrite: filesystem.allowWrite.map((path) =>
			path === join(sessionDir, "tmp") ? lexical(path) : required(path),
		),
		// A deny entry that no longer exists is dropped: a race between hydration
		// and spawn that can only make the session safer (§6.3).
		denyRead: filesystem.denyRead.flatMap(present),
		// Not dropped when absent, unlike denyRead: a `.claude` the agent could
		// *create* is the `disableAllHooks` case (D81, §6.2), so an absent entry
		// is still named — as a deny subpath on macOS, as a read-only tmpfs on
		// Linux.
		denyWrite: filesystem.denyWrite.map(lexical),
	};
}

function present(path: string): string[] {
	try {
		return [realpathSync(path)];
	} catch {
		return [];
	}
}

function required(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		throw {
			code: "sandbox.geometry_missing",
			message: `The directory ${path} must exist before a session starts, and it does not.`,
			remedy: `mkdir -p ${path}, or run from inside a repository.`,
		} satisfies Blocker;
	}
}

/** The realpath of the nearest existing ancestor, with the rest appended: the
    kernel will match this path once the directory below it is created. */
function lexical(path: string): string {
	const parent = dirname(path);
	if (parent === path) return path;
	try {
		return join(realpathSync(parent), path.slice(parent.length + 1));
	} catch {
		return join(lexical(parent), path.slice(parent.length + 1));
	}
}
