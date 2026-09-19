import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Adapter } from "../src/adapters/types.js";

interface HarnessRow {
	id: string;
	name: string;
	org_unit_path: string;
}

let harnesses: HarnessRow[] = [];
let resolveCalls: string[] = [];
interface SpawnCall {
	command: string;
	argv: string[];
	env: Record<string, string>;
}
let spawnCalls: SpawnCall[] = [];

// Same trick `switch.test.ts` uses: the mock closes over these `let`s, so a
// `beforeEach` reassignment is visible the next time the mocked function runs.
vi.mock("../src/api.js", () => ({
	api: async (_credentials: unknown, path: string) => {
		if (path === "/v1/me") return { org_unit_id: "unit-1" };
		if (path.includes("/org-units/") && path.includes("/harnesses")) return harnesses;
		if (path.startsWith("/v1/resolve")) {
			resolveCalls.push(path);
			const match = path.match(/harness_id=([^&]+)/);
			const row = match ? harnesses.find((h) => h.id === decodeURIComponent(match[1])) : undefined;
			return {
				user: { auth_user_id: "u", org_unit_path: "acme" },
				harness: row
					? {
							id: row.id,
							name: row.name,
							description: "d",
							icon: { palette: [], rows: [] },
							org_unit_path: row.org_unit_path,
							assets: [],
						}
					: null,
				assets: [],
				boundary: {},
				model: { provider: "p", model_id: "m", base_url: "http://x", key_ref: "r", env_var: "E" },
			};
		}
		if (path === "/v1/sessions") return {};
		if (path === "/v1/api-keys/deliver") return [];
		throw new Error(`unexpected request: ${path}`);
	},
}));

vi.mock("../src/hydrate.js", () => ({ hydrate: async () => {} }));
vi.mock("../src/supervise.js", () => ({
	createSpool: async () => {},
	supervise: () => ({ stop: async () => {} }),
}));

// Never reassigned: the mocked module holds this exact object, so mutating
// its keys in `beforeEach` is what a fresh test's adapter set reaches.
const testAdapters: Record<string, Adapter> = {};
vi.mock("../src/adapters/registry.js", () => ({ adapters: testAdapters }));

vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	spawn: (command: string, argv: string[], opts: { env: Record<string, string> }) => {
		spawnCalls.push({ command, argv, env: opts.env });
		const child = new EventEmitter();
		queueMicrotask(() => child.emit("exit", 0, null));
		return child;
	},
}));

const { run } = await import("../src/index.js");
const { readSelection, writeSelection } = await import("../src/harness.js");

function fakeAdapter(id: string): Adapter {
	return {
		id,
		render: async () => {},
		launch: () => ({ argv: [`${id}-entry`], env: { ADAPTER_ID: id } }),
	};
}

const saved = { ...process.env };
beforeEach(async () => {
	process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-run-"));
	process.env.HARNESS_CREDENTIALS = join(process.env.HARNESS_HOME, "cfg.json");
	await writeFile(process.env.HARNESS_CREDENTIALS, JSON.stringify({ api_url: "http://x", token: "t" }));
	harnesses = [];
	resolveCalls = [];
	spawnCalls = [];
	for (const key of Object.keys(testAdapters)) delete testAdapters[key];
	testAdapters.pi = fakeAdapter("pi");
});

afterEach(() => {
	process.env = { ...saved };
	vi.restoreAllMocks();
});

describe("agent selection", () => {
	it("the agent word selects that adapter", async () => {
		testAdapters.claude = fakeAdapter("claude");
		expect(await run(["claude"])).toBe(0);
		expect(spawnCalls).toHaveLength(1);
		expect(spawnCalls[0].argv).toEqual([]);
		expect(spawnCalls[0].command).toBe("claude-entry");
		expect(spawnCalls[0].env.ADAPTER_ID).toBe("claude");
	});

	it("an unknown agent word errors and never launches", async () => {
		testAdapters.claude = fakeAdapter("claude");
		await expect(run(["nope"])).rejects.toThrow(/not an agent this CLI knows/);
		expect(spawnCalls).toHaveLength(0);
	});

	it("with no agent word and exactly one adapter, that one runs", async () => {
		expect(await run([])).toBe(0);
		expect(spawnCalls[0].env.ADAPTER_ID).toBe("pi");
	});

	it("with no agent word and more than one adapter, asks rather than guesses", async () => {
		testAdapters.claude = fakeAdapter("claude");
		await expect(run([])).rejects.toThrow(/Say which agent/);
		expect(spawnCalls).toHaveLength(0);
	});
});

