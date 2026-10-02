import { expect, it } from "vitest";
import type { Chain } from "../src/contracts.js";
import { covers, scopeSpecificity } from "../src/scope.js";

/** 03 §5.1. `api` carries a Python twin of this table (04). */
const chain: Chain = [
	{ kind: "org", path: "acme", ref: "refs/heads/org", commit: "c0" },
	{ kind: "team", path: "acme.marketing", ref: "refs/heads/teams/acme.marketing", commit: "c1" },
	{ kind: "team", path: "acme.marketing.interns", ref: "refs/heads/teams/acme.marketing.interns", commit: "c2" },
	{ kind: "user", path: "acme.marketing.interns.dana", ref: "refs/heads/users/dana", commit: "c3" },
];

it("covers_matches_prd_scoping_table", () => {
	expect(covers({ teams: "all" }, chain, null)).toBe(true);
	expect(covers({ teams: ["acme.marketing"] }, chain, null)).toBe(true);
	expect(covers({ teams: ["acme.eng"] }, chain, null)).toBe(false);
	// The org path is not a team node, so naming it reaches nobody.
	expect(covers({ teams: ["acme"] }, chain, null)).toBe(false);
	// A user path is never a scope target.
	expect(covers({ teams: ["acme.marketing.interns.dana"] }, chain, null)).toBe(false);
	expect(covers({ teams: "all", harnesses: ["h1"] }, chain, null)).toBe(false);
	expect(covers({ teams: "all", harnesses: ["h1"] }, chain, "h1")).toBe(true);
	expect(covers({ teams: "all", harnesses: ["h1"] }, chain, "h2")).toBe(false);
});

it("scopeSpecificity orders broad before narrow", () => {
	expect(scopeSpecificity({ teams: "all" }, chain)).toEqual([-1, 0]);
	expect(scopeSpecificity({ teams: "all", harnesses: ["h1"] }, chain)).toEqual([-1, 1]);
	expect(scopeSpecificity({ teams: ["acme.marketing"] }, chain)).toEqual([1, 0]);
	expect(scopeSpecificity({ teams: ["acme.marketing", "acme.marketing.interns"] }, chain)).toEqual([2, 0]);
});
