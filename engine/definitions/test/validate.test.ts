import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Refusal, messages } from "../src/codes.js";
import { type Context, validate } from "../src/validate.js";
import { type World, seedBranch, seedCommit, seedOrg, world } from "./world.js";

/**
 * T1 `validate_rules_1_to_15`, the half that does not run through `compose()`:
 * steps 1, 2, 8, 10 and 15 are transport rules `compose()` does not know about
 * (02 §7). Steps 3–7, 9 and 11–14 are in compose-gated.test.ts.
 */
let here: World;
let repo: string;

const context = (over: Partial<Context> = {}): Context => ({
	repo,
	org: "acme",
	actor: "u-dana",
	internal: false,
	creating: false,
	env: {},
	quota: 2 * 1024 ** 3,
	...over,
});

const refused = async (over: Partial<Context>, ref: string, old: string, next: string): Promise<Refusal> => {
	try {
		await validate(context(over), { ref, old, new: next });
	} catch (error) {
		if (error instanceof Refusal) return error;
		throw error;
	}
	throw new Error("the push was not refused");
};

beforeAll(async () => {
	here = await world();
	repo = await seedOrg(here.root, "acme");
	await seedBranch(repo, "refs/heads/teams/acme.marketing", "acme.marketing");
	await seedBranch(repo, "refs/heads/users/u-dana", "acme.marketing.dana");
});

afterAll(async () => {
	await here.close();
});

it("rule 1: a push to any ref but the actor's own is definitions.not_your_ref", async () => {
	const head = await seedCommit(repo, "refs/heads/teams/acme.marketing", { "a.txt": "a" }, "a team change");
	const refusal = await refused({}, "refs/heads/teams/acme.marketing", head, head);
	expect(refusal.code).toBe("definitions.not_your_ref");
	expect(refusal.message).toBe(messages["definitions.not_your_ref"]());
});

it("rule 2: a history that is not a fast-forward, and a creation that is not /internal/branches", async () => {
	const ref = "refs/heads/users/u-dana";
	const first = await seedCommit(repo, ref, { "one.txt": "1" }, "one");
	const other = await seedCommit(repo, "refs/heads/org", { "two.txt": "2" }, "two");
	expect((await refused({}, ref, other, first)).code).toBe("definitions.not_fast_forward");
	expect((await refused({}, ref, "0".repeat(40), first)).code).toBe("definitions.not_fast_forward");
});

it("rule 8: every secret pattern in §7 step 8 is refused, and the path is named", async () => {
	const ref = "refs/heads/users/u-dana";
	const samples = [
		"secret://marketing/crm-api-key",
		"AKIAIOSFODNN7EXAMPLE",
		"-----BEGIN RSA PRIVATE KEY-----",
		"sk-abcdefghijklmnopqrstuvwxyz012345",
		`ghp_${"a".repeat(36)}`,
		"xoxb-1234",
	];
	for (const sample of samples) {
		const old = (await seedCommit(repo, ref, { "keep.txt": sample.slice(0, 3) }, "a base")).trim();
		const next = await seedCommit(repo, ref, { "assets/tool/leaky/leak.env": sample }, "a leak"); // the scan covers assets/** only (02 §7 step 8)
		const refusal = await refused({}, ref, old, next);
		expect(refusal.code, sample).toBe("definitions.secret_in_tree");
		expect(refusal.message).toBe(messages["definitions.secret_in_tree"]("assets/tool/leaky/leak.env"));
		// Undo, so the next sample starts from a tree with no leak in it.
		await seedCommit(repo, ref, { "assets/tool/leaky/leak.env": "clean" }, "cleaned");
	}
});

it("rule 10: policy on a user branch, and an org-only file on a team branch", async () => {
	const userRef = "refs/heads/users/u-dana";
	const old = await seedCommit(repo, userRef, { "keep.txt": "keep" }, "a base");
	const next = await seedCommit(repo, userRef, { "policy/boundaries.json": "[]" }, "policy on a personal version");
	const refusal = await refused({}, userRef, old, next);
	expect(refusal.code).toBe("definitions.policy_on_user_branch");
	expect(refusal.message).toBe(messages["definitions.policy_on_user_branch"]());

	const teamRef = "refs/heads/teams/acme.marketing";
	const teamOld = (await seedCommit(repo, teamRef, { "b.txt": "b" }, "a base")).trim();
	const teamNext = await seedCommit(repo, teamRef, { "policy/groups.json": "[]" }, "groups on a team");
	const orgOnly = await refused({ internal: true, actor: "u-rae" }, teamRef, teamOld, teamNext);
	expect(orgOnly.code).toBe("definitions.policy_invalid");
	expect(orgOnly.message).toContain("policy/groups.json:");
});

it("rule 15: a repo over DEFINITIONS_QUOTA_BYTES is definitions.quota", async () => {
	// A branch of its own: the rule 10 fixture left a policy file on Dana's.
	const ref = "refs/heads/users/u-kim";
	await seedBranch(repo, ref, "acme.marketing.kim");
	const old = await seedCommit(repo, ref, { "small.txt": "small" }, "a base");
	const next = await seedCommit(repo, ref, { "big.txt": "x".repeat(4096) }, "a big file");
	const refusal = await refused({ quota: 1, actor: "u-kim" }, ref, old, next);
	expect(refusal.code).toBe("definitions.quota");
});

it("validate_is_compose: no content rule is re-implemented here", () => {
	// Steps 3–7, 9 and 11–14 are compose()'s. If validate.ts ever parses a file
	// of its own, there are two answers to what a branch holds (02 §7, D2).
	const source = readFileSync(fileURLToPath(new URL("../src/validate.ts", import.meta.url)), "utf8");
	expect(source).not.toContain("JSON.parse");
	expect(source).toContain("await compose(chain, read)");
});
