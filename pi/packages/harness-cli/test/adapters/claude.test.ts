import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claude } from "../../src/adapters/claude.js";
import { type Manifest, sessionDir } from "../../src/core.js";

const saved = { ...process.env };
afterEach(() => {
	process.env = { ...saved };
});

// Same wiring `run` does: pick a session id, derive its paths, hand the
// adapter a context. Kept local to the test so the adapter itself only ever
// sees the RenderContext shape it declares.
async function render(manifest: Manifest, id: string) {
	const root = sessionDir(id);
	const agent = join(root, "agent");
	await claude.render({ manifest, id, sessionDir: root, agentDir: agent });
	return { id, root, agent };
}

/** A `claude` on PATH the launch tests can locate without depending on
    whatever is actually installed on the machine running the suite. */
async function fakeClaudeOnPath(): Promise<string> {
	const binDir = await mkdtemp(join(tmpdir(), "claude-bin-"));
	const bin = join(binDir, "claude");
	await writeFile(bin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	process.env.PATH = `${binDir}${delimiter}${process.env.PATH ?? ""}`;
	return bin;
}

const model = { provider: "p", model_id: "m", base_url: "http://x", key_ref: "r", env_var: "E" };

describe("materialization", () => {
	it("writes skills, commands, CLAUDE.md, hooks, and the manifest", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "claude-session-"));
		const manifest: Manifest = {
			user: { auth_user_id: "user", org_unit_path: "acme.team.user" },
			assets: [
				{
					kind: "skill",
					name: "catch-up",
					files: [{ path: "SKILL.md", content_b64: Buffer.from("# Skill").toString("base64") }],
				},
				{
					kind: "memory",
					name: "defaults",
					files: [{ path: "memory.md", content_b64: Buffer.from("Be concise.").toString("base64") }],
				},
				{
					kind: "prompt",
					name: "weekly-update",
					files: [{ path: "F.md", content_b64: Buffer.from("SAVED TEXT").toString("base64") }],
				},
			],
			boundary: {},
			model,
		};
		const session = await render(manifest, "session-id");
		expect(await readFile(join(session.agent, "skills/catch-up/SKILL.md"), "utf8")).toBe("# Skill");
		expect(await readFile(join(session.agent, "CLAUDE.md"), "utf8")).toContain("## defaults");
		expect(await readFile(join(session.agent, "commands", "weekly-update.md"), "utf8")).toBe("SAVED TEXT");
		const settings = JSON.parse(await readFile(join(session.agent, "claude-settings.json"), "utf8"));
		expect(Object.keys(settings.hooks).sort()).toEqual(["PostToolUse", "PostToolUseFailure"]);
		const manifestWritten = JSON.parse(await readFile(join(session.root, "manifest.json"), "utf8"));
		expect(manifestWritten.assets).toHaveLength(3);
		// No copies of policy.json/harness.json: nothing on the Claude Code
		// side reads them, so this adapter never writes them (unlike Pi's).
		await expect(readFile(join(session.root, "policy.json"), "utf8")).rejects.toThrow();
		await expect(readFile(join(session.root, "harness.json"), "utf8")).rejects.toThrow();
	});

	it("boots with no model configured, unlike Pi's adapter", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "claude-nomodel-"));
		const manifest = {
			user: { auth_user_id: "u", org_unit_path: "acme" },
			assets: [],
			boundary: {},
			model: null,
		} as unknown as Manifest;
		await expect(render(manifest, "no-model")).resolves.toBeDefined();
	});
});

describe("instruction ordering", () => {
	it("puts system prompts before memories in CLAUDE.md, broadest scope first", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "claude-order-"));
		const b64 = (text: string) => Buffer.from(text).toString("base64");
		const asset = (kind: string, name: string, path: string, body: string) => ({
			kind,
			name,
			org_unit_path: path,
			files: [{ path: "F.md", content_b64: b64(body) }],
		});
		const manifest = {
			user: { auth_user_id: "u", org_unit_path: "org.team.user" },
			assets: [
				asset("system_prompt", "mine", "org.team.user", "USER"),
				asset("memory", "notes", "org.team", "MEMORY"),
				asset("system_prompt", "house", "org.team", "TEAM"),
				asset("system_prompt", "wide", "org", "ORG"),
			],
			boundary: {},
			model,
		} as unknown as Manifest;

		const session = await render(manifest, "ord");
		const text = await readFile(join(session.agent, "CLAUDE.md"), "utf8");
		expect(text.indexOf("ORG")).toBeLessThan(text.indexOf("TEAM"));
		expect(text.indexOf("TEAM")).toBeLessThan(text.indexOf("USER"));
		expect(text.indexOf("USER")).toBeLessThan(text.indexOf("MEMORY"));
	});
});

describe("harness membership", () => {
	const b64 = (text: string) => Buffer.from(text).toString("base64");
	const asset = (kind: string, name: string) => ({
		kind,
		name,
		files: [{ path: "F.md", content_b64: b64(`${name} body`) }],
	});
	const every = [
		asset("skill", "shared"),
		asset("skill", "mine"),
		asset("memory", "notes"),
		asset("prompt", "weekly"),
	];

	const manifestFor = (harness: unknown) =>
		({
			user: { auth_user_id: "u", org_unit_path: "acme" },
			harness,
			assets: every,
			boundary: {},
			model,
		}) as unknown as Manifest;

	const support = (assets: Array<{ kind: string; name: string }>) => ({
		id: "h1",
		name: "Support",
		description: "Front line.",
		icon: { palette: [], rows: [] },
		org_unit_path: "acme",
		assets,
	});

	it("lays out what the harness contains and nothing else", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "claude-member-"));
		const session = await render(
			manifestFor(
				support([
					{ kind: "skill", name: "mine" },
					{ kind: "memory", name: "notes" },
				]),
			),
			"in-h1",
		);
		expect(await readFile(join(session.agent, "skills/mine/F.md"), "utf8")).toContain("mine");
		await expect(readFile(join(session.agent, "skills/shared/F.md"), "utf8")).rejects.toThrow();
		expect(await readFile(join(session.agent, "CLAUDE.md"), "utf8")).toContain("notes body");
		await expect(readFile(join(session.agent, "commands", "weekly.md"), "utf8")).rejects.toThrow();
	});

	it("loads everything when no harness is selected", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "claude-none-"));
		const session = await render(manifestFor(null), "no-harness");
		expect((await readdir(join(session.agent, "skills"))).sort()).toEqual(["mine", "shared"]);
		expect(await readdir(join(session.agent, "commands"))).toEqual(["weekly.md"]);
	});
});

