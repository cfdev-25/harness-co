import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assetsRoot, type Manifest } from "../src/core.js";
import { hydrate } from "../src/hydrate.js";

const saved = { ...process.env };
let notes: string[];

beforeEach(async () => {
	process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-hyd-"));
	notes = [];
});
afterEach(() => {
	process.env = { ...saved };
});

const b64 = (text: string) => Buffer.from(text).toString("base64");

/** A manifest carrying one skill, `skill/triage`. */
function manifest(body: string, seq = 1, shadows: unknown = null): Manifest {
	return {
		user: { auth_user_id: "u", org_unit_path: "acme" },
		assets: [
			{
				name: "triage",
				kind: "skill",
				asset_id: "a1",
				version_id: `v${seq}`,
				version_seq: seq,
				shadows,
				files: [{ path: "SKILL.md", content_b64: b64(body) }],
			},
		],
		boundary: {},
		model: null,
	} as unknown as Manifest;
}

const skill = () => join(assetsRoot(), "skill", "triage", "SKILL.md");
const run = (m: Manifest) => hydrate(m, (message) => notes.push(message));
const read = () => readFile(skill(), "utf8");

async function edit(text: string) {
	await writeFile(skill(), text);
}

describe("hydrate", () => {
	it("row 2: writes a delivered asset into a fresh work tree", async () => {
		await run(manifest("one"));
		expect(await read()).toBe("one");
		expect(notes).toEqual([]);
	});

	it("is idempotent: a second run with no change writes nothing", async () => {
		await run(manifest("one"));
		const before = (await stat(skill())).mtimeMs;
		notes = [];
		await run(manifest("one"));
		expect((await stat(skill())).mtimeMs).toBe(before);
		expect(notes).toEqual([]);
	});

	it("row 4: keeps a local edit when the team has not moved", async () => {
		await run(manifest("one"));
		await edit("mine");
		notes = [];
		await run(manifest("one"));
		expect(await read()).toBe("mine");
		expect(notes).toEqual([]);
	});

	it("row 5: keeps a local edit and reports a conflict when both moved", async () => {
		await run(manifest("one"));
		await edit("mine");
		notes = [];
		await run(manifest("theirs", 2));
		expect(await read()).toBe("mine");
		expect(notes.join(" ")).toContain("you changed it and the team changed it");
	});

	it("row 1: converges silently when the local edit equals the new delivery", async () => {
		await run(manifest("one"));
		await edit("theirs");
		notes = [];
		await run(manifest("theirs", 2));
		expect(await read()).toBe("theirs");
		expect(notes).toEqual([]);
		// The base moved, so a later unrelated delivery is a clean update.
		await run(manifest("third", 3));
		expect(await read()).toBe("third");
	});

	it("row 3: applies a team update, including a removed file", async () => {
		const withExtra = manifest("one");
		withExtra.assets[0].files.push({ path: "extra.md", content_b64: b64("x") });
		await run(withExtra);
		expect(await stat(join(assetsRoot(), "skill", "triage", "extra.md"))).toBeTruthy();
		notes = [];
		await run(manifest("two", 2));
		expect(await read()).toBe("two");
		await expect(stat(join(assetsRoot(), "skill", "triage", "extra.md"))).rejects.toThrow();
		expect(notes.join(" ")).toContain("Updated skill/triage to v2");
	});

	it("row 2b: leaves a hand-made directory alone and says so", async () => {
		await mkdir(join(assetsRoot(), "skill", "triage"), { recursive: true });
		await edit("hand-made");
		await run(manifest("one"));
		expect(await read()).toBe("hand-made");
		expect(notes.join(" ")).toContain("never delivered");
	});

	it("row 1 beats row 2b: a hand-made directory equal to the delivery is silent", async () => {
		await mkdir(join(assetsRoot(), "skill", "triage"), { recursive: true });
		await edit("one");
		await run(manifest("one"));
		expect(notes).toEqual([]);
		expect(await read()).toBe("one");
	});

	it("removes a withdrawn asset only when the work tree is clean", async () => {
		await run(manifest("one"));
		notes = [];
		const empty = { ...manifest("one"), assets: [] } as Manifest;
		await run(empty);
		await expect(stat(skill())).rejects.toThrow();
		expect(notes.join(" ")).toContain("no longer provided");

		// Dirty: kept.
		await run(manifest("one", 5));
		await edit("mine");
		notes = [];
		await run({ ...manifest("one", 5), assets: [] } as Manifest);
		expect(await read()).toBe("mine");
		expect(notes.join(" ")).toContain("your local copy is kept");
	});

	it("reports when the team's version advances behind a personal override", async () => {
		const shadow = (version: string, seq: number) => ({
			asset_id: "team",
			org_unit_path: "acme.eng",
			version_id: version,
			seq,
		});
		await run(manifest("mine", 1, shadow("t1", 4)));
		notes = [];
		await run(manifest("mine", 1, shadow("t1", 4)));
		expect(notes).toEqual([]);
		await run(manifest("mine", 1, shadow("t2", 5)));
		expect(notes.join(" ")).toContain("advanced to v5");
	});
});

describe("file modes", () => {
	it("restores a tool's executable bit and does not treat mode as a change", async () => {
		const tool = {
			user: { auth_user_id: "u", org_unit_path: "acme" },
			assets: [
				{
					name: "greet",
					kind: "tool",
					asset_id: "t1",
					version_id: "v1",
					version_seq: 1,
					shadows: null,
					files: [{ path: "run", content_b64: b64("#!/bin/sh\necho hi\n") }],
				},
			],
			boundary: {},
			model: null,
		} as unknown as Manifest;

		await run(tool);
		const path = join(assetsRoot(), "tool", "greet", "run");
		expect((await stat(path)).mode & 0o111).toBeGreaterThan(0);

		// The server sends contents, not modes. If mode counted as a difference
		// every tool would be permanently conflicted.
		notes = [];
		await run(tool);
		expect(notes).toEqual([]);
	});
});