describe("the harness flag", () => {
	it("resolves a bare name", async () => {
		harnesses = [{ id: "h-marketing", name: "Marketing", org_unit_path: "acme" }];
		expect(await run(["pi", "--marketing"])).toBe(0);
		expect(resolveCalls[0]).toContain("harness_id=h-marketing");
	});

	it("resolves a qualified org/name", async () => {
		harnesses = [{ id: "h1", name: "Support", org_unit_path: "acme.eng" }];
		expect(await run(["pi", "--acme.eng/Support"])).toBe(0);
		expect(resolveCalls[0]).toContain("harness_id=h1");
	});

	it("refuses an ambiguous bare name and lists the qualified form of each", async () => {
		harnesses = [
			{ id: "h1", name: "Support", org_unit_path: "acme.eng" },
			{ id: "h2", name: "Support", org_unit_path: "acme.sales" },
		];
		await expect(run(["pi", "--support"])).rejects.toThrow(/--acme\.eng\/Support[\s\S]*--acme\.sales\/Support/);
		expect(spawnCalls).toHaveLength(0);
	});

	it("errors on a harness name that is not one of yours", async () => {
		harnesses = [{ id: "h1", name: "Marketing", org_unit_path: "acme" }];
		await expect(run(["pi", "--billing"])).rejects.toThrow(/No harness called "billing"/);
		expect(spawnCalls).toHaveLength(0);
	});

	it("never writes the persisted selection", async () => {
		await writeSelection({ harness_id: "h-existing", name: "Existing" });
		harnesses = [
			{ id: "h-existing", name: "Existing", org_unit_path: "acme" },
			{ id: "h-marketing", name: "Marketing", org_unit_path: "acme" },
		];
		expect(await run(["pi", "--marketing"])).toBe(0);
		// The flag changed what this run loaded...
		expect(resolveCalls[0]).toContain("harness_id=h-marketing");
		// ...but `switch`'s file is exactly as it was before the run.
		expect(await readSelection()).toEqual({ harness_id: "h-existing", name: "Existing" });
	});
});

describe("-- passthrough", () => {
	it("everything after -- reaches the adapter's argv, untouched", async () => {
		expect(await run(["pi", "--", "--resume", "--flag"])).toBe(0);
		expect(spawnCalls[0].argv).toEqual(["--resume", "--flag"]);
		expect(spawnCalls[0].command).toBe("pi-entry");
	});
});

// agents.md §7.1.1, wired through the one place a child is actually created —
// which is why this belongs in `run`'s own suite rather than the enforcer's:
// it proves the wiring, not just the mechanism (test/enforcers/filesystem.test.ts
// covers the mechanism itself in isolation).
describe("team-tool deny-read enforcement", () => {
	it("wraps the launch with sandbox-exec when a hydrated tool has nothing in the manifest to grant it", async () => {
		// The mocked `/v1/resolve` above always returns `assets: []`, so any
		// tool directory already on disk is one the manifest no longer
		// mentions at all — exactly the fail-closed case agents.md §7.1.1
		// calls out, and it needs no boundary field to trigger.
		await mkdir(join(process.env.HARNESS_HOME as string, "assets", "tool", "deploy"), { recursive: true });
		expect(await run(["pi"])).toBe(0);
		expect(spawnCalls[0].command).toBe("/usr/bin/sandbox-exec");
		expect(spawnCalls[0].argv[0]).toBe("-p");
		expect(spawnCalls[0].argv[1]).toContain("tool/deploy");
		expect(spawnCalls[0].argv.slice(2)).toEqual(["pi-entry"]);
	});

	it("does not wrap the launch when nothing is hydrated to deny", async () => {
		expect(await run(["pi"])).toBe(0);
		expect(spawnCalls[0].command).toBe("pi-entry");
	});

	it("applies identically to --claude, since it wraps after launch() rather than inside any one adapter", async () => {
		testAdapters.claude = fakeAdapter("claude");
		await mkdir(join(process.env.HARNESS_HOME as string, "assets", "tool", "deploy"), { recursive: true });
		expect(await run(["claude"])).toBe(0);
		expect(spawnCalls[0].command).toBe("/usr/bin/sandbox-exec");
		expect(spawnCalls[0].argv[1]).toContain("tool/deploy");
		expect(spawnCalls[0].argv.slice(2)).toEqual(["claude-entry"]);
	});
});

// These paths are cheap to reach and easy to regress: each one is a refusal
// that must happen before any network call or spawn, so a mistake here shows
// up as the wrong agent launching rather than as an error.
describe("argument shape", () => {
	it("refuses a second agent word and points at `--`", async () => {
		await expect(run(["pi", "claude"])).rejects.toThrow(/one agent name/);
		expect(spawnCalls).toHaveLength(0);
	});

	it("refuses a second harness flag and names both", async () => {
		await expect(run(["pi", "--a", "--b"])).rejects.toThrow(/--a and --b/);
		expect(spawnCalls).toHaveLength(0);
	});

	it("does not mistake a reserved flag for a harness name", async () => {
		// `--help` reaching findHarness would fail against the API instead, so
		// asserting the spawn is what proves it was never treated as a name.
		harnesses = [{ id: "h1", name: "Marketing", org_unit_path: "acme" }];
		expect(await run(["pi", "--", "--help"])).toBe(0);
		expect(resolveCalls[0]).not.toContain("harness_id=");
		expect(spawnCalls[0].argv).toEqual(["--help"]);
		expect(spawnCalls[0].command).toBe("pi-entry");
	});
});
