import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitReader } from "@harness/compose";
import type { Composed, HarnessDef } from "@harness/compose/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureRepo } from "../src/git.js";
import { hydrate, type Versions } from "../src/hydrate.js";
import { assetsGitDir, assetsRoot } from "../src/selection.js";

const saved = { ...process.env };
let notes: string[];

beforeEach(async () => {
	process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-hyd-"));
	notes = [];
	await ensureRepo();
});
afterEach(() => {
	process.env = { ...saved };
});

interface Asset {
	key: string;
	id: string;
	files: Record<string, string>;
	shadows?: { from: string; tree: string };
}

/**
 * A `Composed` whose `tree` is a real tree in `assets.git`, built the way
 * `compose` builds it (01 §6 steps 13–14): blobs, one tree per asset, one per
 * kind, and `versions.json` at the root (01 §7.5).
 */
async function composedOf(assets: Asset[], harnesses: HarnessDef[] = []): Promise<Composed> {
	const reader = gitReader(assetsGitDir());
	const versions: Versions = {};
	const byKind = new Map<string, Array<{ name: string; mode: string; oid: string }>>();
	for (const asset of assets) {
		const [kind, name] = asset.key.split("/");
		const entries = [];
		for (const [path, body] of Object.entries(asset.files)) {
			entries.push({ name: path, mode: "100644", oid: await reader.write(new TextEncoder().encode(body)) });
		}
		const tree = await reader.mktree(entries.sort((a, b) => (a.name < b.name ? -1 : 1)));
		versions[asset.key] = { id: asset.id, kind, from: "acme", commit: "c0", tree, required: false, ...(asset.shadows ? { shadows: asset.shadows } : {}) };
		byKind.set(kind, [...(byKind.get(kind) ?? []), { name, mode: "040000", oid: tree }]);
	}
	const sorted: Versions = {};
	for (const key of Object.keys(versions).sort()) sorted[key] = versions[key];
	const root = [{ name: "versions.json", mode: "100644", oid: await reader.write(new TextEncoder().encode(`${JSON.stringify(sorted, null, 2)}\n`)) }];
	for (const [kind, entries] of [...byKind].sort()) root.push({ name: kind, mode: "040000", oid: await reader.mktree(entries) });
	const tree = await reader.mktree(root.sort((a, b) => ((a.mode === "040000" ? `${a.name}/` : a.name) < (b.mode === "040000" ? `${b.name}/` : b.name) ? -1 : 1)));
	return { chain: [], assets: [], conflicts: [], harnesses, policy: { required: [], recommended: [] } as unknown as Composed["policy"], tree };
}

/** One skill, `skill/triage`, as the five rows of `asset-sync.md` §4 use it. */
const one = (body: string, shadows?: { from: string; tree: string }) =>
	composedOf([{ key: "skill/triage", id: "a1", files: { "SKILL.md": body }, shadows }]);

const skill = () => join(assetsRoot(), "skill", "triage", "SKILL.md");
const run = async (composed: Promise<Composed> | Composed) => hydrate(await composed, (message) => notes.push(message));
const read = () => readFile(skill(), "utf8");
const edit = (text: string) => writeFile(skill(), text);

