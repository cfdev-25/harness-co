import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../src/boot.js";
import { pushKey } from "../src/commands/push.js";
import { ensureRepo, g, worktreeTree } from "../src/git.js";
import { assetsGitDir, assetsRoot } from "../src/selection.js";

const exec = promisify(execFile);
const USER = "3f29b349-aaef-43db-9096-c4fe2758e3cb";

let origin: string;
let me: Me;

/** A real bare repo as `origin`, so the refspec is observed and not mocked. */
beforeEach(async () => {
	process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-push-"));
	vi.spyOn(console, "log").mockImplementation(() => undefined);
	// `origin(me)` is `<definitions>/<org>.git` (01 §7.2), so the fixture names
	// the two halves rather than the joined URL.
	origin = join(process.env.HARNESS_HOME, "acme.git");
	await exec("git", ["init", "--bare", "--quiet", origin]);
	me = { user: { id: USER }, chain: [], role: { level: "member", at: null }, org: "acme", definitions: process.env.HARNESS_HOME } as unknown as Me;

	await ensureRepo();
	for (const key of ["skill/brief", "tool/crm-sync"]) {
		await mkdir(join(assetsRoot(), key), { recursive: true });
		await writeFile(join(assetsRoot(), key, "asset.json"), JSON.stringify({ id: key, kind: key.split("/")[0] }));
		await writeFile(join(assetsRoot(), key, "body.md"), "delivered\n");
	}
	const versions = Object.fromEntries(
		["skill/brief", "tool/crm-sync"].map((key) => [key, { id: key, kind: key.split("/")[0], from: "acme", commit: "c", tree: "t", required: false }]),
	);
	await writeFile(join(assetsRoot(), "versions.json"), JSON.stringify(versions));
	await g("update-ref", "refs/harness/remote", await g("commit-tree", await worktreeTree(), "-m", "hydrate"));
});

const credentials = { api_url: "http://api", token: "tok-abc123" };

describe("push (§11.7, 01 §7.3)", () => {
	it("push_commits_only_the_key", async () => {
		await writeFile(join(assetsRoot(), "skill/brief", "body.md"), "mine\n");
		await writeFile(join(assetsRoot(), "tool/crm-sync", "body.md"), "also mine\n");
		await pushKey(credentials, me, "skill/brief", "Sharpen the brief");

		const head = await exec("git", ["--git-dir", origin, "rev-parse", `refs/heads/users/${USER}`]);
		const tree = await exec("git", ["--git-dir", origin, "ls-tree", "-r", "--name-only", head.stdout.trim()]);
		// One commit, one path: the other dirty key is not on the branch at all.
		const paths = tree.stdout.trim().split("\n").sort();
		expect(paths).toEqual(["assets/skill/brief/asset.json", "assets/skill/brief/body.md"]);
		const log = await exec("git", ["--git-dir", origin, "log", "--format=%s", head.stdout.trim()]);
		expect(log.stdout.trim()).toBe("Sharpen the brief");
	});

	it("push_never_targets_team_ref", async () => {
		await writeFile(join(assetsRoot(), "skill/brief", "body.md"), "mine\n");
		await pushKey(credentials, me, "skill/brief", "m");
		// The refs that exist on the remote afterwards are the person's and nothing
		// else — there is no argument to `pushKey` that could name another.
		const refs = await exec("git", ["--git-dir", origin, "for-each-ref", "--format=%(refname)"]);
		expect(refs.stdout.trim().split("\n")).toEqual([`refs/heads/users/${USER}`]);
	});

	it("token_header_never_in_config", async () => {
		await writeFile(join(assetsRoot(), "skill/brief", "body.md"), "mine\n");
		await pushKey(credentials, me, "skill/brief", "m");
		// D24a: the token rides on argv, so it appears in no file the jail could read.
		const config = await readFile(join(assetsGitDir(), "config"), "utf8");
		expect(config).not.toContain("Authorization");
		expect(config).not.toContain(credentials.token);
	});

	it("refuses a directory with no sidecar, and never mints one (D3, C15)", async () => {
		await mkdir(join(assetsRoot(), "skill", "bare"), { recursive: true });
		await writeFile(join(assetsRoot(), "skill", "bare", "body.md"), "hand made\n");
		await expect(pushKey(credentials, me, "skill/bare", "m")).rejects.toMatchObject({ code: "repo.no_sidecar" });
	});

	it("refuses an id that differs from the one delivered at that path", async () => {
		await writeFile(join(assetsRoot(), "skill/brief", "asset.json"), JSON.stringify({ id: "a-different-id", kind: "skill" }));
		await expect(pushKey(credentials, me, "skill/brief", "m")).rejects.toMatchObject({ code: "repo.id_mismatch" });
	});
});
