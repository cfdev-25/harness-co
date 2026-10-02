import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import harnessExtension from "../src/index.js";

// Minimal stand-in for the parts of the Pi extension API this extension uses.
function fakePi() {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pi = {
		on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, handler),
		registerCommand: () => {},
		getActiveTools: () => ["read"],
		setActiveTools: () => {},
	};
	const ctx = { cwd: process.cwd(), hasUI: false, ui: { notify: () => {}, confirm: async () => false } };
	harnessExtension(pi as any);
	const fire = (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx);
	return { fire };
}

const previous = { session: process.env.HARNESS_SESSION_DIR, agent: process.env.PI_CODING_AGENT_DIR };
afterEach(() => {
	process.env.HARNESS_SESSION_DIR = previous.session;
	process.env.PI_CODING_AGENT_DIR = previous.agent;
});

describe("audit spool", () => {
	it("appends tool calls to audit.jsonl, with no network", async () => {
		const dir = await mkdtemp(join(tmpdir(), "harness-audit-"));
		process.env.HARNESS_SESSION_DIR = dir;
		process.env.PI_CODING_AGENT_DIR = dir;
		await writeFile(join(dir, "policy.json"), JSON.stringify({ allowed: ["read"], confirm: [], denies: [] }));

		const { fire } = fakePi();
		await fire("session_start");
		for (const id of ["1", "2"]) {
			await fire("tool_call", { toolName: "read", toolCallId: id, input: { path: "a.md" } });
			fire("tool_result", { toolCallId: id, content: [], details: {}, isError: false });
		}
		await fire("session_shutdown");

		const lines = (await readFile(join(dir, "audit.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		expect(lines).toHaveLength(2);
		// Every spooled line is a valid /v1/audit/batch AttestedEvent: action, payload, occurred_at.
		for (const line of lines) {
			expect(line).toMatchObject({ action: "tool.call", payload: { tool: "read", ok: true } });
			expect(typeof line.occurred_at).toBe("string");
		}
	});
});
