import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { gitOut } from "../src/git.js";
import { type World, seedCommit, world } from "./world.js";

/** 02 §5.3 and 00 §4.10: the endpoints `api` calls, over the service token (D42). */
let here: World;

const asService = (body?: unknown): RequestInit => ({
	method: body === undefined ? "GET" : "POST",
	headers: { authorization: `Bearer ${here.api.token}`, "content-type": "application/json" },
	body: body === undefined ? undefined : JSON.stringify(body),
});

beforeAll(async () => {
	here = await world();
});

afterAll(async () => {
	await here.close();
});

it("refuses every internal endpoint without the service token", async () => {
	for (const path of ["/internal/orgs", "/internal/branches", "/internal/commit"])
		expect((await fetch(`${here.url}${path}`, { method: "POST", body: "{}" })).status).toBe(401);
	// A person's own token is not a service token.
	here.api.principals.set("dana", { user_id: "u-dana", org_id: "acme", chain: [], readable: [] });
	expect((await fetch(`${here.url}/internal/orgs`, { method: "POST", headers: { authorization: "Bearer dana" }, body: "{}" })).status).toBe(401);
});

it("platform.git exists, empty, from the moment the service starts (D30g)", async () => {
	const platform = join(here.root, "platform.git");
	expect(existsSync(platform)).toBe(true);
	expect((await gitOut(platform, ["for-each-ref"])).trim()).toBe("");
});

it("POST /internal/orgs creates the bare repo and refs/heads/org as an orphan empty tree", async () => {
	const response = await fetch(`${here.url}/internal/orgs`, asService({ org_id: "beta", node_path: "beta" }));
	expect(response.status).toBe(201);
	const repo = join(here.root, "beta.git");
	expect((await gitOut(repo, ["rev-list", "--count", "refs/heads/org"])).trim()).toBe("1");
	expect((await gitOut(repo, ["show", "-s", "--format=%s", "refs/heads/org"])).trim()).toBe("created beta");
	expect((await gitOut(repo, ["ls-tree", "refs/heads/org"])).trim()).toBe("");
	expect((await gitOut(repo, ["config", "receive.denyNonFastForwards"])).trim()).toBe("true");
	expect((await gitOut(repo, ["config", "receive.fsckObjects"])).trim()).toBe("true");
});

it("POST /internal/branches creates an orphan empty branch and indexes it (D43)", async () => {
	const response = await fetch(
		`${here.url}/internal/branches`,
		asService({ org_id: "beta", ref: "refs/heads/teams/beta.ops", node_path: "beta.ops" }),
	);
	expect(response.status).toBe(201);
	const repo = join(here.root, "beta.git");
	expect((await gitOut(repo, ["show", "-s", "--format=%s", "refs/heads/teams/beta.ops"])).trim()).toBe("created beta.ops");
	const written = here.api.index.filter((row) => row.ref === "refs/heads/teams/beta.ops");
	expect(written).toHaveLength(1);
	expect(written[0].stale).toBeUndefined();
	const rows = written[0].rows as { idx_nodes: Array<{ path: string; kind: string }> };
	expect(rows.idx_nodes.map((node) => `${node.kind}:${node.path}`).sort()).toEqual(["org:beta", "team:beta.ops"]);
});

it("serves the console's tree, log and diff reads (00 §4.10)", async () => {
	const repo = join(here.root, "beta.git");
	const first = await seedCommit(repo, "refs/heads/org", { "policy/kinds.json": '["skill"]' }, "the first kinds");
	const second = await seedCommit(repo, "refs/heads/org", { "policy/kinds.json": '["skill","tool"]' }, "add tool");

	const listing = await (await fetch(`${here.url}/internal/tree/beta/${second}/policy`, asService())).json();
	expect(listing.entries.map((entry: { name: string }) => entry.name)).toEqual(["kinds.json"]);

	const blob = await (await fetch(`${here.url}/internal/tree/beta/${second}/policy/kinds.json`, asService())).json();
	expect(Buffer.from(blob.blob, "base64").toString("utf8")).toBe('["skill","tool"]');

	const log = await (await fetch(`${here.url}/internal/log?org=beta&ref=refs/heads/org&limit=10`, asService())).json();
	expect(log.commits.map((commit: { message: string }) => commit.message)).toEqual(["add tool", "the first kinds", "created beta"]);
	expect(log.commits[0].paths).toEqual(["policy/kinds.json"]);

	const diff = await (await fetch(`${here.url}/internal/diff?org=beta&a=${first}&b=${second}`, asService())).json();
	expect(diff.diff).toContain('+["skill","tool"]');
});

it("index_failure_marks_stale_and_reconciler_clears", async () => {
	await fetch(`${here.url}/internal/orgs`, asService({ org_id: "gamma", node_path: "gamma" }));
	here.api.failIndex = true;
	const refused = await fetch(
		`${here.url}/internal/branches`,
		asService({ org_id: "gamma", ref: "refs/heads/teams/gamma.ops", node_path: "gamma.ops" }),
	);
	expect(refused.status).toBe(500);
	expect((await refused.json()).code).toBe("definitions.index_failed");
	const stale = here.api.index.filter((row) => row.ref === "refs/heads/teams/gamma.ops" && row.stale);
	expect(stale).toHaveLength(1);
	// The ref update happened; only the index did not (§8.3 step 6).
	expect((await gitOut(join(here.root, "gamma.git"), ["rev-parse", "refs/heads/teams/gamma.ops"])).trim()).not.toBe("");

	here.api.failIndex = false;
	// §8.4: every 10 s, the reconciler re-runs the write and the row clears.
	await vi.waitFor(
		() => expect(here.api.index.some((row) => row.ref === "refs/heads/teams/gamma.ops" && !row.stale)).toBe(true),
		{ timeout: 25_000, interval: 500 },
	);
});
