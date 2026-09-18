import { mkdtemp, readFile, stat } from "node:fs/promises";
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
