import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Refusal } from "../src/codes.js";
import { validate } from "../src/validate.js";
import { type World, seedBranch, seedCommit, seedOrg, world } from "./world.js";

/**
 * T1 `validate_is_compose` and the compose half of `validate_rules_1_to_15`:
 * every row of 02 §7.1, one fixture each, refusing with the named code. Each
 * fixture gets a branch of its own so no rule can be satisfied by another's
 * leftovers.
 */
let here: World;
let repo: string;

const teamAsset = randomUUID();

beforeAll(async () => {
	here = await world();
	repo = await seedOrg(here.root, "acme");
	await seedCommit(
		repo,
		"refs/heads/org",
		{
			"policy/kinds.json": '["tool"]',
			"policy/groups.json": JSON.stringify([
				{
					name: "marketing",
					entries: [
						{
							alias: "crm",
							secret: { vault: "aws-prod", ref: "marketing/crm" },
							upstream: "https://api.crm.example",
							attach: { header: "Authorization", prefix: "Bearer " },
						},
					],
					sources: "vault",
				},
			]),
			"policy/grants.json": JSON.stringify([
				{ id: "g-mkt", scope: { teams: ["acme.marketing"] }, group: "marketing", by: "rae@acme.co" },
			]),
		},
		"the org's policy",
	);
	await seedBranch(repo, "refs/heads/teams/acme.marketing", "acme.marketing");
	await seedCommit(
		repo,
		"refs/heads/teams/acme.marketing",
		{ "assets/tool/deploy/asset.json": JSON.stringify({ id: teamAsset, kind: "tool" }) },
		"the team's deploy tool",
	);
});

afterAll(async () => {
	await here.close();
});

/** One user branch carrying `files`, validated as that person's own push. */
async function onBranch(who: string, files: Record<string, string>): Promise<Refusal> {
	const ref = `refs/heads/users/${who}`;
	await seedBranch(repo, ref, `acme.marketing.${who}`);
	const old = await seedCommit(repo, ref, { "keep.txt": "keep" }, "a base");
	const next = await seedCommit(repo, ref, files, "a change");
	try {
		await validate({ repo, org: "acme", actor: who, internal: false, creating: false, env: {}, quota: 2 * 1024 ** 3 }, { ref, old, new: next });
	} catch (error) {
		if (error instanceof Refusal) return error;
		throw error;
	}
	throw new Error("the push was not refused");
}

async function onTeam(team: string, files: Record<string, string>): Promise<Refusal> {
	const ref = `refs/heads/teams/${team}`;
	await seedBranch(repo, ref, team);
	const old = await seedCommit(repo, ref, { "keep.txt": "keep" }, "a base");
	const next = await seedCommit(repo, ref, files, "a change");
	try {
		await validate({ repo, org: "acme", actor: "u-rae", internal: true, creating: false, env: {}, quota: 2 * 1024 ** 3 }, { ref, old, new: next });
	} catch (error) {
		if (error instanceof Refusal) return error;
		throw error;
	}
	throw new Error("the push was not refused");
}

it("rule 5: a directory with no asset.json is definitions.sidecar_missing", async () => {
	const refusal = await onBranch("u-a", { "assets/tool/orphan/run": "#!/bin/sh\n" });
	expect(refusal.code).toBe("definitions.sidecar_missing");
	expect(refusal.message).toContain("has no asset.json");
});

it("rule 5: a sidecar that does not validate is definitions.sidecar_invalid", async () => {
	const refusal = await onBranch("u-b", { "assets/tool/thing/asset.json": JSON.stringify({ id: "not-a-uuid", kind: "tool" }) });
	expect(refusal.code).toBe("definitions.sidecar_invalid");
	expect(refusal.message).toContain("asset.json:");
});

it("rule 6: a kind absent from kinds.json is definitions.unknown_kind", async () => {
	const refusal = await onBranch("u-c", { "assets/gadget/thing/asset.json": JSON.stringify({ id: randomUUID(), kind: "gadget" }) });
	expect(refusal.code).toBe("definitions.unknown_kind");
	expect(refusal.message).toBe('"gadget" is not a kind this organization uses. Kinds: tool.');
});

it("rule 7: one id twice on one branch is definitions.duplicate_id", async () => {
	const twice = randomUUID();
	const refusal = await onBranch("u-d", {
		"assets/tool/one/asset.json": JSON.stringify({ id: twice, kind: "tool" }),
		"assets/tool/two/asset.json": JSON.stringify({ id: twice, kind: "tool" }),
	});
	expect(refusal.code).toBe("definitions.duplicate_id");
	expect(refusal.message).toContain(twice);
});

it("rule 9: a new id at a path a wider node holds is definitions.id_conflict", async () => {
	const refusal = await onBranch("u-e", { "assets/tool/deploy/asset.json": JSON.stringify({ id: randomUUID(), kind: "tool" }) });
	expect(refusal.code).toBe("definitions.id_conflict");
	expect(refusal.message).toContain("already exists on acme.marketing with a different id");
});

it("rule 14: a harness file that is not a HarnessDef is definitions.policy_invalid", async () => {
	const refusal = await onBranch("u-f", { [`harnesses/${randomUUID()}.json`]: JSON.stringify({ id: "nope" }) });
	expect(refusal.code).toBe("definitions.policy_invalid");
	expect(refusal.message).toMatch(/^harnesses\/.*: /);
});

it("narrowed_grant_subset_only: outside the subtree, and holding what it was never given", async () => {
	const outside = await onTeam("acme.sales", {
		"policy/grants.json": JSON.stringify([
			{
				id: "g-out",
				scope: { teams: ["acme.marketing.interns"] },
				group: "marketing",
				narrowedFrom: { grant: "g-mkt", aliases: ["crm"] },
				by: "rae@acme.co",
			},
		]),
	});
	// `acme.sales` is not reached by g-mkt at all, so clause (b) answers first.
	expect(outside.code).toBe("definitions.grant_widens");

	const notInside = await onTeam("acme.marketing.interns", {
		"policy/grants.json": JSON.stringify([
			{
				id: "g-elsewhere",
				scope: { teams: ["acme.sales"] },
				group: "marketing",
				narrowedFrom: { grant: "g-mkt", aliases: ["crm"] },
				by: "rae@acme.co",
			},
		]),
	});
	expect(notInside.code).toBe("definitions.grant_outside_subtree");
	expect(notInside.message).toContain("A team admin may only grant or bound within their own team.");

	const unheld = await onTeam("acme.marketing.design", {
		"policy/grants.json": JSON.stringify([
			{
				id: "g-more",
				scope: { teams: ["acme.marketing.design.web"] },
				group: "marketing",
				narrowedFrom: { grant: "g-mkt", aliases: ["email"] },
				by: "rae@acme.co",
			},
		]),
	});
	expect(unheld.code).toBe("definitions.grant_widens");
	expect(unheld.message).toContain("A narrowed grant can only remove entries.");
});
