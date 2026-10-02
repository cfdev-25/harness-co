import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { gitOut } from "../src/git.js";
import { messages } from "../src/codes.js";
import { type World, asToken, person, run, seedBranch, seedCommit, seedOrg, world } from "./world.js";

/** T4, 02 §6.1 and §6.2: real bare repos, a real `git fetch`/`push` over HTTP
    against the service on an ephemeral port, and the fake `api`. */
let here: World;
let repo: string;
let engineeringTip: string;
let origin: string;

beforeAll(async () => {
	here = await world();
	repo = await seedOrg(here.root, "acme");
	await seedBranch(repo, "refs/heads/teams/acme.marketing", "acme.marketing");
	await seedBranch(repo, "refs/heads/teams/acme.engineering", "acme.engineering");
	await seedBranch(repo, "refs/heads/users/u-dana", "acme.marketing.dana");
	await seedBranch(repo, "refs/heads/users/u-eve", "acme.engineering.eve");
	engineeringTip = await seedCommit(
		repo,
		"refs/heads/teams/acme.engineering",
		{ "assets/tool/roadmap/asset.json": '{"id":"a","kind":"tool"}' },
		"the engineering roadmap",
	);
	here.api.principals.set(
		"dana",
		person("u-dana", "acme", [
			["org", "acme", "refs/heads/org"],
			["team", "acme.marketing", "refs/heads/teams/acme.marketing"],
			["user", "acme.marketing.dana", "refs/heads/users/u-dana"],
		]),
	);
	origin = `${here.url}/acme.git`;
});

afterAll(async () => {
	await here.close();
});

it("user_cannot_fetch_sibling_team_ref", async () => {
	const listed = await run(here.scratch, [...asToken("dana"), "ls-remote", origin]);
	expect(listed.code).toBe(0);
	const refs = listed.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => line.split("\t")[1])
		.sort();
	expect(refs).toEqual(["refs/heads/org", "refs/heads/teams/acme.marketing", "refs/heads/users/u-dana"]);

	const work = mkdtempSync(join(tmpdir(), "clone-"));
	await run(work, ["init", "--quiet", "."]);
	await run(work, ["remote", "add", "origin", origin]);
	const stolen = await run(work, [...asToken("dana"), "fetch", "origin", engineeringTip]);
	expect(stolen.code).not.toBe(0);
	expect(stolen.stderr).toMatch(/not our ref|unadvertised object/);
});

it("hidden_ref_object_not_fetchable_by_sha", async () => {
	// Both protocol versions: v2's `fetch` accepts an unadvertised `want`, so the
	// transport must keep upload-pack on v0 (transport.ts). If this ever passes
	// only on v0, hideRefs is not the control §6.1 says it is.
	for (const version of ["0", "2"]) {
		const work = mkdtempSync(join(tmpdir(), "steal-"));
		await run(work, ["init", "--quiet", "."]);
		await run(work, ["remote", "add", "origin", origin]);
		const stolen = await run(work, [
			"-c",
			`protocol.version=${version}`,
			...asToken("dana"),
			"fetch",
			"origin",
			engineeringTip,
		]);
		expect(stolen.code, `protocol.version=${version}`).not.toBe(0);
		expect(stolen.stderr, `protocol.version=${version}`).toMatch(/not our ref|unadvertised object/);
		const has = await run(work, ["cat-file", "-e", engineeringTip]);
		expect(has.code, `protocol.version=${version}`).not.toBe(0);
	}
});

it("user_cannot_push_team_ref", async () => {
	const work = mkdtempSync(join(tmpdir(), "push-"));
	expect((await run(work, [...asToken("dana"), "clone", "--quiet", origin, "."])).code).toBe(0);
	await run(work, ["config", "user.email", "dana@acme.co"]);
	await run(work, ["config", "user.name", "Dana"]);
	// Based on the team's own tip: `receive.denyNonFastForwards` refuses an
	// unrelated history before pre-receive ever runs, and step 1 is the rule
	// under test.
	await run(work, ["checkout", "--quiet", "-b", "promote", "origin/teams/acme.marketing"]);
	writeFileSync(join(work, "note.txt"), "a change");
	await run(work, ["add", "-A"]);
	await run(work, ["commit", "--quiet", "-m", "a change"]);

	// Marketing is on Dana's chain, so receive-pack advertises it and the push
	// reaches §7 step 1 — which is the enforcement point, not the advertisement.
	const refused = await run(work, [...asToken("dana"), "push", "origin", "HEAD:refs/heads/teams/acme.marketing"]);
	expect(refused.code).not.toBe(0);
	expect(refused.stderr).toContain(messages["definitions.not_your_ref"]());
	expect((await gitOut(repo, ["rev-parse", "refs/heads/teams/acme.marketing"])).trim()).not.toBe("");
});

it("admin_promote_goes_through_internal_commit_not_push: the raw push half", async () => {
	// The same refusal for a team admin: §6.2 has no exception, and the admin's
	// own route is `/internal/commit` (exercised in internal.test.ts).
	here.api.principals.set(
		"rae",
		person(
			"u-rae",
			"acme",
			[
				["org", "acme", "refs/heads/org"],
				["team", "acme.marketing", "refs/heads/teams/acme.marketing"],
				["user", "acme.marketing.rae", "refs/heads/users/u-rae"],
			],
			["refs/heads/users/u-dana"],
		),
	);
	await seedBranch(repo, "refs/heads/users/u-rae", "acme.marketing.rae");
	const work = mkdtempSync(join(tmpdir(), "admin-"));
	expect((await run(work, [...asToken("rae"), "clone", "--quiet", origin, "."])).code).toBe(0);
	// `readable` reaches the admin: Dana's ref is advertised, Eve's is not.
	const listed = await run(work, [...asToken("rae"), "ls-remote", origin]);
	expect(listed.stdout).toContain("refs/heads/users/u-dana");
	expect(listed.stdout).not.toContain("refs/heads/users/u-eve");

	await run(work, ["config", "user.email", "rae@acme.co"]);
	await run(work, ["config", "user.name", "Rae"]);
	await run(work, ["checkout", "--quiet", "-b", "promote", "origin/teams/acme.marketing"]);
	writeFileSync(join(work, "promoted.txt"), "a promotion");
	await run(work, ["add", "-A"]);
	await run(work, ["commit", "--quiet", "-m", "a promotion"]);
	const refused = await run(work, [...asToken("rae"), "push", "origin", "HEAD:refs/heads/teams/acme.marketing"]);
	expect(refused.code).not.toBe(0);
	expect(refused.stderr).toContain(messages["definitions.not_your_ref"]());

	// A readable ref is readable, never writable: receive-pack hides it again.
	await run(work, ["checkout", "--quiet", "-B", "member", "origin/users/u-dana"]);
	writeFileSync(join(work, "theirs.txt"), "not mine to write");
	await run(work, ["add", "-A"]);
	await run(work, ["commit", "--quiet", "-m", "not mine to write"]);
	const atMember = await run(work, [...asToken("rae"), "push", "origin", "HEAD:refs/heads/users/u-dana"]);
	expect(atMember.code).not.toBe(0);
	expect(atMember.stderr).toMatch(/hidden ref/);
});
