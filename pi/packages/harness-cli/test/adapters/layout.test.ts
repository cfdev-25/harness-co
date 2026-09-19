import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deniedToolDirs, grantedCapabilities, toolIsGranted } from "../../src/adapters/layout.js";
import type { Manifest } from "../../src/core.js";

const model = { provider: "p", model_id: "m", base_url: "http://x", key_ref: "r", env_var: "E" };

function manifestWith(allowedTools: string[] | undefined, tools: string[], harnessTools?: string[]): Manifest {
	return {
		user: { auth_user_id: "u", org_unit_path: "acme" },
		harness: harnessTools
			? {
					id: "h1",
					name: "Support",
					description: "",
					icon: { palette: [], rows: [] },
					org_unit_path: "acme",
					assets: harnessTools.map((name) => ({ kind: "tool", name })),
				}
			: undefined,
		assets: tools.map((name) => ({ kind: "tool", name, files: [] })),
		boundary: allowedTools === undefined ? {} : { allowed_tools: allowedTools },
		model,
	} as unknown as Manifest;
}

describe("grantedCapabilities", () => {
	it("is null (unconstrained) when the boundary never set allowed_tools", () => {
		expect(grantedCapabilities(manifestWith(undefined, []))).toBeNull();
	});

	it("is the exact set the boundary named, including an explicit empty list", () => {
		expect(grantedCapabilities(manifestWith(["process.exec"], []))).toEqual(new Set(["process.exec"]));
		expect(grantedCapabilities(manifestWith([], []))?.size).toBe(0);
	});
});

describe("toolIsGranted", () => {
	it("is true for any name when the boundary is unconstrained", () => {
		expect(toolIsGranted(manifestWith(undefined, ["deploy"]), "deploy")).toBe(true);
	});

	it("requires its own tool.<name> capability once the boundary constrains tools at all", () => {
		const manifest = manifestWith(["process.exec", "tool.deploy"], ["deploy", "migrate"]);
		expect(toolIsGranted(manifest, "deploy")).toBe(true);
		expect(toolIsGranted(manifest, "migrate")).toBe(false);
	});
});

describe("deniedToolDirs", () => {
	async function toolDir(root: string, name: string): Promise<void> {
		await mkdir(join(root, "tool", name), { recursive: true });
	}

	it("denies nothing when tool/ was never hydrated", async () => {
		const root = await mkdtemp(join(tmpdir(), "denied-none-"));
		expect(await deniedToolDirs(manifestWith(undefined, []), root)).toEqual([]);
	});

	it("denies a tool the harness excludes, fail-closed for names the manifest never mentions", async () => {
		const root = await mkdtemp(join(tmpdir(), "denied-harness-"));
		await toolDir(root, "deploy");
		await toolDir(root, "always");
		await toolDir(root, "orphaned"); // On disk, but not in the manifest at all.
		const manifest = manifestWith(undefined, ["deploy", "always"], ["always"]);
		const denied = await deniedToolDirs(manifest, root);
		expect(denied.sort()).toEqual([join(root, "tool", "deploy"), join(root, "tool", "orphaned")].sort());
	});

	it("denies a tool the boundary does not permit, even if the harness contains it", async () => {
		const root = await mkdtemp(join(tmpdir(), "denied-capability-"));
		await toolDir(root, "deploy");
		const manifest = manifestWith(["process.exec"], ["deploy"], ["deploy"]);
		expect(await deniedToolDirs(manifest, root)).toEqual([join(root, "tool", "deploy")]);
	});

	it("with a harness that excludes deploy, covers exactly tool/deploy", async () => {
		const root = await mkdtemp(join(tmpdir(), "denied-exact-"));
		await toolDir(root, "deploy");
		await toolDir(root, "always");
		const manifest = manifestWith(undefined, ["deploy", "always"], ["always"]);
		expect(await deniedToolDirs(manifest, root)).toEqual([join(root, "tool", "deploy")]);
	});
});
