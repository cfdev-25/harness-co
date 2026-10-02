import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	agentStoreDir,
	authList,
	authLogin,
	authLogout,
	authStatus,
	harvestAgentCredentials,
	seedAgentCredentials,
} from "../src/auth.js";

const saved = { ...process.env };
afterEach(() => {
	process.env = { ...saved };
});

/** A fake `claude` that plays along with `auth login|logout|status --json`
    against whatever CLAUDE_CONFIG_DIR it is given, so these tests exercise
    src/auth.ts's own logic without a real login or network. */
async function fakeClaudeOnPath(): Promise<void> {
	const binDir = await mkdtemp(join(tmpdir(), "auth-claude-bin-"));
	const bin = join(binDir, "claude");
	await writeFile(
		bin,
		`#!/bin/sh
set -e
if [ "$1" = "auth" ] && [ "$2" = "login" ]; then
	mkdir -p "$CLAUDE_CONFIG_DIR"
	echo '{"token":"fake"}' > "$CLAUDE_CONFIG_DIR/.credentials.json"
	exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "logout" ]; then
	rm -f "$CLAUDE_CONFIG_DIR/.credentials.json"
	exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
	if [ -f "$CLAUDE_CONFIG_DIR/.credentials.json" ]; then
		echo '{"loggedIn":true}'
		exit 0
	fi
	echo '{"loggedIn":false}'
	exit 1
fi
exit 1
`,
		{ mode: 0o755 },
	);
	process.env.PATH = `${binDir}${delimiter}${process.env.PATH ?? ""}`;
}

describe("agentStoreDir", () => {
	it("lives outside ~/.harness/assets, under agents/<id>", async () => {
		process.env.HARNESS_HOME = "/tmp/harness-home-example";
		expect(agentStoreDir("claude")).toBe("/tmp/harness-home-example/agents/claude");
	});
});

describe("harness auth claude", () => {
	it("login writes into the stable store, status sees it, logout removes it", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "auth-home-"));
		await fakeClaudeOnPath();

		expect(await authStatus("claude")).toEqual({ agentId: "claude", loggedIn: false });

		await authLogin("claude");
		expect(await authStatus("claude")).toEqual({ agentId: "claude", loggedIn: true });
		await expect(readFile(join(agentStoreDir("claude"), ".credentials.json"), "utf8")).resolves.toContain("fake");

		await authLogout("claude");
		expect(await authStatus("claude")).toEqual({ agentId: "claude", loggedIn: false });
	});

	it("--list reports every known agent", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "auth-list-"));
		await fakeClaudeOnPath();
		expect((await authList()).map((row) => row.agentId).sort()).toEqual(["claude", "pi"]);
	});

	it("names what it does not know", async () => {
		await expect(authLogin("codex")).rejects.toThrow(/"codex" has no native login/);
	});
});

describe("harness auth pi", () => {
	it("status reflects whether the stable auth.json exists, logout removes it", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "auth-pi-"));
		expect(await authStatus("pi")).toEqual({ agentId: "pi", loggedIn: false });

		await mkdir(agentStoreDir("pi"), { recursive: true });
		await writeFile(join(agentStoreDir("pi"), "auth.json"), "{}");
		expect(await authStatus("pi")).toEqual({ agentId: "pi", loggedIn: true });

		await authLogout("pi");
		expect(await authStatus("pi")).toEqual({ agentId: "pi", loggedIn: false });
	});
});

describe("seed and harvest", () => {
	it("seeds the stable credential into a session's agent dir before spawn", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "auth-seed-"));
		await mkdir(agentStoreDir("pi"), { recursive: true });
		await writeFile(join(agentStoreDir("pi"), "auth.json"), '{"token":"stable"}');

		const sessionAgentDir = await mkdtemp(join(tmpdir(), "auth-session-"));
		await seedAgentCredentials("pi", sessionAgentDir);
		await expect(readFile(join(sessionAgentDir, "auth.json"), "utf8")).resolves.toContain("stable");
	});

	it("does nothing when the agent has never logged in — not every session needs one", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "auth-noseed-"));
		const sessionAgentDir = await mkdtemp(join(tmpdir(), "auth-session2-"));
		await expect(seedAgentCredentials("pi", sessionAgentDir)).resolves.toBeUndefined();
		await expect(readFile(join(sessionAgentDir, "auth.json"), "utf8")).rejects.toThrow();
	});

	it("harvests a rotated credential back into the stable store after exit", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "auth-harvest-"));
		await mkdir(agentStoreDir("pi"), { recursive: true });
		await writeFile(join(agentStoreDir("pi"), "auth.json"), '{"token":"stale"}');
		const sessionAgentDir = await mkdtemp(join(tmpdir(), "auth-session3-"));
		await seedAgentCredentials("pi", sessionAgentDir);
		// The agent's own OAuth refresh rewrote its copy mid-session.
		await writeFile(join(sessionAgentDir, "auth.json"), '{"token":"refreshed"}');

		await harvestAgentCredentials("pi", sessionAgentDir);
		await expect(readFile(join(agentStoreDir("pi"), "auth.json"), "utf8")).resolves.toContain("refreshed");
	});
});
