import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compose } from "../src/compose.js";
import type { Chain, Grant, HarnessDef, SecurityGroup } from "../src/contracts.js";
import { fixtureCases, memoryFixture, normalise } from "../src/fixtures.js";
import { narrowingFault } from "../src/policy.js";
import { effectiveReach, reachAllows } from "../src/reach.js";

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
const cases = fixtureCases(FIXTURES);

/** The case by name, composed with no git at all (00 §10, tier T1). */
async function run(name: string) {
	const found = cases.find((entry) => entry.name === name);
	if (!found) throw new Error(`no fixture called ${name}`);
	const { reader, chain, symbols } = memoryFixture(found.dir);
	const composed = await compose(chain, reader);
	return { composed, expected: found.expected, actual: normalise(composed, symbols) };
}

describe("the conformance fixtures, T1", () => {
	it.each(cases.map((entry) => entry.name))("%s composes to its expected.json", async (name) => {
		const { expected, actual } = await run(name);
		expect(actual).toEqual(expected);
	});

	it("covers every case 01 §6 requires", () => {
		for (const required of [
			"single-org",
			"override-keeps-id",
			"rename-follows-id",
			"same-path-different-id",
			"duplicate-id",
			"narrowed-grant-valid",
			"narrowed-grant-outside-subtree",
			"narrowed-grant-alias-not-held",
			"boundary-union",
			"always-loaded",
			"harness-names-nothing",
			"no-policy-files",
			"reach-narrows",
			"reach-widened-conflict",
			"reach-grant-retired",
		])
			expect(cases.map((entry) => entry.name)).toContain(required);
	});
});

it("compose_is_deterministic", async () => {
	const first = await run("three-level-teams");
	const second = await run("three-level-teams");
	expect(second.composed).toEqual(first.composed);
	expect(second.composed.tree).toBe(first.composed.tree);
});

it("precedence_narrowest_wins", async () => {
	const { composed } = await run("three-level-teams");
	const deploy = composed.assets.find((asset) => asset.name === "deploy");
	expect(deploy?.from.path).toBe("acme.marketing.interns");
	// The shadows chain is one link: the copy this one overrides, not the root.
	expect(deploy?.shadows?.from.path).toBe("acme.marketing");
	const { composed: three } = await run("override-keeps-id");
	expect(three.assets[0].from.kind).toBe("user");
	expect(three.assets[0].shadows?.from.path).toBe("acme.marketing");
	expect(three.assets[0].id).toBe(three.assets[0].sidecar.id);
});

it("boundaries_union_root_first", async () => {
	const { composed } = await run("boundary-union");
	expect(composed.policy.boundaries.map((boundary) => boundary.id)).toEqual([
		"acme/no-prod-db",
		"acme.marketing/no-competitor-crm",
		"acme.marketing/no-rm",
	]);
	expect(composed.conflicts).toEqual([]);
});

it("no_policy_files_is_not_empty_policy", async () => {
	const { composed } = await run("no-policy-files");
	// C32: absent is not empty, and absent is not a fault either.
	expect(composed.policy.boundaries).toEqual([]);
	expect(composed.policy.grants).toEqual([]);
	expect(composed.conflicts).toEqual([]);
	expect(composed.assets).toEqual([]);
});

it("harness_naming_nothing_is_kept", async () => {
	const { composed } = await run("harness-names-nothing");
	// C18: the id that resolves to nothing stays on the definition; preflight reports it.
	expect(composed.harnesses[0].assets).toHaveLength(2);
	expect(composed.assets).toHaveLength(1);
	expect(composed.conflicts).toEqual([]);
});

it("always_loaded_must_be_an_organisation_asset", async () => {
	const { composed } = await run("always-loaded");
	// W5-D10: a bare array is the `required` list, and nothing is recommended.
	expect(composed.policy.required).toEqual(["0b7e4d2a-9c31-4f8e-b6a2-51d3c7e9f0a4"]);
	expect(composed.policy.recommended).toEqual([]);
	expect(composed.conflicts[0]).toMatchObject({ kind: "malformed", path: "policy/always-loaded.json" });
});

it("required_and_recommended_are_two_lists", async () => {
	const { composed } = await run("required-and-recommended");
	expect(composed.conflicts).toEqual([]);
	expect(composed.policy.required).toEqual(["0b7e4d2a-9c31-4f8e-b6a2-51d3c7e9f0a4"]);
	expect(composed.policy.recommended).toEqual(["1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"]);
});

