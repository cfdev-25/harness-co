import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adopt, reset, status } from "../src/assets.js";
import { assetsRoot, type Manifest } from "../src/core.js";
import { hydrate } from "../src/hydrate.js";

const saved = { ...process.env };
let printed: string[];

beforeEach(async () => {
	process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-assets-"));
	printed = [];
	vi.spyOn(console, "log").mockImplementation((...parts) => printed.push(parts.join(" ")));
});
afterEach(() => {
	vi.restoreAllMocks();
	process.env = { ...saved };
});

const b64 = (text: string) => Buffer.from(text).toString("base64");

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

describe("status", () => {
	it("says nothing has been delivered before the first run", async () => {
		await status();
		expect(printed.join(" ")).toContain("No team assets yet");
	});

	it("reports clean, then modified, then clean again after reset", async () => {
		await hydrate(manifest("one"), () => {});
		await status();
		expect(printed.join(" ")).toMatch(/skill\/triage\s+clean/);

		await writeFile(skill(), "mine");
		printed = [];
		await status();
		expect(printed.join(" ")).toMatch(/skill\/triage\s+modified/);

		printed = [];
		await reset(["skill/triage", "--yes"]);
		expect(await readFile(skill(), "utf8")).toBe("one");
		printed = [];
		await status();
		expect(printed.join(" ")).toMatch(/skill\/triage\s+clean/);
	});

	it("flags a personal override with the team's current version", async () => {
		await hydrate(
			manifest("mine", 1, { asset_id: "t", org_unit_path: "acme.eng", version_id: "t1", seq: 9 }),
			() => {},
		);
		await status();
		expect(printed.join(" ")).toContain("override (team at v9)");
	});
});

describe("reset", () => {
	it("will not discard work without consent", async () => {
		await hydrate(manifest("one"), () => {});
		await writeFile(skill(), "mine");
		await expect(reset(["skill/triage"])).rejects.toThrow(/--yes/);
		expect(await readFile(skill(), "utf8")).toBe("mine");
	});
});

describe("adopt", () => {
	it("moves a hand-made skill into the work tree and infers its kind", async () => {
		const scratch = await mkdtemp(join(tmpdir(), "harness-hand-"));
		const dir = join(scratch, "mine");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "SKILL.md"), "---\nname: handmade\n---\nbody");
		await adopt([dir]);
		expect(await readFile(join(assetsRoot(), "skill", "handmade", "SKILL.md"), "utf8")).toContain("body");
		await expect(stat(dir)).rejects.toThrow();
	});

	it("refuses a directory that is neither a skill nor a tool", async () => {
		const scratch = await mkdtemp(join(tmpdir(), "harness-hand-"));
		await mkdir(join(scratch, "empty"), { recursive: true });
		await expect(adopt([join(scratch, "empty")])).rejects.toThrow(/SKILL.md|run/);
	});
});
