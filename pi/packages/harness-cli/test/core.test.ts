import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { credentialsPath, frontmatterName, type Manifest, materializeManifest, writeCredentials } from "../src/core.js";

const saved = { ...process.env };
afterEach(() => {
	process.env = { ...saved };
});

describe("credentials", () => {
	it("writes credentials with owner-only permissions", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-test-"));
		process.env.HARNESS_CREDENTIALS = join(home, "cfg", "credentials.json");
		await writeCredentials({ api_url: "http://example.test", token: "hpat_test" });
		const path = credentialsPath();
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(JSON.parse(await readFile(path, "utf8")).token).toBe("hpat_test");
	});
});

describe("materialization", () => {
	it("writes models, skills, memories, policy, and manifest", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-session-"));
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
				{ kind: "tool", name: "slack_read", files: [] },
			],
			boundary: { approvals: { deploy: "required" } },
			model: {
				provider: "openai-compatible",
				model_id: "example-model",
				base_url: "https://api.example.com/v1",
				key_ref: "secret://acme/default-provider",
				env_var: "PROVIDER_API_KEY",
			},
		};
		const session = await materializeManifest(manifest, "session-id");
		expect(await readFile(join(session.agent, "skills/catch-up/SKILL.md"), "utf8")).toBe("# Skill");
		expect(await readFile(join(session.agent, "AGENTS.md"), "utf8")).toContain("## defaults");
		expect(JSON.parse(await readFile(join(session.root, "policy.json"), "utf8")).allowed_tools).toContain(
			"slack_read",
		);
		expect(JSON.parse(await readFile(join(session.agent, "models.json"), "utf8")).providers).toHaveProperty(
			"openai-compatible",
		);
	});
});

describe("frontmatterName", () => {
	it("reads a name and falls back cleanly", () => {
		expect(frontmatterName("---\nname: concise\n---\nBody", "fallback")).toBe("concise");
		expect(frontmatterName("Body", "fallback")).toBe("fallback");
	});
});

describe("instruction ordering", () => {
	it("puts system prompts before memories, broadest scope first", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-order-"));
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
				// Deliberately shuffled: the renderer must impose the order.
				asset("system_prompt", "mine", "org.team.user", "USER"),
				asset("memory", "notes", "org.team", "MEMORY"),
				asset("system_prompt", "house", "org.team", "TEAM"),
				asset("system_prompt", "wide", "org", "ORG"),
			],
			boundary: {},
			model: {
				provider: "p",
				model_id: "m",
				base_url: "http://x",
				key_ref: "r",
				env_var: "E",
			},
		} as unknown as Manifest;

		const session = await materializeManifest(manifest, "ord");
		const text = await readFile(join(session.agent, "AGENTS.md"), "utf8");
		// A user's system prompt extends the team's; it never precedes it.
		expect(text.indexOf("ORG")).toBeLessThan(text.indexOf("TEAM"));
		expect(text.indexOf("TEAM")).toBeLessThan(text.indexOf("USER"));
		expect(text.indexOf("USER")).toBeLessThan(text.indexOf("MEMORY"));
	});
});

describe("saved prompts", () => {
	it("writes one file per name and keeps them out of the instructions", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-saved-"));
		const manifest = {
			user: { auth_user_id: "u", org_unit_path: "org.team" },
			assets: [
				{
					kind: "system_prompt",
					name: "house-style",
					files: [{ path: "F.md", content_b64: Buffer.from("BEHAVIOUR").toString("base64") }],
				},
				{
					kind: "prompt",
					name: "weekly-update",
					files: [{ path: "F.md", content_b64: Buffer.from("SAVED TEXT").toString("base64") }],
				},
			],
			boundary: {},
			model: { provider: "p", model_id: "m", base_url: "http://x", key_ref: "r", env_var: "E" },
		} as unknown as Manifest;

		const session = await materializeManifest(manifest, "saved");
		expect(await readFile(join(session.agent, "prompts", "weekly-update.md"), "utf8")).toBe("SAVED TEXT");
		const instructions = await readFile(join(session.agent, "AGENTS.md"), "utf8");
		expect(instructions).toContain("BEHAVIOUR");
		expect(instructions).not.toContain("SAVED TEXT");
	});
});

