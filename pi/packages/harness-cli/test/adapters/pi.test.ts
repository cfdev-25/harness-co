import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pi } from "../../src/adapters/pi.js";
import { type Manifest, sessionDir } from "../../src/core.js";
import { planModel } from "../../src/model.js";

const saved = { ...process.env };
afterEach(() => {
	process.env = { ...saved };
});

// The same wiring `run` does: pick a session id, derive its paths, resolve
// the model plan, hand the adapter a context. Kept local to the test so the
// adapter itself only ever sees the RenderContext shape it declares.
async function render(manifest: Manifest, id: string) {
	const root = sessionDir(id);
	const agent = join(root, "agent");
	await pi.render({ manifest, id, sessionDir: root, agentDir: agent, model: planModel(manifest, pi) });
	return { id, root, agent };
}

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
				wire_format: "openai-completions",
				key_ref: "secret://acme/default-provider",
				env_var: "PROVIDER_API_KEY",
			},
		};
		const session = await render(manifest, "session-id");
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
				wire_format: "openai-completions",
				key_ref: "r",
				env_var: "E",
			},
		} as unknown as Manifest;

		const session = await render(manifest, "ord");
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
			model: {
				provider: "p",
				model_id: "m",
				base_url: "http://x",
				wire_format: "openai-completions",
				key_ref: "r",
				env_var: "E",
			},
		} as unknown as Manifest;

		const session = await render(manifest, "saved");
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
	const model = {
		provider: "p",
		model_id: "m",
		base_url: "http://x",
		wire_format: "openai-completions",
		key_ref: "r",
		env_var: "E",
	};
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
		const session = await render(
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
		const session = await render(manifest(support([])), "empty");
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
		const session = await render(manifest(null), "no-harness");
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
		const session = await render(
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
		const session = await render(manifest(support([])), "card");
		const card = JSON.parse(await readFile(join(session.root, "harness.json"), "utf8"));
		expect(card.name).toBe("Support");
		expect(card.description).toBe("Front line.");
		expect(card.lines).toHaveLength(8);
	});

	it("writes no drawing when no harness is selected", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-nocard-"));
		const session = await render(manifest(null), "nocard");
		await expect(readFile(join(session.root, "harness.json"), "utf8")).rejects.toThrow();
	});
});

// agents.md §7.1.2: the server stores capabilities, never an agent's tool
// name. `policy.json` is Pi-specific rendering, so it still ends up with
// Pi's own names — that translation is what these tests pin down.
describe("capability vocabulary rendering", () => {
	const model = { provider: "p", model_id: "m", base_url: "http://x", key_ref: "r", env_var: "E" };

	it("a boundary that says process.exec renders to Pi's bash, and nothing else it didn't grant", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "cap-bash-"));
		const manifest = {
			user: { auth_user_id: "u", org_unit_path: "acme" },
			assets: [],
			boundary: { allowed_tools: ["process.exec"] },
			model,
		} as unknown as Manifest;
		const session = await render(manifest, "cap-bash");
		const policy = JSON.parse(await readFile(join(session.root, "policy.json"), "utf8"));
		expect(policy.allowed_tools).toContain("bash");
		expect(policy.allowed_tools).not.toContain("read");
		expect(policy.allowed_tools).not.toContain("edit");
	});

	it("a tool asset's capability is unchanged apart from the prefix", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "cap-tool-"));
		const manifest = {
			user: { auth_user_id: "u", org_unit_path: "acme" },
			assets: [{ kind: "tool", name: "slack_read", files: [] }],
			boundary: { allowed_tools: ["process.exec", "tool.slack_read"] },
			model,
		} as unknown as Manifest;
		const session = await render(manifest, "cap-tool");
		const policy = JSON.parse(await readFile(join(session.root, "policy.json"), "utf8"));
		expect(policy.allowed_tools).toContain("slack_read");
	});

	it("a tool asset present but not capability-granted is excluded even though the harness carries it", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "cap-tool-excluded-"));
		const manifest = {
			user: { auth_user_id: "u", org_unit_path: "acme" },
			assets: [{ kind: "tool", name: "deploy", files: [] }],
			boundary: { allowed_tools: ["process.exec"] },
			model,
		} as unknown as Manifest;
		const session = await render(manifest, "cap-tool-excluded");
		const policy = JSON.parse(await readFile(join(session.root, "policy.json"), "utf8"));
		expect(policy.allowed_tools).not.toContain("deploy");
	});

	it("renders deploy_tools' capabilities back to Pi/team-tool names the same way", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "cap-deploy-"));
		const manifest = {
			user: { auth_user_id: "u", org_unit_path: "acme" },
			assets: [{ kind: "tool", name: "deploy", files: [] }],
			boundary: { deploy_tools: ["tool.deploy"] },
			model,
		} as unknown as Manifest;
		const session = await render(manifest, "cap-deploy");
		const policy = JSON.parse(await readFile(join(session.root, "policy.json"), "utf8"));
		expect(policy.deploy_tools).toEqual(["deploy"]);
	});

	it("an unconstrained boundary still renders every Pi built-in, unchanged from before this vocabulary existed", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "cap-unconstrained-"));
		const manifest = {
			user: { auth_user_id: "u", org_unit_path: "acme" },
			assets: [],
			boundary: {},
			model,
		} as unknown as Manifest;
		const session = await render(manifest, "cap-unconstrained");
		const policy = JSON.parse(await readFile(join(session.root, "policy.json"), "utf8"));
		for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
			expect(policy.allowed_tools).toContain(name);
		}
	});
});

describe("native mode", () => {
	// agents.md §5.1/G13: a null `manifest.model` used to be pi.ts's own
	// crash ("No model is configured for your workspace."). It is now a
	// policy question src/model.ts answers before render ever runs, so a
	// "native" plan reaches this adapter exactly like Claude Code's already
	// did — this is the deliberate behaviour change 14.6 makes.
	it("boots with no model configured, writing neither settings.json nor models.json", async () => {
		process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-native-"));
		const root = sessionDir("native-id");
		const agent = join(root, "agent");
		const manifest = {
			user: { auth_user_id: "u", org_unit_path: "acme" },
			assets: [],
			boundary: { model_policy: { source: "none", user_credentials: "required" } },
			model: null,
		} as unknown as Manifest;
		await pi.render({ manifest, id: "native-id", sessionDir: root, agentDir: agent, model: { kind: "native" } });
		await expect(readFile(join(agent, "settings.json"), "utf8")).rejects.toThrow();
		await expect(readFile(join(agent, "models.json"), "utf8")).rejects.toThrow();
	});
});
