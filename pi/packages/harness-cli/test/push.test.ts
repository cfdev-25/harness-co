import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
let existing: unknown[] = [];
let failWith: { status: number; detail?: unknown } | undefined;

vi.mock("../src/api.js", () => ({
	api: async (_credentials: unknown, path: string, init?: { body?: string }) => {
		if (path === "/v1/me") return { org_unit_id: "unit-1" };
		if (path.startsWith("/v1/org-units/")) return existing;
		calls.push({ path, body: init?.body ? JSON.parse(init.body) : {} });
		if (failWith) {
			const error = Object.assign(new Error("conflict"), failWith);
			failWith = undefined;
			throw error;
		}
		return { id: "asset-1" };
	},
}));

const { pushAsset } = await import("../src/index.js");
const { assetsRoot } = await import("../src/core.js");
const { g } = await import("../src/git.js");

const saved = { ...process.env };
beforeEach(async () => {
	process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-push-"));
	process.env.HARNESS_CREDENTIALS = join(process.env.HARNESS_HOME, "cfg.json");
	await writeFile(process.env.HARNESS_CREDENTIALS, JSON.stringify({ api_url: "http://x", token: "t" }));
	calls.length = 0;
	existing = [];
	failWith = undefined;
	process.exitCode = undefined;
});
afterEach(() => {
	process.env = { ...saved };
	process.exitCode = undefined;
});

async function make(kind: "skill" | "tool", name: string): Promise<string> {
	const dir = join(assetsRoot(), kind, name);
	await mkdir(dir, { recursive: true });
	if (kind === "skill") await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\n---\nbody`);
	else {
		await writeFile(join(dir, "run"), "#!/bin/sh\necho hi\n");
		await chmod(join(dir, "run"), 0o755);
	}
	return dir;
}

describe("push", () => {
	it("pushes a skill and records one commit touching only that asset", async () => {
		const dir = await make("skill", "triage");
		await pushAsset([dir, "--message", "first"]);
		expect(calls[0].path).toBe("/v1/assets");
		expect(calls[0].body).toMatchObject({ kind: "skill", name: "triage", org_unit_id: "unit-1" });
		expect(await g("log", "--format=%s")).toBe("first");
		expect(await g("show", "--name-only", "--format=", "HEAD")).toBe("skill/triage/SKILL.md");
	});

	it("recognises a tool directory by its run executable", async () => {
		const dir = await make("tool", "deploy");
		await pushAsset([dir, "--message", "tool"]);
		expect(calls[0].body).toMatchObject({ kind: "tool", name: "deploy" });
	});

	it("refuses to resolve a conflict for you when nobody is watching", async () => {
		const dir = await make("skill", "triage");
		await pushAsset([dir, "--message", "first"]);
		calls.length = 0;
		// A second push, where the asset now exists and the server says the head moved.
		existing = [{ id: "asset-1", kind: "skill", name: "triage", head_version_id: "v1" }];
		failWith = { status: 409, detail: { head: { message: "theirs", author: "cass", version_id: "v9" } } };
		await pushAsset([dir, "--message", "second", "--non-interactive"]);
		expect(process.exitCode).toBe(1);
		// The failed attempt only; no override was sent.
		expect(calls).toHaveLength(1);
	});
});