it("harnessFrom names every node holding a definition, the winner last", async () => {
	// W5-D12: the boot screen's level line is this and nothing else.
	const { composed } = await run("harness-nearest-wins");
	expect(composed.harnessFrom["3e9d0f6a-1b2c-4d5e-8f70-9a1b2c3d4e5f"]).toEqual(["acme", "acme.marketing.dana"]);
});

it("unknown_kind_is_data_missing", async () => {
	const { composed } = await run("unknown-kind");
	expect(composed.conflicts).toEqual([
		{ kind: "unknown-kind", assetKind: "widget", path: "assets/widget/sprocket", from: composed.chain[0] },
	]);
});

it("duplicate_id_keeps_the_first_by_path_order", async () => {
	const { composed } = await run("duplicate-id");
	expect(composed.conflicts[0]).toMatchObject({
		kind: "duplicate-id-on-one-branch",
		paths: ["tool/deploy", "tool/ship"],
	});
	expect(composed.assets.map((asset) => asset.name)).toEqual(["deploy"]);
});

describe("narrowed_grant_clauses", () => {
	const groups: Record<string, SecurityGroup> = {
		marketing: {
			name: "marketing",
			entries: [
				{ alias: "crm", secret: { vault: "v", ref: "r" }, upstream: "https://a", attach: { header: "A", prefix: "B " } },
				{ alias: "email", secret: { vault: "v", ref: "s" }, upstream: "https://b", attach: { header: "A", prefix: "B " } },
			],
			sources: "vault",
		},
	};
	const node = { kind: "team" as const, path: "acme.marketing", ref: "r", commit: "c" };
	const source: Grant = { id: "g-marketing", scope: { teams: ["acme.marketing"] }, group: "marketing", by: "d" };
	// D132 retired `Grant.reach`, so clause (d)'s "the source grants no group"
	// case is now the only way a grant can hold none: a malformed one on a branch.
	const groupless = { id: "g-reach", scope: { teams: ["acme.marketing"] }, by: "d" } as Grant;
	const valid: Grant = {
		id: "g-interns",
		scope: { teams: ["acme.marketing.interns"] },
		group: "marketing",
		narrowedFrom: { grant: "g-marketing", aliases: ["crm"] },
		by: "rae",
	};

	it("a valid narrowing has no fault", () => {
		expect(narrowingFault(valid, node, [source, groupless], groups)).toBeNull();
	});

	// Each clause of §6 step 9 fails on its own, with the clause in the `why`.
	it.each([
		["(a)", { ...valid, narrowedFrom: { grant: "g-absent", aliases: ["crm"] } }, [source]],
		["(b)", { ...valid }, [{ ...source, scope: { teams: ["acme.eng"] } }]],
		["(c)", { ...valid, scope: { teams: ["acme.eng.x"] } }, [source]],
		["(d)", { ...valid, narrowedFrom: { grant: "g-reach", aliases: ["crm"] } }, [source, groupless]],
		["(e)", { ...valid, group: "other" }, [source]],
	])("clause %s fails alone and names itself", (clause, grant, held) => {
		const fault = narrowingFault(grant as Grant, node, held as Grant[], groups);
		expect(fault?.clause).toBe(clause.slice(1, 2));
		expect(fault?.why).toContain(clause);
	});

	it("a team grant with no narrowedFrom is refused before any clause", () => {
		const { narrowedFrom, ...bare } = valid;
		const fault = narrowingFault(bare as Grant, node, [source], groups);
		expect(fault).toMatchObject({ clause: "none" });
		expect(fault?.why).toContain("a team may only narrow");
	});

	it("a narrowing of a narrowing may not widen it back", () => {
		const middle: Grant = { ...valid, scope: { teams: ["acme.marketing.interns"] } };
		const deeper: Grant = {
			id: "g-deeper",
			scope: { teams: ["acme.marketing.interns.crew"] },
			group: "marketing",
			narrowedFrom: { grant: "g-interns", aliases: ["email"] },
			by: "rae",
		};
		const inner = { kind: "team" as const, path: "acme.marketing.interns", ref: "r", commit: "c" };
		expect(narrowingFault(deeper, inner, [source, middle], groups)?.clause).toBe("d");
	});
});

it("an invalid chain composes to nothing and one malformed conflict", async () => {
	const { reader } = memoryFixture(cases[0].dir);
	const chain: Chain = [{ kind: "team", path: "acme.marketing", ref: "r", commit: "org" }];
	const composed = await compose(chain, reader);
	expect(composed.assets).toEqual([]);
	expect(composed.conflicts).toHaveLength(1);
	expect(composed.conflicts[0]).toMatchObject({ kind: "malformed", path: "<chain>" });
});

