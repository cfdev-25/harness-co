import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { claudeOnPath } from "./adapters/claude/index.js";
import { piBundle } from "./adapters/pi/index.js";
import { harnessHome } from "./selection.js";

/** `locate` refuses a missing binary with a `Blocker`; `harness auth` is not
    a session boot, so it refuses with the same sentence as a plain error. */
function claudeBinary(): string {
	const path = claudeOnPath();
	if (!path) {
		throw new Error(
			"Claude Code is not installed: no `claude` binary on your PATH. " +
				"Install it from https://claude.com/claude-code, or run `harness run pi` instead.",
		);
	}
	return path;
}

const execFileAsync = promisify(execFile);

/** 07 §11: `~/.harness/agents/<id>/`, outside `~/.harness/assets` so
    a login never lands in the agent-writable work tree. */
export function agentStoreDir(agentId: string): string {
	return join(harnessHome(), "agents", agentId);
}

/**
 * The one file each agent's native login leaves behind, inside its own
 * config directory — what `seedAgentCredentials`/`harvestAgentCredentials`
 * copy between the stable store and a running session's `agentDir`. Neither
 * agent's CLI lets a session's `agentDir` simply *be* the stable store: both
 * adapters write session-specific, regenerated-every-run files into the same
 * directory (skills, settings, CLAUDE.md/AGENTS.md), and pointing
 * `CLAUDE_CONFIG_DIR`/`PI_CODING_AGENT_DIR` straight at the stable store
 * would let one running session's render clobber another's, or leave a
 * `denyWrite`-worthy settings file sitting in the one place two sessions
 * would fight over it (D11 Spike 2, answered this way for both
 * agents rather than only Pi).
 *
 * On macOS, Claude Code's login can end up in the Keychain instead of this
 * file (D11 Spike 3) — `seedAgentCredentials` then silently
 * copies nothing, and the session falls through to `harness auth`'s own
 * `claude auth status` check to know whether that happened. Closing that
 * fully needs the sandbox this repo does not have yet.
 */
const CREDENTIAL_FILE: Record<string, string> = {
	claude: ".credentials.json",
	pi: "auth.json",
};

async function copyIfPresent(from: string, to: string): Promise<void> {
	try {
		await copyFile(from, to);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

/** Before a "native" session spawns: hand it the stable login, in the one
    file its own CLI reads it from. A no-op for an agent with no stored file
    (never logged in, or macOS Keychain storage — see above). */
export async function seedAgentCredentials(agentId: string, sessionAgentDir: string): Promise<void> {
	const file = CREDENTIAL_FILE[agentId];
	if (!file) return;
	await mkdir(sessionAgentDir, { recursive: true, mode: 0o700 });
	await copyIfPresent(join(agentStoreDir(agentId), file), join(sessionAgentDir, file));
}

/** After exit: OAuth refresh rotates the credential, so the session's copy
    may be newer than the stable one it was seeded from. */
export async function harvestAgentCredentials(agentId: string, sessionAgentDir: string): Promise<void> {
	const file = CREDENTIAL_FILE[agentId];
	if (!file) return;
	await copyIfPresent(join(sessionAgentDir, file), join(agentStoreDir(agentId), file));
}

const KNOWN_AGENTS = ["pi", "claude"] as const;

function requireKnownAgent(agentId: string): void {
	if (!(KNOWN_AGENTS as readonly string[]).includes(agentId)) {
		throw new Error(`"${agentId}" has no native login. You have: ${KNOWN_AGENTS.join(", ")}.`);
	}
}

/** Runs a login/logout flow with the terminal handed to the child — outside
    the jail entirely, the same way `harness run` never is (07 §11):
    a browser callback and a credential store that survives the process are
    both things the sandbox exists to deny a session, and this is not one. */
function spawnInherit(command: string, argv: string[], env: Record<string, string>): Promise<void> {
	return new Promise((resolveExit, reject) => {
		const child = spawn(command, argv, { stdio: "inherit", env: { ...process.env, ...env } });
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) resolveExit();
			else reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
		});
	});
}

export async function authLogin(agentId: string): Promise<void> {
	requireKnownAgent(agentId);
	const dir = agentStoreDir(agentId);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	if (agentId === "claude") {
		await spawnInherit(claudeBinary(), ["auth", "login"], { CLAUDE_CONFIG_DIR: dir, XDG_CONFIG_HOME: dir });
		return;
	}
	console.log("Starting Pi so you can sign in — type /login once it's up, then exit when you're done.");
	await spawnInherit(process.execPath, [piBundle()], { PI_CODING_AGENT_DIR: dir });
}

export async function authLogout(agentId: string): Promise<void> {
	requireKnownAgent(agentId);
	const dir = agentStoreDir(agentId);
	if (agentId === "claude") {
		await spawnInherit(claudeBinary(), ["auth", "logout"], { CLAUDE_CONFIG_DIR: dir, XDG_CONFIG_HOME: dir });
		return;
	}
	await rm(join(dir, CREDENTIAL_FILE.pi), { force: true });
	console.log("Removed Pi's stored login.");
}

export interface AuthStatus {
	agentId: string;
	loggedIn: boolean;
}

export async function authStatus(agentId: string): Promise<AuthStatus> {
	requireKnownAgent(agentId);
	const dir = agentStoreDir(agentId);
	if (agentId === "claude") {
		try {
			const { stdout } = await execFileAsync(claudeBinary(), ["auth", "status", "--json"], {
				env: { ...process.env, CLAUDE_CONFIG_DIR: dir, XDG_CONFIG_HOME: dir },
			});
			return { agentId, loggedIn: (JSON.parse(stdout) as { loggedIn?: boolean }).loggedIn === true };
		} catch {
			// No `claude` on PATH, or the process itself failed: either way,
			// there is nothing here to call "logged in".
			return { agentId, loggedIn: false };
		}
	}
	const loggedIn = await readFile(join(dir, CREDENTIAL_FILE.pi))
		.then(() => true)
		.catch(() => false);
	return { agentId, loggedIn };
}

export async function authList(): Promise<AuthStatus[]> {
	return Promise.all(KNOWN_AGENTS.map((agentId) => authStatus(agentId)));
}
