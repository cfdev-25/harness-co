import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import harnessExtension from "../src/index.js";

// 08 §11.1: the landing is drawn by the CLI's own renderer, imported by the
// path `policy.json` names, at the width Pi hands the header.
type Factory = () => { render: (width: number) => string[] };

function fakePi(mode: string) {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pi = { on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, handler), registerCommand: () => {}, getActiveTools: () => [], setActiveTools: () => {} };
	let header: Factory | undefined;
	const notes: string[] = [];
	const ctx = { cwd: process.cwd(), hasUI: true, mode, ui: { notify: (line: string) => notes.push(line), confirm: async () => false, setHeader: (factory: Factory) => { header = factory; } } };
	harnessExtension(pi as never);
	return { fire: (name: string, event: unknown = {}) => handlers.get(name)?.(event, ctx), header: () => header, notes };
}

const previous = { session: process.env.HARNESS_SESSION_DIR, agent: process.env.PI_CODING_AGENT_DIR };
afterEach(() => {
	process.env.HARNESS_SESSION_DIR = previous.session;
	process.env.PI_CODING_AGENT_DIR = previous.agent;
});

async function agentDir(landing: Record<string, unknown> | undefined): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "harness-landing-"));
	process.env.HARNESS_SESSION_DIR = dir;
	process.env.PI_CODING_AGENT_DIR = dir;
	await writeFile(join(dir, "policy.json"), JSON.stringify({ allowed: [], confirm: [], denies: [], ...(landing ? { landing } : {}) }));
	return dir;
}

describe("the landing as Pi's header", () => {
	it("imports the renderer the policy names and draws the frame at the width it is given", async () => {
		const dir = await agentDir(undefined);
		const module = join(dir, "landing.mjs");
		await writeFile(module, "export const landingLines = (frame, width, mode) => [`${frame.name} at ${width} in ${mode}`];\n");
		await writeFile(join(dir, "policy.json"), JSON.stringify({ allowed: [], confirm: [], denies: [], landing: { module, mode: "mono", frame: { name: "support" } } }));
		const { fire, header } = fakePi("tui");
		await fire("session_start");
		expect(header()).toBeDefined();
		expect(header()?.().render(72)).toEqual(["support at 72 in mono"]);
	});

	it("sets no header without a landing, or outside the TUI", async () => {
		await agentDir(undefined);
		const none = fakePi("tui");
		await none.fire("session_start");
		expect(none.header()).toBeUndefined();
		await agentDir({ module: "/nowhere/landing.js", mode: "mono", frame: {} });
		const print = fakePi("print");
		await print.fire("session_start");
		expect(print.header()).toBeUndefined();
	});

	it("warns and goes on when the renderer cannot be imported", async () => {
		await agentDir({ module: "/nowhere/landing.js", mode: "mono", frame: {} });
		const { fire, header, notes } = fakePi("tui");
		await fire("session_start");
		expect(header()).toBeUndefined();
		expect(notes.some((line) => line.startsWith("Harness could not draw its landing"))).toBe(true);
	});
});