describe("hydrate", () => {
	it("row 2: writes a delivered asset into a fresh work tree", async () => {
		await run(one("one"));
		expect(await read()).toBe("one");
		expect(notes).toEqual([]);
	});

	it("is idempotent: a second run with no change writes nothing", async () => {
		await run(one("one"));
		const before = (await stat(skill())).mtimeMs;
		notes = [];
		await run(one("one"));
		expect((await stat(skill())).mtimeMs).toBe(before);
		expect(notes).toEqual([]);
	});

	it("row 4: keeps a local edit when the team has not moved", async () => {
		await run(one("one"));
		await edit("mine");
		notes = [];
		await run(one("one"));
		expect(await read()).toBe("mine");
		expect(notes).toEqual([]);
	});

	it("resubscribed_key_is_laid_out_again", async () => {
		// 01 §8: a key row 0 removed is absent, not edited; named again, it is taken.
		const withA = (assets: string[]) =>
			composedOf([{ key: "skill/triage", id: "a1", files: { "SKILL.md": "one" } }], [{ id: "h", name: "H", description: "", icon: { palette: [], rows: [] }, assets }]);
		await run(withA(["a1"]));
		expect(await read()).toBe("one");
		await run(withA([]));
		await expect(read()).rejects.toThrow();
		notes = [];
		await run(withA(["a1"]));
		expect(await read()).toBe("one");
		expect(notes).toEqual(["Updated skill/triage."]);
	});

	it("row 5: keeps a local edit and reports a conflict when both moved", async () => {
		await run(one("one"));
		await edit("mine");
		notes = [];
		await run(one("theirs"));
		expect(await read()).toBe("mine");
		expect(notes.join(" ")).toContain("you changed it and the team changed it");
	});

	it("row 1: converges silently when the local edit equals the new delivery", async () => {
		await run(one("one"));
		await edit("theirs");
		notes = [];
		await run(one("theirs"));
		expect(await read()).toBe("theirs");
		expect(notes).toEqual([]);
		await run(one("third"));
		expect(await read()).toBe("third");
	});

	it("row 3: applies a team update, including a removed file", async () => {
		await run(composedOf([{ key: "skill/triage", id: "a1", files: { "SKILL.md": "one", "extra.md": "x" } }]));
		expect(await stat(join(assetsRoot(), "skill", "triage", "extra.md"))).toBeTruthy();
		notes = [];
		await run(one("two"));
		expect(await read()).toBe("two");
		await expect(stat(join(assetsRoot(), "skill", "triage", "extra.md"))).rejects.toThrow();
		expect(notes.join(" ")).toContain("Updated skill/triage");
	});

	it("row 2b: leaves a hand-made directory alone and says so", async () => {
		await mkdir(join(assetsRoot(), "skill", "triage"), { recursive: true });
		await edit("hand-made");
		await run(one("one"));
		expect(await read()).toBe("hand-made");
		expect(notes.join(" ")).toContain("never delivered");
	});

	it("row 1 beats row 2b: a hand-made directory equal to the delivery is silent", async () => {
		await mkdir(join(assetsRoot(), "skill", "triage"), { recursive: true });
		await edit("one");
		await run(one("one"));
		expect(notes).toEqual([]);
		expect(await read()).toBe("one");
	});

	it("removes a withdrawn asset only when the work tree is clean", async () => {
		await run(one("one"));
		notes = [];
		await run(composedOf([]));
		await expect(stat(skill())).rejects.toThrow();
		expect(notes.join(" ")).toContain("no longer provided");

		await run(one("one"));
		await edit("mine");
		notes = [];
		await run(composedOf([]));
		expect(await read()).toBe("mine");
		expect(notes.join(" ")).toContain("your local copy is kept");
	});

	it("reports when the team's copy behind a personal override moves (01 §7.5)", async () => {
		await run(one("mine", { from: "acme", tree: "t1" }));
		notes = [];
		await run(one("mine", { from: "acme", tree: "t1" }));
		expect(notes).toEqual([]);
		await run(one("mine", { from: "acme", tree: "t2" }));
		expect(notes.join(" ")).toContain("moved on but your personal override is in effect");
	});
});

describe("row 0 — sparse materialisation (01 §8)", () => {
	const harness = (assets: string[]): HarnessDef => ({ id: "h1", name: "h", description: "", icon: { palette: [], rows: [] }, assets });

	it("materialises only what a harness on the chain names", async () => {
		await run(
			composedOf(
				[
					{ key: "skill/triage", id: "a1", files: { "SKILL.md": "one" } },
					{ key: "skill/other", id: "a2", files: { "SKILL.md": "two" } },
				],
				[harness(["a1"])],
			),
		);
		expect(await read()).toBe("one");
		await expect(stat(join(assetsRoot(), "skill", "other"))).rejects.toThrow();
	});

	it("no harness on the chain is no filter at all", async () => {
		await run(composedOf([{ key: "skill/other", id: "a2", files: { "SKILL.md": "two" } }], []));
		expect(await readFile(join(assetsRoot(), "skill", "other", "SKILL.md"), "utf8")).toBe("two");
	});

	const both: Asset[] = [
		{ key: "skill/triage", id: "a1", files: { "SKILL.md": "one" } },
		{ key: "skill/other", id: "a2", files: { "SKILL.md": "two" } },
	];

	it("removes a key that left the subscription when it is clean", async () => {
		await run(composedOf(both, [harness(["a1", "a2"])]));
		notes = [];
		await run(composedOf(both, [harness(["a1"])]));
		await expect(stat(join(assetsRoot(), "skill", "other"))).rejects.toThrow();
		expect(notes.join(" ")).toContain("is not in any of your harnesses; removed");
	});

	it("keeps a key that left the subscription when it is dirty", async () => {
		await run(composedOf(both, [harness(["a1", "a2"])]));
		await writeFile(join(assetsRoot(), "skill", "other", "SKILL.md"), "mine");
		notes = [];
		await run(composedOf(both, [harness(["a1"])]));
		expect(await readFile(join(assetsRoot(), "skill", "other", "SKILL.md"), "utf8")).toBe("mine");
		expect(notes.join(" ")).toContain("kept because you changed it");
	});
});

describe("file modes", () => {
	it("restores a tool's executable bit and does not treat mode as a change", async () => {
		const tool = () => composedOf([{ key: "tool/greet", id: "t1", files: { run: "#!/bin/sh\necho hi\n" } }]);
		await run(tool());
		const path = join(assetsRoot(), "tool", "greet", "run");
		expect((await stat(path)).mode & 0o111).toBeGreaterThan(0);

		// The delivery carries contents, not modes. If mode counted as a
		// difference every tool would be permanently conflicted.
		notes = [];
		await run(tool());
		expect(notes).toEqual([]);
	});
});
