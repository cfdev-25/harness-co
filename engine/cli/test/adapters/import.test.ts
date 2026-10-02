import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ComposedAsset, Imported } from "@harness/compose/contracts";
import { claudeAdapter } from "../../src/adapters/claude/index.js";
import { pi } from "../../src/adapters/pi/index.js";
import { importSetup } from "../../src/commands/import.js";
import { assetsRoot } from "../../src/selection.js";
import { fixture } from "./fixture.js";

const saved = { ...process.env };
afterEach(() => {
	process.env = { ...saved };
});

/** A person's own `~/.claude`, built before they had us. */
async function existingSetup(): Promise<{ source: string; workspace: string }> {
	const home = await mkdtemp(join(tmpdir(), "harness-import-"));
	process.env.HARNESS_HOME = join(home, ".harness");
	const source = join(home, ".claude");
	const workspace = join(home, "beacon");
	await mkdir(join(source, "commands"), { recursive: true });
	await mkdir(join(source, "skills", "quokka-beacon"), { recursive: true });
	await mkdir(workspace, { recursive: true });
	await writeFile(
		join(source, "CLAUDE.md"),
		"# Instructions\n\nAlways answer in British English.\n\n# Release process\n\nWe ship on Thursdays.\n",
	);
	await writeFile(join(source, "commands", "standup.md"), "Write today's standup.\n");
	await writeFile(join(source, "skills", "quokka-beacon", "SKILL.md"), "# quokka-beacon\n\nEmit the beacon.\n");
	await writeFile(
		join(source, "settings.json"),
		JSON.stringify({
			permissions: { deny: ["Read(~/.ssh/**)", "Bash(rm *)"] },
			hooks: { PreToolUse: [{ matcher: "*" }], Stop: [] },
			mcpServers: { linear: {} },
			env: { FOO: "1" },
			model: "opus",
			apiKeyHelper: "/bin/echo",
		}),
	);
	return { source, workspace };
}

describe("import", () => {
	it("import_claude_reports_dropped_hooks", async () => {
		const { source, workspace } = await existingSetup();
		const result = await claudeAdapter.import({ dir: source, workspace });
		const what = result.dropped.map((entry) => entry.what);
		expect(what).toContain("hook PreToolUse");
		expect(what).toContain("hook Stop");
		expect(what).toContain("MCP server linear");
		expect(what).toContain("settings.env");
		expect(what).toContain("settings.model");
		expect(what).toContain("settings.apiKeyHelper");
		// A pattern no boundary kind maps is dropped with the pattern quoted.
		expect(what).toContain("permissions.deny `Bash(rm *)`");
		// One that maps carries.
		expect(result.boundaries).toMatchObject([{ kind: "filesystem", value: "~/.ssh/**", holds: "enforced" }]);
		// The heading the person named *Instructions* becomes the system prompt.
		expect(result.assets.map((asset) => `${asset.kind}/${asset.name}`).sort()).toEqual([
			"memory/release-process",
			"prompt/standup",
			"skill/quokka-beacon",
			"system_prompt/instructions",
		]);
		expect(result.harness.name).toBe("beacon");
	});

	it("import_is_idempotent", async () => {
		const { source, workspace } = await existingSetup();
		const ids = async (result: Imported) =>
			Promise.all(
				result.assets.map(async (asset) => (JSON.parse(await readFile(join(asset.path, "asset.json"), "utf8")) as { id: string }).id),
			);
		const first = await claudeAdapter.import({ dir: source, workspace });
		const second = await claudeAdapter.import({ dir: source, workspace });
		expect(await ids(second)).toEqual(await ids(first));
		expect(second.assets.map((a) => a.path)).toEqual(first.assets.map((a) => a.path));
		expect(second.harness.assets).toEqual(first.harness.assets);
	});

	it("imported_claude_harness_runs_on_pi", async () => {
		const { source, workspace } = await existingSetup();
		const imported = await claudeAdapter.import({ dir: source, workspace });
		// Compose is the integration agent's; what this asserts is that Pi's
		// render carries every imported asset through unchanged.
		const f = await fixture({ assetsRoot: assetsRoot() });
		const node = { kind: "user" as const, path: "acme.marketing.sam", ref: "refs/heads/users/sam", commit: "c2" };
		const assets: ComposedAsset[] = [];
		for (const asset of imported.assets) {
			const id = (JSON.parse(await readFile(join(asset.path, "asset.json"), "utf8")) as { id: string }).id;
			assets.push({ id, kind: asset.kind, name: asset.name, from: node, tree: id, sidecar: { id, kind: asset.kind } });
		}
		f.ctx.composed.assets = assets;
		f.ctx.choices.harness = { ...imported.harness, assets: assets.map((asset) => asset.id) };
		const report = await pi.render(f.ctx);
		expect(report.dropped).toEqual([]);
		const agents = await readFile(join(f.agentDir, "AGENTS.md"), "utf8");
		// D137: the imported `system_prompt` is the brief, which is its own file
		// now; the imported memory is still a section of AGENTS.md.
		expect(agents).toContain("We ship on Thursdays.");
		expect(await readFile(join(f.agentDir, "system-prompt.md"), "utf8")).toContain(
			"Always answer in British English.",
		);
		const settings = JSON.parse(await readFile(join(f.agentDir, "settings.json"), "utf8")) as { skills: string[] };
		expect(settings.skills).toEqual([join(assetsRoot(), "skill", "quokka-beacon")]);
		expect(await readFile(join(f.agentDir, "prompts", "standup.md"), "utf8")).toBe("Write today's standup.\n");
	});

	it("import_unknown_provider_refuses_with_the_agentic_remedy", async () => {
		// §11.19's last paragraph and §13: one code, one sentence, one remedy, and
		// the remedy is the agentic path rather than a corrected spelling.
		await expect(importSetup("codex", undefined, undefined)).rejects.toEqual({
			code: "cli.import_unknown_provider",
			message: "No importer for codex. Harness reads Claude Code and Pi setups itself; for anything else the assistant can do it.",
			remedy: "`harness run pi`, then: Extract my codex setup into this harness.",
		});
	});

	it("reads Pi's own setup by the same table", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-import-pi-"));
		process.env.HARNESS_HOME = join(home, ".harness");
		const source = join(home, ".pi", "agent");
		await mkdir(join(source, "prompts"), { recursive: true });
		await writeFile(join(source, "AGENTS.md"), "Just standing context, no headings.\n");
		await writeFile(join(source, "prompts", "recap.md"), "Recap the day.\n");
		const result = await pi.import({ dir: source, workspace: join(home, "work") });
		expect(result.assets.map((asset) => `${asset.kind}/${asset.name}`).sort()).toEqual(["memory/notes", "prompt/recap"]);
	});
});
