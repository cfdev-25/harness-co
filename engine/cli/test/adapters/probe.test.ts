import { execFile } from "node:child_process";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProbeRunner } from "@harness/compose/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { claudeAdapter } from "../../src/adapters/claude/index.js";
import { settingsRejected } from "../../src/adapters/claude/probe.js";
import { PI_PIN, pi } from "../../src/adapters/pi/index.js";
import { fixture } from "./fixture.js";

const fakeBin = fileURLToPath(new URL("./bin", import.meta.url));
const saved = { ...process.env };
afterEach(() => {
	process.env = { ...saved };
});

/**
 * A real subprocess runner. 06's `spawnConfined` wraps the same argv in the
 * session profile, which is what makes these T3; here they run unconfined,
 * so what they prove is the adapter's own assertions, not the jail's.
 */
const runner: ProbeRunner = (argv) =>
	new Promise((resolve) => {
		execFile(argv[0], argv.slice(1), { timeout: 5_000 }, (error, stdout, stderr) => {
			resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr });
		});
	});

describe("probe", () => {
	it("pi_probe_version_matches_pin", async () => {
		const f = await fixture();
		// Unconfined, the developer's own `~/.pi/agent/auth.json` is readable —
		// which is exactly what 06's profile denies. Until this runs through
		// `spawnConfined`, an empty HOME stands in for the jail's geometry.
		process.env.HOME = f.root;
		f.ctx.choices.located = await pi.locate({ repo: "pi", commit: PI_PIN.commit });
		await expect(pi.probe(f.ctx, runner)).resolves.toBeUndefined();
	});

	it("refuses when the running binary is not the located one", async () => {
		const f = await fixture();
		const wrong: ProbeRunner = async (argv) =>
			argv.includes("--version") ? { code: 0, stdout: "0.84.0\n", stderr: "" } : { code: 1, stdout: "", stderr: "" };
		await expect(pi.probe(f.ctx, wrong)).rejects.toMatchObject({ code: "adapter.probe_version" });
	});

	it("claude_probe_sees_no_ambient_login", async () => {
		const f = await fixture();
		process.env.PATH = `${fakeBin}${delimiter}${process.env.PATH ?? ""}`;
		process.env.HOME = f.root;
		f.ctx.choices.located = await claudeAdapter.locate({ binary: "claude", minVersion: "2.1.275" });
		await expect(claudeAdapter.probe(f.ctx, runner)).resolves.toBeUndefined();
	});

	it("treats a reachable sign-in as a failure", async () => {
		const f = await fixture();
		f.ctx.choices.located = { path: "/usr/local/bin/claude", version: "2.1.275" };
		const loggedIn: ProbeRunner = async (argv) => {
			if (argv.includes("--version")) return { code: 0, stdout: "2.1.275 (Claude Code)\n", stderr: "" };
			if (argv[0] === "/bin/cat") return { code: 1, stdout: "", stderr: "" };
			return { code: 0, stdout: '{"loggedIn":true}', stderr: "" };
		};
		await expect(claudeAdapter.probe(f.ctx, loggedIn)).rejects.toMatchObject({ code: "adapter.probe_login" });
	});

	it("claude_probe_refuses_a_settings_file_claude_rejects", async () => {
		const f = await fixture();
		f.ctx.choices.located = { path: "/usr/local/bin/claude", version: "2.1.286" };
		// D144: `claude doctor`'s own words on 2.1.286, for the key our
		// `settings.json` carried from wave 3 until this wave.
		const doctoring = (body: string): ProbeRunner => async (argv) => {
			if (argv.includes("--version")) return { code: 0, stdout: "2.1.286 (Claude Code)\n", stderr: "" };
			if (argv[0] === "/bin/cat") return { code: 1, stdout: "", stderr: "" };
			if (argv.includes("doctor")) return { code: 0, stdout: body, stderr: "" };
			return { code: 0, stdout: '{"loggedIn":false}', stderr: "" };
		};
		const invalid = [
			"Claude Code doctor",
			"",
			"Invalid settings",
			`- ${join(f.ctx.agentDir, "settings.json")} › autoUpdatesChannel: Invalid value. Expected one of: "latest", "stable", "rc"`,
			'  Suggested fix: Valid values: "latest", "stable", "rc"',
			"",
		].join("\n");
		await expect(claudeAdapter.probe(f.ctx, doctoring(invalid))).rejects.toMatchObject({
			code: "preflight.settings_rejected",
			// The line is quoted whole: the key is the only thing that says what to fix.
			message: expect.stringContaining('autoUpdatesChannel: Invalid value. Expected one of: "latest", "stable", "rc"'),
		});
		// A clean `doctor` passes, warnings and all.
		await expect(claudeAdapter.probe(f.ctx, doctoring("Claude Code doctor\n\n1 warning found\n- Running native installation\n"))).resolves.toBeUndefined();
	});

	it("settings_rejected_ignores_a_file_the_session_does_not_load", () => {
		// `doctor` reads the current directory's project settings too, and
		// `--setting-sources user` never loads those (07 §8). Refusing over one
		// would refuse a session for a file it ignores.
		const mine = "/s/agent/settings.json";
		const theirs = "/w/.claude/settings.json";
		const output = ["Invalid settings", `- ${theirs} › hooks: Invalid value.`].join("\n");
		expect(settingsRejected(output, mine)).toBeNull();
		expect(settingsRejected(`${output}\n- ${mine} › model: Invalid value.`, mine)).toBe(
			`${mine} › model: Invalid value.`,
		);
	});

	it("ambient_stores_unreadable", async () => {
		const f = await fixture();
		process.env.HOME = f.root;
		f.ctx.choices.located = { path: "/usr/local/bin/claude", version: "2.1.275" };
		// An unexpected *success* is a failure (I5), for every store both
		// adapters name.
		for (const adapter of [pi, claudeAdapter]) {
			for (const store of adapter.ambientStores()) {
				expect((await runner(["/bin/cat", store])).code).not.toBe(0);
			}
		}
		const readable: ProbeRunner = async (argv) =>
			argv.includes("--version")
				? { code: 0, stdout: "2.1.275 (Claude Code)\n", stderr: "" }
				: { code: 0, stdout: "a credential", stderr: "" };
		await expect(claudeAdapter.probe(f.ctx, readable)).rejects.toMatchObject({ code: "adapter.probe_ambient" });
	});
});