describe("harness membership", () => {
	const b64 = (text: string) => Buffer.from(text).toString("base64");
	const asset = (kind: string, name: string) => ({
		kind,
		name,
		files: [{ path: "F.md", content_b64: b64(`${name} body`) }],
	});
	const model = { provider: "p", model_id: "m", base_url: "http://x", key_ref: "r", env_var: "E" };
	const drawing = { palette: ["#c8875a"], rows: Array<string>(16).fill("0".repeat(16)) };
	const every = [
		asset("skill", "shared"),
		asset("skill", "mine"),
		asset("memory", "notes"),
		asset("prompt", "weekly"),
		asset("tool", "deploy"),
		asset("tool", "always"),
	];

	const manifest = (harness: unknown) =>
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
		icon: drawing,
		org_unit_path: "acme",
		assets,
	});

	it("lays out what the harness contains and nothing else", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-member-"));
		const session = await materializeManifest(
			manifest(
				support([
					{ kind: "skill", name: "mine" },
					{ kind: "memory", name: "notes" },
					{ kind: "tool", name: "always" },
				]),
			),
			"in-h1",
		);
		expect(await readFile(join(session.agent, "skills/mine/F.md"), "utf8")).toContain("mine");
		await expect(readFile(join(session.agent, "skills/shared/F.md"), "utf8")).rejects.toThrow();
		expect(await readFile(join(session.agent, "AGENTS.md"), "utf8")).toContain("notes body");
		// A saved prompt nobody put in this harness does not appear under `/`.
		await expect(readFile(join(session.agent, "prompts/weekly.md"), "utf8")).rejects.toThrow();
		// Tools can only narrow: `deploy` was not added, so it cannot run.
		const policy = JSON.parse(await readFile(join(session.root, "policy.json"), "utf8"));
		expect(policy.allowed_tools).toContain("always");
		expect(policy.allowed_tools).not.toContain("deploy");
		// The whole manifest is still written: a session records everything it
		// was offered, not only what it used.
		const written = JSON.parse(await readFile(join(session.root, "manifest.json"), "utf8"));
		expect(written.assets).toHaveLength(every.length);
	});

	it("gives an empty harness an empty session", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-empty-"));
		const session = await materializeManifest(manifest(support([])), "empty");
		expect(await readdir(join(session.agent, "skills"))).toEqual([]);
		expect(await readdir(join(session.agent, "prompts"))).toEqual([]);
		expect(await readFile(join(session.agent, "AGENTS.md"), "utf8")).toBe("\n");
		const policy = JSON.parse(await readFile(join(session.root, "policy.json"), "utf8"));
		expect(policy.allowed_tools).not.toContain("always");
	});

	it("loads everything when no harness is selected", async () => {
		// No harness is not an empty harness: it is how sessions behaved
		// before harnesses existed, so nobody who ignores them loses anything.
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-none-"));
		const session = await materializeManifest(manifest(null), "no-harness");
		expect((await readdir(join(session.agent, "skills"))).sort()).toEqual(["mine", "shared"]);
		const policy = JSON.parse(await readFile(join(session.root, "policy.json"), "utf8"));
		expect(policy.allowed_tools).toContain("deploy");
		expect(policy.allowed_tools).toContain("always");
	});

	it("matches on the name, so your own copy stays in the harness", async () => {
		// The team put `house-style` in Support; this user has pushed their
		// own. Resolution hands them theirs, and it is still in Support.
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-override-"));
		const own = {
			kind: "system_prompt",
			name: "house-style",
			org_unit_path: "acme.team.user",
			shadows: { org_unit_path: "acme.team" },
			files: [{ path: "F.md", content_b64: b64("MY VERSION") }],
		};
		const session = await materializeManifest(
			{
				user: { auth_user_id: "u", org_unit_path: "acme.team.user" },
				harness: support([{ kind: "system_prompt", name: "house-style" }]),
				assets: [own],
				boundary: {},
				model,
			} as unknown as Manifest,
			"override",
		);
		expect(await readFile(join(session.agent, "AGENTS.md"), "utf8")).toContain("MY VERSION");
	});

	it("hands the agent a drawing to show, already rendered", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-card-"));
		const session = await materializeManifest(manifest(support([])), "card");
		const card = JSON.parse(await readFile(join(session.root, "harness.json"), "utf8"));
		expect(card.name).toBe("Support");
		expect(card.description).toBe("Front line.");
		expect(card.lines).toHaveLength(8);
	});

	it("writes no drawing when no harness is selected", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-nocard-"));
		const session = await materializeManifest(manifest(null), "nocard");
		await expect(readFile(join(session.root, "harness.json"), "utf8")).rejects.toThrow();
	});
});
