import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withBrief } from "../src/core.js";
import harnessExtension from "../src/index.js";

// The same minimal stand-in `audit-spool.test.ts` uses, for the two handlers
// this file drives: `session_start` reads the brief, `before_agent_start`
// returns it.
function fakePi() {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pi = {
		on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, handler),
		registerCommand: () => {},
		getActiveTools: () => ["read"],
		setActiveTools: () => {},
	};
	const ctx = { cwd: process.cwd(), hasUI: false, ui: { notify: () => {}, confirm: async () => false } };
	harnessExtension(pi as never);
	const fire = (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx);
	return { fire };
}

const previous = { session: process.env.HARNESS_SESSION_DIR, agent: process.env.PI_CODING_AGENT_DIR };
afterEach(() => {
	process.env.HARNESS_SESSION_DIR = previous.session;
	process.env.PI_CODING_AGENT_DIR = previous.agent;
});

async function agentDir(brief?: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "harness-brief-"));
	process.env.HARNESS_SESSION_DIR = dir;
	process.env.PI_CODING_AGENT_DIR = dir;
	const policy: Record<string, unknown> = { allowed: ["read"], confirm: [], denies: [] };
	if (brief !== undefined) {
		await writeFile(join(dir, "system-prompt.md"), brief);
		policy.system_prompt_file = join(dir, "system-prompt.md");
	}
	await writeFile(join(dir, "policy.json"), JSON.stringify(policy));
	return dir;
}

describe("withBrief (W5-D11, 07 D137)", () => {
	it("puts the runtime's prompt first and the harness's brief after it", () => {
		expect(withBrief("You are Pi.", "Say what you made.")).toBe("You are Pi.\n\nSay what you made.");
	});

	it("changes nothing when there is no brief", () => {
		expect(withBrief("You are Pi.", "")).toBeUndefined();
		expect(withBrief("You are Pi.", "   \n ")).toBeUndefined();
	});
});

describe("before_agent_start", () => {
	it("returns the runtime's prompt followed by the brief when the file is there", async () => {
		await agentDir("## harness\n\nNever write a credential.\n");
		const { fire } = fakePi();
		await fire("session_start");
		const result = (await fire("before_agent_start", { systemPrompt: "You are Pi." })) as { systemPrompt: string };
		expect(result.systemPrompt).toBe("You are Pi.\n\n## harness\n\nNever write a credential.");
	});

	it("returns nothing when the file is absent, so the runtime's prompt stands", async () => {
		await agentDir();
		const { fire } = fakePi();
		await fire("session_start");
		expect(await fire("before_agent_start", { systemPrompt: "You are Pi." })).toBeUndefined();
	});

	it("returns nothing when the file is there and empty — a harness with no brief", async () => {
		await agentDir("");
		const { fire } = fakePi();
		await fire("session_start");
		expect(await fire("before_agent_start", { systemPrompt: "You are Pi." })).toBeUndefined();
	});
});
