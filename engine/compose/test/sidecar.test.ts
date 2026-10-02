import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { compose } from "../src/compose.js";
import { fixtureCases, gitFixture } from "../src/fixtures.js";
import { gitReader } from "../src/reader-git.js";
import { readSidecar } from "../src/sidecar.js";

/** 01 §5's three named tests, tier T2 against a bare repo. */
const cases = fixtureCases(fileURLToPath(new URL("../fixtures", import.meta.url)));
let work: string;

beforeAll(async () => {
	work = await mkdtemp(join(tmpdir(), "compose-sidecar-"));
});
afterAll(async () => {
	await rm(work, { recursive: true, force: true });
});

async function composeCase(name: string) {
	const found = cases.find((entry) => entry.name === name);
	if (!found) throw new Error(`no fixture called ${name}`);
	const repo = join(work, `${name}.git`);
	const { chain } = await gitFixture(found.dir, repo, work);
	return { composed: await compose(chain, gitReader(repo)), repo };
}

it("override_keeps_id", async () => {
	const { composed } = await composeCase("override-keeps-id");
	// D3: the person edited a delivered directory; the sidecar was left alone.
	expect(composed.assets).toHaveLength(1);
	const [deploy] = composed.assets;
	expect(deploy.id).toBe("6f1c9a2e-3b0d-4c7e-9a51-2f0e8b7d4c11");
	expect(deploy.from.kind).toBe("user");
	expect(deploy.shadows?.from.path).toBe("acme.marketing");
	expect(composed.conflicts).toEqual([]);
});

it("new_id_at_existing_path_is_refused", async () => {
	const { composed } = await composeCase("same-path-different-id");
	expect(composed.conflicts).toEqual([
		{
			kind: "same-path-different-id",
			path: "tool/deploy",
			a: { id: "6f1c9a2e-3b0d-4c7e-9a51-2f0e8b7d4c11", from: composed.chain[0] },
			b: { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", from: composed.chain[2] },
		},
	]);
	// Fail closed: neither id can be loaded, so nothing is at that path.
	expect(composed.assets).toEqual([]);
});

it("rename_follows_id", async () => {
	const { composed, repo } = await composeCase("rename-follows-id");
	const [asset] = composed.assets;
	expect(asset.name).toBe("ship");
	expect(asset.id).toBe("6f1c9a2e-3b0d-4c7e-9a51-2f0e8b7d4c11");
	const reader = gitReader(repo);
	// versions.json shows the key moved: the old name is gone from the delivery.
	const root = await reader.ls(composed.tree, "");
	const versions = JSON.parse(
		new TextDecoder().decode(await reader.cat(root.find((entry) => entry.name === "versions.json")?.oid as string)),
	);
	expect(Object.keys(versions)).toEqual(["tool/ship"]);
	expect(versions["tool/ship"].shadows.from).toBe("acme");
});

it("a directory with no asset.json is not an asset", async () => {
	const { composed } = await composeCase("unknown-kind");
	expect(composed.conflicts.map((conflict) => conflict.kind)).toEqual(["unknown-kind"]);
});

it("a sidecar's description is optional and shown on the row (WS3a)", () => {
	const bytes = new TextEncoder().encode(
		JSON.stringify({ id: "6f1c9a2e-3b0d-4c7e-9a51-2f0e8b7d4c11", kind: "tool", description: "Ships it." }),
	);
	const sidecar = readSidecar(bytes, "tool");
	expect(sidecar).toEqual({
		id: "6f1c9a2e-3b0d-4c7e-9a51-2f0e8b7d4c11",
		kind: "tool",
		description: "Ships it.",
	});
});

it("a sidecar with no description still reads (it is optional, not required)", () => {
	const bytes = new TextEncoder().encode(JSON.stringify({ id: "6f1c9a2e-3b0d-4c7e-9a51-2f0e8b7d4c11", kind: "tool" }));
	expect(readSidecar(bytes, "tool")).toEqual({ id: "6f1c9a2e-3b0d-4c7e-9a51-2f0e8b7d4c11", kind: "tool" });
});

it("a tool's sidecar may name the environment it needs, and compose stays out of it (W5-D15)", () => {
	const bytes = new TextEncoder().encode(
		JSON.stringify({
			id: "6f1c9a2e-3b0d-4c7e-9a51-2f0e8b7d4c11",
			kind: "tool",
			needs: [{ kind: "environment", name: "python-data" }],
		}),
	);
	// The need validates and is carried through verbatim. It resolves nothing
	// here — no slot, no load set entry: the store reads it when the person
	// ticks the tool (console 04 §12) and the engine never does.
	expect(readSidecar(bytes, "tool")).toEqual({
		id: "6f1c9a2e-3b0d-4c7e-9a51-2f0e8b7d4c11",
		kind: "tool",
		needs: [{ kind: "environment", name: "python-data" }],
	});
});

it("an environment need without a name is refused like every other shape", () => {
	const bytes = new TextEncoder().encode(
		JSON.stringify({ id: "6f1c9a2e-3b0d-4c7e-9a51-2f0e8b7d4c11", kind: "tool", needs: [{ kind: "environment" }] }),
	);
	// A failed read is the reason, which compose turns into `malformed`.
	expect(typeof readSidecar(bytes, "tool")).toBe("string");
});
