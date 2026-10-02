import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gitOut } from "../src/git.js";
import { type World, asToken, person, run, seedBranch, seedCommit, seedOrg, world } from "./world.js";

/** T4, 02 §13: the named tests whose subject is a whole push or internal
    commit — pre-receive through `compose()`, post-receive through the index. */

const icon = { palette: ["#000000"], rows: Array.from({ length: 16 }, () => ".".repeat(16)) };
const sidecar = (id: string, kind: string) => JSON.stringify({ id, kind });

describe("02 §13, end to end", () => {
	let here: World;
	let repo: string;
	const teamAsset = randomUUID();
	const harnessId = randomUUID();

	const asService = (body?: unknown): RequestInit => ({
		method: body === undefined ? "GET" : "POST",
		headers: { authorization: `Bearer ${here.api.token}`, "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	beforeAll(async () => {
		here = await world();
		repo = await seedOrg(here.root, "acme");
		await seedCommit(repo, "refs/heads/org", { "policy/kinds.json": '["tool"]' }, "the kinds this org uses");
		await seedBranch(repo, "refs/heads/teams/acme.marketing", "acme.marketing");
		await seedCommit(
			repo,
			"refs/heads/teams/acme.marketing",
			{ "assets/tool/deploy/asset.json": sidecar(teamAsset, "tool"), "assets/tool/deploy/run": "#!/bin/sh\n" },
			"the team's deploy tool",
		);
		await seedBranch(repo, "refs/heads/users/u-dana", "acme.marketing.dana");
		here.api.principals.set(
			"dana",
			person("u-dana", "acme", [
				["org", "acme", "refs/heads/org"],
				["team", "acme.marketing", "refs/heads/teams/acme.marketing"],
				["user", "acme.marketing.dana", "refs/heads/users/u-dana"],
			]),
		);
	});

	afterAll(async () => {
		await here.close();
	});

	const push = async (files: Record<string, string>, message: string) => {
		const work = join(here.scratch, `push-${randomUUID()}`);
		const origin = `${here.url}/acme.git`;
		await run(here.scratch, [...asToken("dana"), "clone", "--quiet", origin, work]);
		await run(work, ["config", "user.email", "dana@acme.co"]);
		await run(work, ["config", "user.name", "Dana"]);
		await run(work, ["checkout", "--quiet", "-B", "mine", "origin/users/u-dana"]);
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(join(work, path.split("/").slice(0, -1).join("/")), { recursive: true });
			writeFileSync(join(work, path), content);
		}
		await run(work, ["add", "-A"]);
		await run(work, ["commit", "--quiet", "-m", message]);
		return run(work, [...asToken("dana"), "push", "origin", "HEAD:refs/heads/users/u-dana"]);
	};

	it("prereceive_accepts_override_with_team_id", async () => {
		const result = await push(
			{ "assets/tool/deploy/asset.json": sidecar(teamAsset, "tool"), "assets/tool/deploy/run": "#!/bin/sh\necho mine\n" },
			"my own deploy",
		);
		expect(result.code, result.stderr).toBe(0);
		const effective = here.api.index.at(-1)?.rows as { idx_effective: Array<{ asset_id: string; shadows_path: string | null }> };
		const row = effective.idx_effective.find((each) => each.asset_id === teamAsset);
		expect(row?.shadows_path).toBe("acme.marketing");
	});

	it("prereceive_refuses_new_id_at_existing_path", async () => {
		const result = await push(
			{ "assets/tool/deploy/asset.json": sidecar(randomUUID(), "tool") },
			"a new id at the team's path",
		);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("already exists on acme.marketing with a different id");
	});

	it("promote_reaches_members", async () => {
		const tip = (await gitOut(repo, ["rev-parse", "refs/heads/users/u-dana"])).trim();
		const head = (await gitOut(repo, ["rev-parse", "refs/heads/teams/acme.marketing"])).trim();
		const response = await fetch(
			`${here.url}/internal/commit`,
			asService({
				org_id: "acme",
				ref: "refs/heads/teams/acme.marketing",
				expectedHead: head,
				author: { userId: "u-rae", name: "Rae", email: "rae@acme.co" },
				message: "promote deploy",
				changes: [{ path: "assets/tool/deploy", from: { commit: tip, path: "assets/tool/deploy" } }],
				reason: { kind: "promote" },
			}),
		);
		expect(response.status).toBe(200);
		const written = here.api.index.at(-1)?.rows as { idx_effective: Array<{ user_id: string; asset_id: string }> };
		expect(written.idx_effective.some((row) => row.user_id === "u-dana" && row.asset_id === teamAsset)).toBe(true);
		const events = here.api.audit.flatMap((batch) => batch.events);
		expect(events.filter((event) => event.event === "definitions.commit" && (event.reason as { kind: string }).kind === "promote")).toHaveLength(1);
	});

	it("internal_commit_cas", async () => {
		const head = (await gitOut(repo, ["rev-parse", "refs/heads/teams/acme.marketing"])).trim();
		const body = (note: string) => ({
			org_id: "acme",
			ref: "refs/heads/teams/acme.marketing",
			expectedHead: head,
			author: { userId: "u-rae", name: "Rae", email: "rae@acme.co" },
			message: note,
			changes: [{ path: `notes/${note}.txt`, blob: Buffer.from(note).toString("base64") }],
			reason: { kind: "admin-edit" as const },
		});
		const [first, second] = await Promise.all([
			fetch(`${here.url}/internal/commit`, asService(body("one"))),
			fetch(`${here.url}/internal/commit`, asService(body("two"))),
		]);
		const codes = [first.status, second.status].sort();
		expect(codes).toEqual([200, 409]);
		const conflicted = first.status === 409 ? first : second;
		const value = (await conflicted.json()) as { head: string };
		expect(value.head).toBe((await gitOut(repo, ["rev-parse", "refs/heads/teams/acme.marketing"])).trim());
	});

	it("policy_push_revokes_sessions_in_subtree", async () => {
		const before = here.api.policyChanged.length;
		await push({ "assets/tool/deploy/run": "#!/bin/sh\necho again\n" }, "my own asset again");
		expect(here.api.policyChanged).toHaveLength(before);

		const head = (await gitOut(repo, ["rev-parse", "refs/heads/teams/acme.marketing"])).trim();
		await fetch(
			`${here.url}/internal/commit`,
			asService({
				org_id: "acme",
				ref: "refs/heads/teams/acme.marketing",
				expectedHead: head,
				author: { userId: "u-rae", name: "Rae", email: "rae@acme.co" },
				message: "a boundary",
				changes: [
					{
						path: "policy/boundaries.json",
						blob: Buffer.from(
							JSON.stringify([
								{ id: "no-competitor", scope: { teams: "all" }, kind: "endpoint", value: "competitor.example", holds: "enforced", reason: "Contract clause 4.2." },
							]),
						).toString("base64"),
					},
				],
				reason: { kind: "admin-edit" },
			}),
		);
		expect(here.api.policyChanged).toHaveLength(before + 1);
		expect(here.api.policyChanged.at(-1)?.refs[0].paths).toEqual(["policy/boundaries.json"]);
	});

	it("edges_are_complete", async () => {
		const head = (await gitOut(repo, ["rev-parse", "refs/heads/org"])).trim();
		const file = (name: string, value: unknown) => ({
			path: `policy/${name}`,
			blob: Buffer.from(JSON.stringify(value)).toString("base64"),
		});
		const written = await fetch(
			`${here.url}/internal/commit`,
			asService({
				org_id: "acme",
				ref: "refs/heads/org",
				expectedHead: head,
				author: { userId: "u-rae", name: "Rae", email: "rae@acme.co" },
				message: "the org's policy",
				changes: [
					file("groups.json", [
						{
							name: "marketing",
							entries: [
								{ alias: "crm", secret: { vault: "aws-prod", ref: "marketing/crm" }, upstream: "https://api.crm.example", attach: { header: "Authorization", prefix: "Bearer " } },
							],
							sources: "vault",
						},
					]),
					file("grants.json", [
						{ id: "g-mkt", scope: { teams: ["acme.marketing"], harnesses: [harnessId] }, group: "marketing", by: "rae@acme.co" },
					]),
					// D131: per node, like boundaries, and read into `idx_policy` by
					// the same walk over `policy/`.
					file("reach.json", { mode: "allow", hosts: ["pypi.org"] }),
					file("boundaries.json", [
						{ id: "b1", scope: { teams: ["acme.marketing"] }, kind: "endpoint", value: "competitor.example", holds: "enforced", reason: "Contract." },
					]),
					file("harness-providers.json", [
						{ id: "pi", approval: "approved", scope: { teams: "all" }, pin: { binary: "pi", minVersion: "1.0.0" }, speaks: ["anthropic-messages"] },
					]),
					file("model-providers.json", [
						{ id: "anthropic", endpoints: { "anthropic-messages": "https://api.anthropic.com" }, models: ["claude-opus-5"], credential: { alias: "anthropic-key" } },
					]),
					file("routing.json", {
						defaultFor: { teams: { acme: "anthropic" }, harnesses: {}, providers: {} },
						approvedFor: { teams: {}, harnesses: {}, providers: { pi: ["anthropic"] } },
					}),
					{
						path: `harnesses/${harnessId}.json`,
						blob: Buffer.from(JSON.stringify({ id: harnessId, name: "Campaigns", description: "Weekly copy.", icon, assets: [teamAsset] })).toString("base64"),
					},
				],
				reason: { kind: "admin-edit" },
			}),
		);
		expect(written.status, JSON.stringify(await written.clone().json())).toBe(200);
		const rows = here.api.index.findLast((row) => row.ref === "refs/heads/org")?.rows as { idx_edges: Array<{ rel: string }> };
		const rels = new Set(rows.idx_edges.map((each) => each.rel));
		// The complete list in 02 §8.2, minus `narrowed_from` and `needs_alias`,
		// which belong to a team's narrowed grant and to a sidecar's needs, and
		// minus `reach`, which went with the grant it came from (D132).
		for (const rel of ["includes", "entry", "entry_secret", "entry_upstream", "grants", "scoped_to", "only_for", "credential", "default_for", "approved_for", "speaks", "exposes"])
			expect(rels, rel).toContain(rel);
		expect(rels).not.toContain("reach");
		// And `reach.json` is one more `idx_policy` row, read like the rest.
		const policy = here.api.index.findLast((row) => row.ref === "refs/heads/org")?.rows as { idx_policy: Array<{ file: string; body: unknown }> };
		expect(policy.idx_policy.find((row) => row.file === "reach.json")?.body).toEqual({ mode: "allow", hosts: ["pypi.org"] });
	});

	it("a_reach_grant_is_refused_at_the_push", async () => {
		// D132: the grant is retired, so a branch that still carries one is told
		// at the push rather than at every session that composes it.
		const head = (await gitOut(repo, ["rev-parse", "refs/heads/org"])).trim();
		const response = await fetch(
			`${here.url}/internal/commit`,
			asService({
				org_id: "acme",
				ref: "refs/heads/org",
				expectedHead: head,
				author: { userId: "u-rae", name: "Rae", email: "rae@acme.co" },
				message: "a reach grant",
				changes: [
					{
						path: "policy/grants.json",
						blob: Buffer.from(JSON.stringify([{ id: "g-reach", scope: { teams: "all" }, reach: "outside-endpoints", by: "rae@acme.co" }])).toString("base64"),
					},
				],
				reason: { kind: "admin-edit" },
			}),
		);
		expect(response.status).toBe(403);
		expect((await response.json()).code).toBe("definitions.reach_grant_retired");
	});

	it("reindex_equals_fresh_index", async () => {
		// The index as the sequence of pushes left it: the newest write per ref.
		const snapshot = new Map(here.api.index.filter((row) => !row.stale).map((row) => [row.ref, JSON.stringify(row.rows)]));
		here.api.index.length = 0;
		const response = await fetch(`${here.url}/internal/reindex/acme`, asService({}));
		expect(response.status).toBe(200);
		const rebuilt = new Map(here.api.index.map((row) => [row.ref, JSON.stringify(row.rows)]));
		expect([...rebuilt.keys()].sort()).toEqual([...snapshot.keys()].sort());
		for (const [ref, rows] of snapshot) expect(rebuilt.get(ref), ref).toBe(rows);
	});

	// 02 §13's performance row needs a synthetic org of 5,000 users; it belongs
	// with the M2 load fixtures, not in the unit suite.
	it.todo("org_push_indexes_5000_users_under_5s");
});

// 02 §11's exporter is not built (it is M1's dry run, engine/definitions/migrate/).
it.todo("migration_is_byte_identical");
