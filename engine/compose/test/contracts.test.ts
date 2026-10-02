import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Chain, Composed, HarnessProvider } from "../src/contracts.js";
import { SPECS, readJson } from "../src/policy.js";
import { memoryFixture } from "../src/fixtures.js";
import { compose, covers } from "../src/index.js";

const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));

const chain: Chain = [
	{ kind: "org", path: "acme", ref: "refs/heads/org", commit: "org" },
	{ kind: "user", path: "acme.dana", ref: "refs/heads/users/u", commit: "u" },
];

describe("the contracts compile and describe the shapes 00 §4 names", () => {
	it("a Chain is root first, narrowest last", () => {
		expect(chain[0].kind).toBe("org");
		expect(chain[chain.length - 1].kind).toBe("user");
	});

	// Nothing here asserts a field list: `tsc` does that, and this is the
	// runtime half — that a `Composed` literal built from the contracts is
	// a plain object with no runtime import behind it.
	it("a Composed carries the chain, the conflicts and the tree", () => {
		const composed: Composed = {
			chain,
			assets: [],
			conflicts: [],
			policy: {
				boundaries: [],
				grants: [],
				groups: {},
				modelProviders: {},
				harnessProviders: {},
				routing: { defaultFor: { teams: {}, harnesses: {}, providers: {} }, approvedFor: { teams: {}, harnesses: {}, providers: {} } },
				kinds: [],
				required: [],
				recommended: [],
			},
			harnesses: [],
			tree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
		};
		expect(composed.conflicts).toEqual([]);
	});
});

// W6-D3. A runtime says what it is called, on the contract and in the file.
describe("a harness provider carries its own name", () => {
	const spec = SPECS["harness-providers.json"];
	const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
	const row = (extra: Record<string, unknown>) => [
		{
			id: "pi",
			approval: "approved",
			scope: { teams: "all" },
			pin: { repo: "pi", commit: "60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759" },
			speaks: ["anthropic-messages"],
			...extra,
		},
	];

	it("accepts a row with a name", () => {
		const read = readJson(bytes(row({ name: "Pi" })), spec, "harness-providers.json");
		expect(read).not.toHaveProperty("why");
		expect(((read as { value: HarnessProvider[] }).value)[0].name).toBe("Pi");
	});

	it("accepts a row without one: every organisation seeded before W6-D3 holds those", () => {
		expect(readJson(bytes(row({})), spec, "harness-providers.json")).not.toHaveProperty("why");
	});

	it("refuses a name that is not a string, and still refuses an unknown key", () => {
		expect(readJson(bytes(row({ name: 7 })), spec, "harness-providers.json")).toMatchObject({
			why: expect.stringContaining("name must be a string"),
		});
		expect(readJson(bytes(row({ label: "Pi" })), spec, "harness-providers.json")).toMatchObject({
			why: expect.stringContaining("label"),
		});
	});

	it("every runtime in the presets has one: 01 §4.2 requires it of ours", () => {
		const presets = JSON.parse(
			readFileSync(fileURLToPath(new URL("../presets/harness-providers.json", import.meta.url)), "utf8"),
		) as Array<{ id: string; name?: string }>;
		expect(presets.map((each) => each.name)).toEqual(["Pi", "Claude Code"]);
	});
});

describe("the M1 entry points do the work", () => {
	it("compose never throws for a content fault: an invalid chain is a conflict", async () => {
		const { reader } = memoryFixture(join(fixtures, "single-org"));
		const composed = await compose([], reader);
		expect(composed.conflicts[0]).toMatchObject({ kind: "malformed", path: "<chain>" });
	});

	it("covers evaluates a scope against a chain", () => {
		expect(covers({ teams: "all" }, chain, null)).toBe(true);
	});
});

// 01 §6: a directory with no expected.json is not a case. Every case 01 names
// is here, and the runner is exported so `definitions` and the console run the
// same ones (00 §10).
describe("the conformance fixtures directory", () => {
	const cases = readdirSync(fixtures, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.filter((entry) => existsSync(join(fixtures, entry.name, "expected.json")))
		.map((entry) => entry.name);

	it("holds every case, and each carries a chain", () => {
		expect(cases.length).toBeGreaterThanOrEqual(12);
		for (const name of cases) expect(existsSync(join(fixtures, name, "chain.json"))).toBe(true);
	});
});