it("an invalid grant carries the clause that failed, as data", async () => {
	const outside = await run("narrowed-grant-outside-subtree");
	const alias = await run("narrowed-grant-alias-not-held");
	// 02 §10 picks grant_outside_subtree from (c) and grant_widens from the rest.
	expect(outside.composed.conflicts[0]).toMatchObject({ kind: "invalid-grant", clause: "c" });
	// (d) is `grant_widens` itself, so the contract's union may not stop at "c".
	expect(alias.composed.conflicts[0]).toMatchObject({ kind: "invalid-grant", clause: "d" });
});

// --- reach (D131, D132) -----------------------------------------------------

it("reach_narrows_down_the_chain", async () => {
	const { composed } = await run("reach-narrows");
	// The organisation reaches everything but its deny-list; marketing keeps two
	// hosts and nothing else, and the team is who a person must ask.
	expect(composed.policy.reach).toEqual({
		mode: "allow",
		hosts: ["pypi.org", "files.pythonhosted.org"],
		setBy: "acme.marketing",
	});
	expect(composed.conflicts).toEqual([]);
});

it("reach_widened_is_a_conflict_and_the_parent_stands", async () => {
	const { composed } = await run("reach-widened-conflict");
	expect(composed.policy.reach).toEqual({ mode: "allow", hosts: ["pypi.org"], setBy: "acme" });
	expect(composed.conflicts).toHaveLength(1);
	expect(composed.conflicts[0]).toMatchObject({ kind: "reach-widened", at: "acme.marketing" });
});

it("reach_grant_is_retired", async () => {
	const { composed } = await run("reach-grant-retired");
	// It grants nothing and it is not read as reach either: one conflict, and
	// the group grant beside it is untouched.
	expect(composed.conflicts).toEqual([
		{ kind: "reach-grant-retired", grant: "g-web-mkt", from: composed.chain[0] },
	]);
	expect(composed.policy.grants.map((grant) => grant.id)).toEqual(["g-marketing"]);
	expect(composed.policy.reach.mode).toBe("off");
});

it("a harness takes the last narrowing step", async () => {
	const { composed } = await run("reach-narrows");
	const off = { id: "8c1f0d2b-4a6e-4c31-9b7d-2e5a0f3c8d19", reach: { mode: "off" as const, hosts: [] } };
	expect(effectiveReach(composed.policy.reach, off)).toEqual({
		mode: "off",
		hosts: [],
		setBy: `harness:${off.id}`,
	});
	// A harness that widens is ignored the same way a node that widens is.
	const wide = { id: off.id, reach: { mode: "on" as const, hosts: [] } };
	expect(effectiveReach(composed.policy.reach, wide)).toEqual(composed.policy.reach);
	expect(effectiveReach(composed.policy.reach, null)).toEqual(composed.policy.reach);
});

it("a harness whose reach widens is a conflict at compose", async () => {
	const { reader, chain } = memoryFixture(cases.find((entry) => entry.name === "reach-narrows")!.dir);
	const composed = await compose(chain, reader);
	// The fixture holds no harness, so the walk is asserted directly on the rule
	// the composer uses; `effectiveReach` above is the value half of the same one.
	const harness = { id: "x", reach: { mode: "on", hosts: [] } } as unknown as HarnessDef;
	expect(effectiveReach(composed.policy.reach, harness)).toEqual(composed.policy.reach);
});

it("reach_matches_by_name_and_by_subdomain", () => {
	const allow = { mode: "allow" as const, hosts: ["pypi.org", "*.githubusercontent.com"] };
	expect(reachAllows(allow, "pypi.org")).toEqual({ ok: true });
	expect(reachAllows(allow, "objects.githubusercontent.com")).toEqual({ ok: true });
	// `*.suffix` is subdomains, never the apex (D77's rule, one copy).
	expect(reachAllows(allow, "githubusercontent.com")).toEqual({ ok: false, reason: "reach.not-listed" });
	expect(reachAllows({ mode: "off", hosts: [] }, "pypi.org")).toEqual({ ok: false, reason: "reach.off" });
	const on = { mode: "on" as const, hosts: ["*.example.com"] };
	expect(reachAllows(on, "a.example.com")).toEqual({ ok: false, reason: "reach.denied" });
	expect(reachAllows(on, "pypi.org")).toEqual({ ok: true });
});
