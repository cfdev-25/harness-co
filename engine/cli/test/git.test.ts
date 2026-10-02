import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { credentialsPath, readCredentials, writeCredentials } from "../src/credentials.js";
import { assetsGitDir, assetsRoot } from "../src/selection.js";
import { differs, ensureRepo, g, worktreeTree } from "../src/git.js";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const saved = { ...process.env };
let home: string;

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "harness-git-"));
	process.env.HARNESS_HOME = home;
	process.env.HARNESS_CREDENTIALS = join(home, "cfg", "credentials.json");
});
afterEach(() => {
	process.env = { ...saved };
});

describe("repo", () => {
	it("initialises once, in a git dir outside the work tree", async () => {
		await ensureRepo();
		await ensureRepo();
		expect(await g("rev-parse", "--git-dir")).toBe(assetsGitDir());
		expect(await g("rev-parse", "--show-toplevel")).toBe(await realpath(assetsRoot()));
		// No .git inside the work tree: the agent can write there.
		await expect(stat(join(assetsRoot(), ".git"))).rejects.toThrow();
	});

	it("hashes the work tree and detects per-path differences", async () => {
		await ensureRepo();
		expect(await worktreeTree()).toBe(EMPTY_TREE);

		await mkdir(join(assetsRoot(), "skill", "triage"), { recursive: true });
		await writeFile(join(assetsRoot(), "skill", "triage", "SKILL.md"), "one");
		const first = await worktreeTree();
		expect(first).not.toBe(EMPTY_TREE);
		expect(await worktreeTree()).toBe(first); // stable

		await writeFile(join(assetsRoot(), "skill", "triage", "SKILL.md"), "two");
		const second = await worktreeTree();
		expect(await differs(first, second, "skill/triage")).toBe(true);
		expect(await differs(first, first, "skill/triage")).toBe(false);
		expect(await differs(first, second, "skill/other")).toBe(false);
	});

	it("notices an added and a removed file", async () => {
		await ensureRepo();
		await mkdir(join(assetsRoot(), "skill", "a"), { recursive: true });
		await writeFile(join(assetsRoot(), "skill", "a", "SKILL.md"), "x");
		const base = await worktreeTree();
		await writeFile(join(assetsRoot(), "skill", "a", "extra.md"), "y");
		expect(await differs(base, await worktreeTree(), "skill/a")).toBe(true);
	});
});

describe("credentials", () => {

	it("writes new credentials outside HARNESS_HOME", async () => {
		await writeCredentials({ api_url: "http://x", token: "t2" });
		expect(credentialsPath().startsWith(`${home}/cfg`)).toBe(true);
		expect((await readCredentials()).token).toBe("t2");
	});
});
