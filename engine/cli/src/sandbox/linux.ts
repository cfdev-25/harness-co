import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { execPath, env as parentEnv } from "node:process";
import { fileURLToPath } from "node:url";
import type { Blocker, SpawnPlan } from "@harness/compose/contracts";
import type { Geometry } from "./confine.js";

/** Bound read-only below, so a binary already under one needs no bind of its own. */
const BOUND_ROOTS = ["/usr", "/bin", "/sbin", "/lib", "/lib64"];
/** Where bwrap binds `<sessionDir>/proxy.sock`. The jail's whole exit (§9). */
const SOCKET_INSIDE = "/run/harness/proxy.sock";

/**
 * The Linux jail: `bwrap` invoked directly (D4), in the argv order of 06 §5 —
 * later arguments override earlier ones, so the deny binds come after the HOME
 * bind and the read-only re-binds after the workspace bind. `--unshare-all`
 * gives a fresh net namespace, which is the wall; the forwarder inside bridges
 * loopback TCP to the bound-in socket, which is the door.
 */
export function confineLinux(
	plan: SpawnPlan,
	geometry: Geometry,
	argv: string[],
	session: { dir: string; proxyPort: number },
): { command: string; args: string[] } {
	const bwrap = locateBwrap();
	requireUserNamespaces();
	// C27/S6: HOME is passed verbatim and the deny set is the obligation. `08`
	// always sets it; its absence is a bug in the caller, not a person's problem.
	const home = realpathSync(plan.env.HOME);
	// The CLI's own package root, not just the forwarder's directory: node reads
	// `package.json` ("type": "module") to decide how to load forwarder.js.
	const cliRoot = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
	const forwarder = fileURLToPath(new URL("./forwarder.js", import.meta.url));
	return {
		command: bwrap,
		args: [
			"--unshare-all",
			"--die-with-parent",
			"--new-session",
			// §7.3: exactly plan.env, nothing inherited.
			"--clearenv",
			...Object.entries(plan.env).flatMap(([key, value]) => ["--setenv", key, value]),
			...["/usr", "/bin", "/sbin", "/lib"].flatMap(roBind),
			...ifPresent("/lib64"),
			...["/etc/passwd", "/etc/group", "/etc/localtime", "/etc/ssl"].flatMap(roBind),
			...ifPresent("/etc/ca-certificates"),
			"--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--tmpfs", "/run",
			...roBind(home),
			// The provider binary and Node (the forwarder and the probes run it)
			// must be reachable; anything already under a bound root is.
			...reachable(dirname(realpathSync(argv[0])), home),
			...reachable(dirname(execPath), home),
			...reachable(cliRoot, home),
			...geometry.allowWrite.flatMap((path) => ["--bind", path, path]),
			...geometry.denyRead.flatMap(hide),
			...geometry.denyWrite.flatMap(readOnly),
			"--bind", join(realpathSync(session.dir), "proxy.sock"), SOCKET_INSIDE,
			// §7.1 row 1: the workspace is the first allowWrite entry.
			"--chdir", geometry.allowWrite[0],
			"--", execPath, forwarder, SOCKET_INSIDE, String(session.proxyPort), "--", ...argv,
		],
	};
}

const roBind = (path: string): string[] => ["--ro-bind", path, path];
const ifPresent = (path: string): string[] => (existsSync(path) ? roBind(path) : []);

function reachable(dir: string, home: string): string[] {
	const under = (root: string) => dir === root || dir.startsWith(`${root}/`);
	return BOUND_ROOTS.some(under) || under(home) ? [] : roBind(dir);
}

/** D82: bwrap has no deny primitive, so hiding is the mechanism — a denied
    directory becomes an empty tmpfs, a denied file reads as empty. */
function hide(path: string): string[] {
	return statSync(path).isDirectory() ? ["--tmpfs", path] : ["--ro-bind", "/dev/null", path];
}

/** D81: a denyWrite entry is a directory made read-only in full, so the agent
    can neither edit a settings file nor create one. Absent, it is a read-only
    tmpfs, which is a mount point the agent cannot write into either. */
function readOnly(path: string): string[] {
	return existsSync(path) ? roBind(path) : ["--tmpfs", path, "--remount-ro", path];
}

function locateBwrap(): string {
	for (const dir of (parentEnv.PATH ?? "").split(delimiter)) {
		const candidate = join(dir, "bwrap");
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	throw {
		code: "sandbox.bwrap_missing",
		message: "bwrap (Bubblewrap) is not installed, and the harness cannot confine the agent without it.",
		remedy: "Install it: `apt install bubblewrap` or `dnf install bubblewrap`.",
	} satisfies Blocker;
}

/** §6.2: unprivileged user namespaces, checked once per boot. There is no
    privileged fallback and no setuid helper. */
function requireUserNamespaces(): void {
	const disabled = (knob: string) => existsSync(knob) && readFileSync(knob, "utf8").trim() === "0";
	if (
		disabled("/proc/sys/kernel/unprivileged_userns_clone") ||
		disabled("/proc/sys/user/max_user_namespaces")
	) {
		throw {
			code: "sandbox.userns_unavailable",
			message:
				"Linux user namespaces are disabled on this machine (`kernel.unprivileged_userns_clone=0` or `user.max_user_namespaces=0`). The harness cannot confine the agent and will not start it.",
			remedy: "Ask your administrator to enable them, or run on another machine.",
		} satisfies Blocker;
	}
}
