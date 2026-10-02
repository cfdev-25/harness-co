import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compose } from "../src/compose.js";
import { fixtureCases, gitFixture, normalise } from "../src/fixtures.js";
import { gitReader } from "../src/reader-git.js";

/**
 * Tier T2 (00 §10): the same conformance cases against real git in a tmpdir,
 * through the `Reader` the CLI and `definitions` both use. 10 rule 17 — test
 * the thing, not a mock of it.
 */
const cases = fixtureCases(fileURLToPath(new URL("../fixtures", import.meta.url)));
let work: string;

beforeAll(async () => {
	work = await mkdtemp(join(tmpdir(), "compose-fixtures-"));
});
afterAll(async () => {
	await rm(work, { recursive: true, force: true });
});

async function composeCase(name: string) {
	const found = cases.find((entry) => entry.name === name);
	if (!found) throw new Error(`no fixture called ${name}`);
	const repo = join(work, `${name}.git`);
	const { chain, symbols } = await gitFixture(found.dir, repo, work);
	const composed = await compose(chain, gitReader(repo));
	return { composed, repo, chain, expected: found.expected, actual: normalise(composed, symbols) };
}

describe("the conformance fixtures, T2", () => {
	it.each(cases.map((entry) => entry.name))("%s composes to its expected.json over real git", async (name) => {
		const { expected, actual } = await composeCase(name);
		expect(actual).toEqual(expected);
	});
});

it("compose_is_deterministic over real git, tree id included", async () => {
	const first = await composeCase("three-level-teams");
	const second = await compose(first.chain, gitReader(first.repo));
	expect(second).toEqual(first.composed);
	expect(second.tree).toBe(first.composed.tree);
});

it("the composed tree is <kind>/<name> plus versions.json, sharing the branches' objects", async () => {
	const { composed, repo } = await composeCase("three-level-teams");
	const reader = gitReader(repo);
	const root = await reader.ls(composed.tree, "");
	expect(root.map((entry) => entry.name).sort()).toEqual(["memory", "skill", "tool", "versions.json"]);
	// 01 §6 step 14: blob oids are reused, so the asset's tree is the branch's tree.
	const tool = await reader.ls(composed.tree, "tool");
	expect(tool[0]).toMatchObject({ name: "deploy", mode: "040000" });
	expect(tool[0].oid).toBe(composed.assets.find((asset) => asset.name === "deploy")?.tree);
	const versions = JSON.parse(
		new TextDecoder().decode(await reader.cat(root.find((entry) => entry.name === "versions.json")?.oid as string)),
	);
	// 01 §7.5.
	expect(Object.keys(versions)).toEqual(["memory/never-drop-db", "skill/triage", "tool/deploy"]);
	expect(versions["tool/deploy"]).toMatchObject({ from: "acme.marketing.interns", required: false });
	expect(versions["tool/deploy"].shadows).toMatchObject({ from: "acme.marketing" });
});

it("an absent directory lists as []", async () => {
	const { repo, chain } = await composeCase("no-policy-files");
	expect(await gitReader(repo).ls(chain[0].commit, "policy")).toEqual([]);
});

it("a commit the repo does not have is a refusal, not an empty tree", async () => {
	const { repo } = await composeCase("single-org");
	// Failing open here would let a chain naming a missing commit compose to
	// nothing, which hydration reads as "the team deleted everything".
	await expect(gitReader(repo).ls("0".repeat(40), "assets")).rejects.toThrow();
});

it("every refusal in §5 rule 2 and §4.2's branch rules fires", async () => {
	const { composed } = await composeCase("malformed-files");
	expect(composed.conflicts.map((conflict) => [conflict.kind, "path" in conflict ? conflict.path : ""])).toEqual([
		["malformed", "assets/tool/bare"],
		["malformed", "assets/tool/broken"],
		["malformed", "assets/tool/deploy"],
		["malformed", "assets/tool/mislabelled"],
		["malformed", "assets/tool/upper"],
		["malformed", "policy/kinds.json"],
		["malformed", "policy/grants.json"],
	]);
	// The two well-formed assets still compose: a bad neighbour is skipped, not fatal.
	expect(composed.assets.map((asset) => asset.name)).toEqual(["mine", "triage"]);
	// A team may hold boundaries, so that file is not among the refusals.
	expect(composed.policy.boundaries.map((boundary) => boundary.id)).toEqual(["acme.marketing/ok"]);
});

it("versions.json records what is required", async () => {
	const { composed, repo } = await composeCase("always-loaded");
	const reader = gitReader(repo);
	const root = await reader.ls(composed.tree, "");
	const versions = JSON.parse(
		new TextDecoder().decode(await reader.cat(root.find((entry) => entry.name === "versions.json")?.oid as string)),
	);
	expect(versions["memory/never-drop-db"].required).toBe(true);
	expect(versions["tool/deploy"].required).toBe(false);
});

it("a synthetic empty-tree user node lets 02 validate a push to a team ref", async () => {
	// 02 §7 runs compose() over one chain ending at the pushed node, but §6
	// step 1 requires a user. This is the adapter that makes that legal, and
	// it must add no conflict of its own and change none of the team's.
	const { repo, chain } = await composeCase("narrowed-grant-alias-not-held");
	const team = chain.slice(0, 2);
	await expect(compose(team, gitReader(repo))).resolves.toMatchObject({
		conflicts: [{ kind: "malformed", path: "<chain>" }],
	});
	const synthetic = {
		kind: "user" as const,
		path: `${team[1].path}.__validate`,
		ref: "refs/heads/users/__validate",
		commit: chain[chain.length - 1].commit,
	};
	const composed = await compose([...team, synthetic], gitReader(repo));
	expect(composed.conflicts).toEqual([
		{ kind: "invalid-grant", grant: "g-interns-crm", from: chain[1], clause: "d", why: expect.any(String) },
	]);
});
