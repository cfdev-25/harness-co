import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Composed } from "@harness/compose/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../src/boot.js";
import { adopt } from "../src/commands/adopt.js";
import { newHarness } from "../src/commands/new.js";
import { offer } from "../src/commands/offer.js";
import { ensureRepo, g, worktreeTree } from "../src/git.js";
import { assetsRoot } from "../src/selection.js";

const exec = promisify(execFile);
const USER = "3f29b349-aaef-43db-9096-c4fe2758e3cb";
const credentials = { api_url: "http://api", token: "tok" };
let me: Me;
let origin: string;

beforeEach(async () => {
	process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-cmd-"));
	vi.spyOn(console, "log").mockImplementation(() => undefined);
	origin = join(process.env.HARNESS_HOME, "acme.git");
	await exec("git", ["init", "--bare", "--quiet", origin]);
	me = { user: { id: USER }, chain: [], role: { level: "member", at: "acme.marketing" }, org: "acme", definitions: process.env.HARNESS_HOME } as unknown as Me;
	await ensureRepo();
});

async function delivered(key: string, id: string): Promise<void> {
	await mkdir(join(assetsRoot(), key), { recursive: true });
	await writeFile(join(assetsRoot(), key, "asset.json"), JSON.stringify({ id, kind: key.split("/")[0] }));
	await writeFile(join(assetsRoot(), key, "body.md"), "delivered\n");
	await writeFile(join(assetsRoot(), "versions.json"), JSON.stringify({ [key]: { id, kind: key.split("/")[0], from: "acme", commit: "c", tree: "t", required: false } }));
	await g("update-ref", "refs/harness/remote", await g("commit-tree", await worktreeTree(), "-m", "hydrate"));
}

const composed = (harnesses: Composed["harnesses"], recommended: string[] = [], assets: Composed["assets"] = []): Composed =>
	({ chain: [], assets, conflicts: [], harnesses, harnessFrom: {}, policy: { kinds: ["skill", "tool", "memory"], required: [], recommended }, tree: "" }) as unknown as Composed;

describe("offer (§11.8, D108)", () => {
	it("offer_opens_request", async () => {
		await delivered("tool/crm-sync", "a1");
		await writeFile(join(assetsRoot(), "tool/crm-sync", "body.md"), "mine\n");
		const calls: Array<{ url: string; body: unknown }> = [];
		vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
			calls.push({ url, body: JSON.parse(init.body as string) });
			return new Response(JSON.stringify({ id: "r-7f3a" }), { status: 200, headers: { "content-type": "application/json" } });
		});
		expect(await offer(credentials, me, ["tool/crm-sync"], "Retry flaky list calls")).toBe(0);

		// Exactly one push (to the person's branch) and exactly one request.
		const refs = await exec("git", ["--git-dir", origin, "for-each-ref", "--format=%(refname)"]);
		expect(refs.stdout.trim().split("\n")).toEqual([`refs/heads/users/${USER}`]);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe("http://api/v1/requests");
		const commit = (await exec("git", ["--git-dir", origin, "rev-parse", `refs/heads/users/${USER}`])).stdout.trim();
		expect(calls[0].body).toEqual({
			title: "Retry flaky list calls",
			reasoning: "Retry flaky list calls",
			// The CLI only ever opens the promotion kind (00 §4.10).
			subject: { kind: "promotion", paths: ["tool/crm-sync"], commit },
		});
		vi.unstubAllGlobals();
	});
});

