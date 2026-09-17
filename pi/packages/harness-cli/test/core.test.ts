import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frontmatterName, type Manifest, materializeManifest, writeCredentials } from "../src/core.js";

describe("credentials", () => {
	it("writes credentials with owner-only permissions", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-test-"));
		await writeCredentials({ api_url: "http://example.test", token: "hpat_test" }, home);
		const path = join(home, "credentials.json");
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(JSON.parse(await readFile(path, "utf8")).token).toBe("hpat_test");
	});
});

describe("materialization", () => {
	it("writes models, skills, memories, policy, and manifest", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-session-"));
		const manifest: Manifest = {
			user: { auth_user_id: "user", org_unit_path: "acme.team.user" },
			skills: [
				{
					name: "catch-up",
					files: [{ path: "SKILL.md", content_b64: Buffer.from("# Skill").toString("base64") }],
				},
			],
			memories: [
				{
					name: "defaults",
					files: [{ path: "memory.md", content_b64: Buffer.from("Be concise.").toString("base64") }],
				},
			],
			tools: [{ name: "slack_read" }],
			boundary: { approvals: { deploy: "required" } },
			model: {
				provider: "openai-compatible",
				model_id: "example-model",
				base_url: "https://api.example.com/v1",
				key_ref: "secret://acme/default-provider",
				env_var: "PROVIDER_API_KEY",
			},
		};
		const session = await materializeManifest(manifest, home, "session-id");
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
