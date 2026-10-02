import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { harnessHome } from "./selection.js";

const execFileAsync = promisify(execFile);

// The agent inherits nothing. Anything it needs is listed here explicitly, so
// a credential in the person's shell can never reach it by accident (§7).
const PASSTHROUGH = ["TERM", "LANG", "TZ"] as const;
const PATH_ROOTS = ["/usr/", "/bin", "/sbin", "/opt/homebrew/", "/usr/local/"];

export interface ChildEnvironmentInput {
	sessionId: string;
	sessionDir: string;
	/** D30l: the harness's own environments. Absent only in tests that predate it. */
	envDir?: string;
	/** `http://harness:<secret>@127.0.0.1:<port>` — carries the session secret (§7). The username
	    is a constant, present because undici's `ProxyAgent` sends no `Proxy-Authorization` at all for
	    a URL whose username is empty (05 §4.3). */
	proxyUrl?: string;
	adapterEnv: Record<string, string>;
}

function systemPath(): string {
	return (process.env.PATH ?? "")
		.split(delimiter)
		.filter((entry) => PATH_ROOTS.some((root) => entry === root.replace(/\/$/, "") || entry.startsWith(root)))
		.join(delimiter);
}

/**
 * §7's table, built from nothing. The parent's environment is consulted only
 * for the named keys. An adapter key colliding with a core key is a bug, not a
 * `Blocker`: it throws at plan time (C6, 03 §5.7 row 4).
 */
export function childEnvironment(input: ChildEnvironmentInput): Record<string, string> {
	const env: Record<string, string> = {
		// Verbatim: `~/.harness` paths must resolve inside the jail (C27); denial
		// under it is explicit in 06.
		HOME: process.env.HOME ?? "",
		PATH: input.envDir === undefined ? systemPath() : [join(input.envDir, "python", "bin"), join(input.envDir, "node", "bin"), systemPath()].join(delimiter),
		// Private temp inside the geometry, so a scratch file cannot land outside it.
		TMPDIR: join(input.sessionDir, "tmp"),
		HARNESS_SESSION_ID: input.sessionId,
		HARNESS_SESSION_DIR: input.sessionDir,
	};
	// D30l: everything a session installs lands in the harness's own environment,
	// never in the machine's — one directory per harness, kept between sessions.
	if (input.envDir !== undefined) Object.assign(env, languageHomes(input.envDir));
	for (const key of PASSTHROUGH) {
		const value = process.env[key];
		if (value !== undefined) env[key] = value;
	}
	if (input.proxyUrl !== undefined) {
		env.HTTP_PROXY = input.proxyUrl;
		env.HTTPS_PROXY = input.proxyUrl;
		// Only the proxy's own host is exempt: the inject leg is a plain request
		// to that origin, and a client that honours HTTP_PROXY (undici's
		// EnvHttpProxyAgent, which Pi installs) would otherwise CONNECT the
		// proxy to itself. Nothing else is listed, so no inherited default can
		// exempt a host.
		env.NO_PROXY = new URL(input.proxyUrl).hostname;
		// What Pi's `models.json` presents as its API key (07 §7). Read off the
		// proxy URL rather than passed beside it, so the two cannot disagree; it
		// is worth nothing outside this session's proxy (05 §4.2).
		env.HARNESS_SESSION_SECRET = new URL(input.proxyUrl).password;
	}
	for (const [key, value] of Object.entries(input.adapterEnv)) {
		if (key in env) throw new Error(`adapter may not override core env: ${key}`);
		env[key] = value;
	}
	return env;
}

/** `<HARNESS_HOME>/envs/<harness id>`; a session with no harness shares `everything`. */
export function environmentDir(harnessId: string | undefined): string {
	return join(harnessHome(), "envs", harnessId ?? "everything");
}

/** Per language, the home the tools read from the environment (D30l). Python's
    venv is created by `ensureEnvironment`; the others are directories a first
    install creates itself. */
export function languageHomes(envDir: string): Record<string, string> {
	return {
		VIRTUAL_ENV: join(envDir, "python"),
		PIP_REQUIRE_VIRTUALENV: "1",
		PYTHONNOUSERSITE: "1",
		UV_PROJECT_ENVIRONMENT: join(envDir, "python"),
		npm_config_prefix: join(envDir, "node"),
		NPM_CONFIG_PREFIX: join(envDir, "node"),
		GOPATH: join(envDir, "go"),
		CARGO_HOME: join(envDir, "cargo"),
		GEM_HOME: join(envDir, "gem"),
	};
}

/**
 * Before spawn (08 §6 row 11a): the directories exist, and Python's venv exists
 * when `python3` does — created outside the jail, once per harness, offline.
 * No `python3` on the machine is not a failure; the row says so once.
 */
export async function ensureEnvironment(envDir: string, notify: (line: string) => void): Promise<void> {
	for (const dir of ["node/bin", "go", "cargo", "gem"]) await mkdir(join(envDir, dir), { recursive: true, mode: 0o700 });
	const python = join(envDir, "python");
	try {
		await stat(join(python, "bin", "python"));
		return;
	} catch {
		/* not yet */
	}
	try {
		await execFileAsync("python3", ["-m", "venv", python]);
		notify(`Made this harness's Python environment at ${python}.`);
	} catch {
		notify("No `python3` on this machine, so this harness has no Python environment; everything else is set.");
	}
}