describe("new (§11.12, D107)", () => {
	it("new_mints_sidecar_id", async () => {
		expect(await newHarness(credentials, me, composed([]), "Weekly newsletter")).toBe(0);
		const head = (await exec("git", ["--git-dir", origin, "rev-parse", `refs/heads/users/${USER}`])).stdout.trim();
		const listed = (await exec("git", ["--git-dir", origin, "ls-tree", "-r", "--name-only", head])).stdout.trim().split("\n");
		expect(listed).toHaveLength(1);
		const [path] = listed;
		expect(path).toMatch(/^harnesses\/[0-9a-f-]{36}\.json$/);
		const body = JSON.parse((await exec("git", ["--git-dir", origin, "show", `${head}:${path}`])).stdout);
		expect(body).toMatchObject({ name: "Weekly newsletter", description: "", assets: [] });
		// A fresh uuid, and the file is named after it.
		expect(`harnesses/${body.id}.json`).toBe(path);
	});

	/** §11.12's landing lines name a unit, so these tests run on a real chain. */
	const onChain = (...teams: string[]): Me => ({
		...me,
		chain: [
			{ kind: "org", path: "acme", ref: "refs/heads/org", commit: "c0" },
			...teams.map((path) => ({ kind: "team" as const, path, ref: `refs/heads/teams/${path}`, commit: "c1" })),
			{ kind: "user", path: "acme.dana", ref: `refs/heads/users/${USER}`, commit: "c2" },
		],
	});

	const printed = (): string[] => vi.mocked(console.log).mock.calls.map((call) => String(call[0]));

	it("new_without_flag_prints_own_branch_landing_line", async () => {
		vi.mocked(console.log).mockClear();
		expect(await newHarness(credentials, onChain("acme.marketing"), composed([]), "Weekly newsletter")).toBe(0);
		expect(printed()).toContain("Created on your branch. Only you have it.  (`--team marketing` would make it Marketing's.)");
		expect(printed()).toContain("`harness switch Weekly newsletter` to pick it up.");

		// A person on no team is told where it went and offered no team to move it to.
		vi.mocked(console.log).mockClear();
		await newHarness(credentials, onChain(), composed([]), "Second");
		expect(printed()).toContain("Created on your branch. Only you have it.");
	});

	it("new_team_flag_posts_scope_and_prints_team_landing_line", async () => {
		const calls: Array<{ url: string; method?: string; body: unknown }> = [];
		vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
			calls.push({ url, method: init.method, body: JSON.parse(init.body as string) });
			return new Response(JSON.stringify({ commit: "abc1234def", ref: "refs/heads/teams/acme.marketing", id: "h-new" }), { status: 201, headers: { "content-type": "application/json" } });
		});
		vi.mocked(console.log).mockClear();
		expect(await newHarness(credentials, onChain("acme.marketing"), composed([]), "Weekly newsletter", undefined, "acme.marketing")).toBe(0);
		expect(calls).toEqual([{ url: "http://api/v1/harnesses", method: "POST", body: { name: "Weekly newsletter", description: "", icon: { palette: [], rows: Array.from({ length: 16 }, () => ".".repeat(16)) }, assets: [], scope: "acme.marketing" } }]);
		expect(printed()).toContain("Created on Marketing's branch. Everyone on Marketing inherits it.");
		expect(printed()).toContain("`harness switch \"Weekly newsletter\" --team` to pick it up.");
		// D116: the admin form never commits on a ref the CLI does not hold.
		const refs = await exec("git", ["--git-dir", origin, "for-each-ref", "--format=%(refname)"]);
		expect(refs.stdout.trim()).toBe("");

		// `--org`, and `--from` the server copies rather than the CLI (00 §4.10).
		const source = { id: "h1", name: "campaign-drafts", description: "", icon: { palette: [], rows: [] }, assets: ["a1", "a2"] };
		vi.mocked(console.log).mockClear();
		await newHarness(credentials, onChain("acme.marketing"), composed([source]), "Everyone", "campaign-drafts", "org");
		expect(calls[1].body).toMatchObject({ scope: "org", assets: [], from: "h1" });
		expect(printed()).toContain("Created on the organisation's branch. Every team inherits it.");
		expect(printed()).toContain("`harness switch \"Everyone\" --team` to pick it up.");
		vi.unstubAllGlobals();
	});

	it("new_team_short_name_resolves_on_chain_and_refuses_when_ambiguous", async () => {
		const calls: unknown[] = [];
		vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
			calls.push(JSON.parse(init.body as string));
			return new Response(JSON.stringify({ commit: "abc1234def", ref: "r" }), { status: 201, headers: { "content-type": "application/json" } });
		});
		await newHarness(credentials, onChain("acme.marketing"), composed([]), "One", undefined, "marketing");
		expect(calls[0]).toMatchObject({ scope: "acme.marketing" });

		// Two teams end in the same segment, so the dotted path is the only answer.
		const both = onChain("acme.marketing", "acme.eu.marketing");
		await expect(newHarness(credentials, both, composed([]), "Two", undefined, "marketing")).rejects.toMatchObject({ code: "cli.team_ambiguous" });
		vi.unstubAllGlobals();
	});

	it("copies the assets of --from, and refuses a duplicate name", async () => {
		const existing = { id: "h1", name: "campaign-drafts", description: "", icon: { palette: [], rows: [] }, assets: ["a1", "a2"] };
		expect(await newHarness(credentials, me, composed([existing]), "Copy", "campaign-drafts")).toBe(0);
		const head = (await exec("git", ["--git-dir", origin, "rev-parse", `refs/heads/users/${USER}`])).stdout.trim();
		const [path] = (await exec("git", ["--git-dir", origin, "ls-tree", "-r", "--name-only", head])).stdout.trim().split("\n");
		expect(JSON.parse((await exec("git", ["--git-dir", origin, "show", `${head}:${path}`])).stdout).assets).toEqual(["a1", "a2"]);

		await expect(newHarness(credentials, me, composed([existing]), "campaign-drafts")).rejects.toMatchObject({ code: "cli.harness_name_taken" });
	});

	it("new_harness_starts_with_the_recommended_ids", async () => {
		// W5-D10: the organisation's `recommended` list, copied in at creation
		// and ordinary entries from then on. A recommended id nothing on the
		// chain answers is not copied — it would only be an unanswered row.
		const assets = [{ id: "r1" }, { id: "a1" }] as unknown as Composed["assets"];
		const world = composed([], ["r1", "gone"], assets);
		expect(await newHarness(credentials, me, world, "Weekly newsletter")).toBe(0);
		const head = (await exec("git", ["--git-dir", origin, "rev-parse", `refs/heads/users/${USER}`])).stdout.trim();
		const [path] = (await exec("git", ["--git-dir", origin, "ls-tree", "-r", "--name-only", head])).stdout.trim().split("\n");
		expect(JSON.parse((await exec("git", ["--git-dir", origin, "show", `${head}:${path}`])).stdout).assets).toEqual(["r1"]);
	});
});