describe("launch", () => {
	it("locates the claude binary and carries both --settings and --setting-sources user", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "claude-launch-"));
		const claudeBin = await fakeClaudeOnPath();
		const session = await render(
			{ user: { auth_user_id: "u", org_unit_path: "acme" }, assets: [], boundary: {}, model } as unknown as Manifest,
			"launch-id",
		);
		const launched = claude.launch({
			manifest: {
				user: { auth_user_id: "u", org_unit_path: "acme" },
				assets: [],
				boundary: {},
				model,
			} as unknown as Manifest,
			id: "launch-id",
			sessionDir: session.root,
			agentDir: session.agent,
		});
		expect(launched.argv[0]).toBe(claudeBin);
		expect(launched.argv).toEqual([
			claudeBin,
			"--settings",
			join(session.agent, "claude-settings.json"),
			"--setting-sources",
			"user",
		]);
		expect(launched.env.CLAUDE_CONFIG_DIR).toBe(session.agent);
	});

	it("sets the model env vars only when a model is configured", async () => {
		await fakeClaudeOnPath();
		const withModel = claude.launch({
			manifest: {
				user: { auth_user_id: "u", org_unit_path: "acme" },
				assets: [],
				boundary: {},
				model,
			} as unknown as Manifest,
			id: "m1",
			sessionDir: "/tmp/x",
			agentDir: "/tmp/x/agent",
		});
		expect(withModel.env.ANTHROPIC_BASE_URL).toBe("http://x");
		expect(withModel.env.ANTHROPIC_MODEL).toBe("m");

		const withoutModel = claude.launch({
			manifest: {
				user: { auth_user_id: "u", org_unit_path: "acme" },
				assets: [],
				boundary: {},
				model: null,
			} as unknown as Manifest,
			id: "m2",
			sessionDir: "/tmp/y",
			agentDir: "/tmp/y/agent",
		});
		expect(withoutModel.env.ANTHROPIC_BASE_URL).toBeUndefined();
		expect(withoutModel.env.ANTHROPIC_MODEL).toBeUndefined();
	});

	it("names what to do when no claude binary is on PATH", () => {
		process.env.PATH = "";
		expect(() =>
			claude.launch({
				manifest: {
					user: { auth_user_id: "u", org_unit_path: "acme" },
					assets: [],
					boundary: {},
					model,
				} as unknown as Manifest,
				id: "no-bin",
				sessionDir: "/tmp/z",
				agentDir: "/tmp/z/agent",
			}),
		).toThrow(/claude.*is not installed|not on your PATH/i);
	});
});

describe("the audit hook script", () => {
	it("appends exactly one line per finished tool call, matching Pi's audit schema", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "claude-audit-"));
		const session = await render(
			{ user: { auth_user_id: "u", org_unit_path: "acme" }, assets: [], boundary: {}, model } as unknown as Manifest,
			"audit-id",
		);
		const auditPath = join(await mkdtemp(join(tmpdir(), "claude-audit-out-")), "audit.jsonl");
		const script = join(session.agent, "audit-hook.cjs");

		// Captured verbatim from a real `claude -p` run against 2.1.275 with a
		// hook echoing its own stdin, so this is what the script actually has
		// to parse, not a guess at the shape.
		const post = {
			session_id: "df1c6b28-f957-4c90-aa94-6e0c9312b11f",
			hook_event_name: "PostToolUse",
			tool_name: "Bash",
			tool_input: { command: "echo works-with-bypass", description: "Echo a test string" },
			tool_response: { stdout: "works-with-bypass", stderr: "", interrupted: false },
			tool_use_id: "toolu_01DzSYUa3hsSBDN4NGv7hG4G",
			duration_ms: 282,
		};
		const failure = {
			session_id: "aa5979c5-fcbd-406a-a823-fbb857a97622",
			hook_event_name: "PostToolUseFailure",
			tool_name: "Bash",
			tool_input: { command: "bash -c 'exit 3'", description: "Run command that exits with code 3" },
			error: "Exit code 3",
			is_interrupt: false,
			tool_use_id: "toolu_012gFPWT9dHCJyiMDHukMoW8",
			duration_ms: 259,
		};

		execFileSync(process.execPath, [script, auditPath], { input: JSON.stringify(post) });
		execFileSync(process.execPath, [script, auditPath], { input: JSON.stringify(failure) });

		const lines = (await readFile(auditPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({
			action: "tool.call",
			payload: { tool: "Bash", duration_ms: 282, ok: true },
		});
		expect(lines[0].payload.plain_sentence).toContain("echo works-with-bypass");
		expect(typeof lines[0].occurred_at).toBe("string");
		expect(lines[1]).toMatchObject({
			action: "tool.call",
			payload: { tool: "Bash", duration_ms: 259, ok: false },
		});
	});
});
