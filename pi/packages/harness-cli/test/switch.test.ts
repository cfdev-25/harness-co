import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let harnesses: unknown[] = [];

vi.mock("../src/api.js", () => ({
	api: async (_credentials: unknown, path: string) => {
		if (path === "/v1/me") return { org_unit_id: "unit-1" };
		if (path.includes("/harnesses")) return harnesses;
		throw new Error(`unexpected request: ${path}`);
	},
}));

const { switchHarness, readSelection, writeSelection } = await import("../src/harness.js");

const saved = { ...process.env };
let out: string[];
let errors: string[];

const drawing = { palette: ["#c8875a"], rows: Array<string>(16).fill("0".repeat(16)) };
const harness = (id: string, name: string, path: string) => ({
	id,
	name,
	description: "Front line questions.",
	icon: drawing,
	org_unit_path: path,
	assets: [{ kind: "skill", name: "triage" }],
});

beforeEach(async () => {
	process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-switch-"));
	process.env.HARNESS_CREDENTIALS = join(process.env.HARNESS_HOME, "cfg.json");
	await writeFile(process.env.HARNESS_CREDENTIALS, JSON.stringify({ api_url: "http://x", token: "t" }));
	out = [];
	errors = [];
	vi.spyOn(console, "log").mockImplementation((...parts) => out.push(parts.join(" ")));
	vi.spyOn(console, "error").mockImplementation((...parts) => errors.push(parts.join(" ")));
	harnesses = [harness("h-support", "Support", "acme.support")];
});

afterEach(() => {
	vi.restoreAllMocks();
	process.env = { ...saved };
});

describe("harness switch", () => {
	it("selects by name, case-insensitively, and shows what was chosen", async () => {
		expect(await switchHarness(["support"])).toBe(0);
		expect(await readSelection()).toEqual({ harness_id: "h-support", name: "Support" });
		const printed = out.join("\n");
		expect(printed).toContain("Support");
		expect(printed).toContain("acme.support");
		// The drawing came too: eight lines for sixteen rows.
		expect(printed.split("\n").length).toBeGreaterThanOrEqual(8);
	});

	it("hands an ambiguous name back instead of guessing", async () => {
		harnesses = [harness("h-1", "Support", "acme.eng"), harness("h-2", "Support", "acme.sales")];
		expect(await switchHarness(["Support"])).toBe(1);
		expect(await readSelection()).toBeUndefined();
		expect(errors.join("\n")).toContain("acme.eng/Support");
		expect(errors.join("\n")).toContain("acme.sales/Support");
	});

	it("resolves the ambiguity when the unit is named too", async () => {
		harnesses = [harness("h-1", "Support", "acme.eng"), harness("h-2", "Support", "acme.sales")];
		expect(await switchHarness(["acme.sales/Support"])).toBe(0);
		expect((await readSelection())?.harness_id).toBe("h-2");
	});

	it("says so when the name is not one of yours", async () => {
		expect(await switchHarness(["billing"])).toBe(1);
		expect(errors.join("\n")).toContain("acme.support/Support");
		expect(await readSelection()).toBeUndefined();
	});

	it("clears the selection with --none", async () => {
		await writeSelection({ harness_id: "h-support", name: "Support" });
		expect(await switchHarness(["--none"])).toBe(0);
		expect(await readSelection()).toBeUndefined();
	});

	it("lists rather than prompts when nothing can answer", async () => {
		const tty = process.stdin.isTTY;
		Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
		try {
			expect(await switchHarness([])).toBe(1);
			expect(errors.join("\n")).toContain("acme.support/Support");
		} finally {
			Object.defineProperty(process.stdin, "isTTY", { value: tty, configurable: true });
		}
	});

	it("reports an empty list without writing a selection", async () => {
		harnesses = [];
		expect(await switchHarness(["support"])).toBe(1);
		expect(errors.join("\n")).toContain("no harnesses yet");
		expect(await readSelection()).toBeUndefined();
	});

	it("ignores a selection file that has been damaged", async () => {
		await writeFile(join(process.env.HARNESS_HOME as string, "harness.json"), "{ not json");
		expect(await readSelection()).toBeUndefined();
	});
});