describe("adopt (§11.11, D114)", () => {
	const sidecar = (key: string) => readFile(join(assetsRoot(), key, "asset.json"), "utf8").then((text) => JSON.parse(text) as { id: string; kind: string });

	async function handMade(name: string, files: Record<string, string>): Promise<string> {
		const dir = join(process.env.HARNESS_HOME as string, name);
		await mkdir(dir, { recursive: true });
		for (const [path, body] of Object.entries(files)) await writeFile(join(dir, path), body);
		return dir;
	}

	it("adopt_mints_sidecar", async () => {
		const dir = await handMade("my-skill", { "SKILL.md": "# hi\n" });
		expect(await adopt(dir, false, ["skill", "tool", "memory"])).toBe(0);
		// The shape says the kind; the id is fresh.
		const one = await sidecar("skill/my-skill");
		expect(one.kind).toBe("skill");
		expect(one.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("adopt_takes_the_kind_from_placement", async () => {
		// A one-file directory already under `<assetsRoot>/prompt/` is a prompt by
		// placement (07 §6a); the shape alone would have re-filed it as a memory.
		const dir = join(assetsRoot(), "prompt", "release-notes");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "release-notes.md"), "Write the notes.\n");
		expect(await adopt(dir, false, ["skill", "tool", "memory", "prompt"])).toBe(0);
		expect((await sidecar("prompt/release-notes")).kind).toBe("prompt");
	});

	it("adopt_environment_by_its_marker_file", async () => {
		const dir = await handMade("deck-tools", { "ENVIRONMENT.md": "What the deck tool needs.\n", "requirements.txt": "python-pptx\n" });
		expect(await adopt(dir, false, ["skill", "tool", "memory", "environment"])).toBe(0);
		expect((await sidecar("environment/deck-tools")).kind).toBe("environment");
	});

	it("adopt_context_by_its_marker_file", async () => {
		const dir = await handMade("brand-assets", { "CONTEXT.md": "Brand colours.\n", "palette.md": "primary: #c8875a\n" });
		expect(await adopt(dir, false, ["skill", "tool", "memory", "context"])).toBe(0);
		expect((await sidecar("context/brand-assets")).kind).toBe("context");
	});

	it("adopt_keeps_existing_id", async () => {
		const dir = await handMade("my-tool", { run: "#!/bin/sh\n", "asset.json": JSON.stringify({ id: "kept-id", kind: "tool" }) });
		await adopt(dir, false, ["skill", "tool", "memory"]);
		expect(await sidecar("tool/my-tool")).toEqual({ id: "kept-id", kind: "tool" });
	});

	it("adopt_new_id_reids", async () => {
		await delivered("tool/crm-sync", "on-the-chain");
		const dir = await handMade("clash", { run: "#!/bin/sh\n", "asset.json": JSON.stringify({ id: "on-the-chain", kind: "tool" }) });
		// An id already on the chain is the same-path-different-id conflict waiting
		// to happen, so it is refused here rather than at pre-receive (D3).
		await expect(adopt(dir, false, ["skill", "tool", "memory"])).rejects.toMatchObject({ code: "cli.id_collision" });
		await adopt(dir, true, ["skill", "tool", "memory"]);
		const one = await sidecar("tool/clash");
		expect(one.id).not.toBe("on-the-chain");
		expect(one.id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("refuses a kind the organisation does not use", async () => {
		const dir = await handMade("odd", { "asset.json": JSON.stringify({ id: "x", kind: "widget" }) });
		await expect(adopt(dir, false, ["skill", "tool", "memory"])).rejects.toMatchObject({ code: "cli.kind_unknown" });
	});
});

describe("reset (§11.10, D106)", () => {
	const harness = (assets: string[]) => ({ id: "h1", name: "h", description: "", icon: { palette: [], rows: [] }, assets });

	it("reset_all_scopes_to_harness", async () => {
		const { reset } = await import("../src/commands/reset.js");
		const { writeSelection } = await import("../src/selection.js");
		const versions: Record<string, unknown> = {};
		for (const [key, id] of [["skill/a", "id-a"], ["skill/b", "id-b"]] as const) {
			await mkdir(join(assetsRoot(), key), { recursive: true });
			await writeFile(join(assetsRoot(), key, "asset.json"), JSON.stringify({ id, kind: "skill" }));
			await writeFile(join(assetsRoot(), key, "body.md"), "delivered\n");
			versions[key] = { id, kind: "skill", from: "acme", commit: "c", tree: "t", required: false };
		}
		await writeFile(join(assetsRoot(), "versions.json"), JSON.stringify(versions));
		await g("update-ref", "refs/harness/remote", await g("commit-tree", await worktreeTree(), "-m", "hydrate"));
		for (const key of ["skill/a", "skill/b"]) await writeFile(join(assetsRoot(), key, "body.md"), "mine\n");

		// With a selection, `--all` is exactly the harness's keys — and the
		// definition comes from the chain, never from a file on disk.
		await writeSelection({ harness_id: "h1", name: "h", version: "mine" });
		expect(await reset(undefined, true, true, [harness(["id-a"])])).toBe(0);
		expect(await readFile(join(assetsRoot(), "skill/a", "body.md"), "utf8")).toBe("delivered\n");
		expect(await readFile(join(assetsRoot(), "skill/b", "body.md"), "utf8")).toBe("mine\n");

		// With no selection, `--all` is every delivered key.
		await writeSelection(undefined);
		expect(await reset(undefined, true, true, [])).toBe(0);
		expect(await readFile(join(assetsRoot(), "skill/b", "body.md"), "utf8")).toBe("delivered\n");
	});

	it("refuses without --yes when there is no terminal", async () => {
		const { reset } = await import("../src/commands/reset.js");
		await mkdir(join(assetsRoot(), "skill/a"), { recursive: true });
		await writeFile(join(assetsRoot(), "versions.json"), JSON.stringify({ "skill/a": { id: "id-a", kind: "skill", from: "a", commit: "c", tree: "t", required: false } }));
		await g("update-ref", "refs/harness/remote", await g("commit-tree", await worktreeTree(), "-m", "hydrate"));
		await expect(reset("skill/a", false, false, [])).rejects.toMatchObject({ code: "cli.reset_needs_yes" });
	});
});
