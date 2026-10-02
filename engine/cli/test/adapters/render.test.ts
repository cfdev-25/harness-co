import { lstat, readFile, readdir, readlink, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { claudeAdapter } from "../../src/adapters/claude/index.js";
import { commandRuleSource } from "@harness/compose";
import { reachLine, seam } from "../../src/adapters/layout.js";
import { pi } from "../../src/adapters/pi/index.js";
import { type Fixture, fixture, tokenise } from "./fixture.js";

const goldenDir = fileURLToPath(new URL("./golden/", import.meta.url));

async function walk(dir: string, base = dir): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(path, base)));
		else out.push(relative(base, path));
	}
	return out.sort();
}

/** One golden per provider: every generated file, tokenised, in one document,
    so a change to any of them is one reviewable diff. */
async function snapshot(f: Fixture): Promise<string> {
	const parts: string[] = [];
	for (const rel of await walk(f.agentDir)) {
		const path = join(f.agentDir, rel);
		if ((await lstat(path)).isSymbolicLink()) {
			parts.push(`=== ${rel} -> ${tokenise(await readlink(path), f)}`);
			continue;
		}
		parts.push(`=== ${rel}\n${tokenise(await readFile(path, "utf8"), f)}`);
	}
	return parts.join("\n");
}

async function check(name: string, actual: string) {
	const path = join(goldenDir, name);
	if (process.env.UPDATE_GOLDEN) {
		await (await import("node:fs/promises")).writeFile(path, actual);
		return;
	}
	expect(actual).toBe(await readFile(path, "utf8"));
}

describe("render", () => {
	it("pi_render_matches_golden", async () => {
		const f = await fixture();
		const report = await pi.render(f.ctx);
		expect(report.dropped).toEqual([]);
		await check("pi.txt", await snapshot(f));
	});

	it("claude_render_matches_golden", async () => {
		const f = await fixture();
		await claudeAdapter.render(f.ctx);
		const rendered = JSON.parse(await readFile(join(f.agentDir, "rendered.json"), "utf8")) as {
			links: Record<string, string>;
		};
		// Links are recorded with their targets, which is what rehydrate reads back.
		expect(rendered.links).toEqual({
			"skills/quokka": join(f.assetsRoot, "skill", "quokka"),
			"commands/standup.md": join(f.assetsRoot, "prompt", "standup", "standup.md"),
		});
		await check("claude.txt", await snapshot(f));
	});

	it("brief_starts_with_the_seam_paragraph", async () => {
		for (const [adapter, brief] of [
			[pi, "AGENTS.md"],
			[claudeAdapter, "CLAUDE.md"],
		] as const) {
			const f = await fixture();
			await adapter.render(f.ctx);
			const text = await readFile(join(f.agentDir, brief), "utf8");
			// The real `assetsRoot`, never a literal `~/.harness` (07 §6a).
			expect(text.startsWith(`Harness assets live at \`${f.assetsRoot}/<kind>/<name>/\``)).toBe(true);
			expect(text).not.toContain("~/.harness");
			// Before any asset section, whichever asset happens to sort first.
			expect(text.indexOf("## ")).toBeGreaterThan(text.indexOf("harness-authoring"));

			// An empty harness gets it too: there is no other content to carry it.
			const empty = await fixture();
			empty.ctx.composed.assets = [];
			await adapter.render(empty.ctx);
			// D131's line is beside it and just as unconditional: a session always
			// knows where an asset belongs and how far it can reach.
			expect(await readFile(join(empty.agentDir, brief), "utf8")).toBe(
				`${seam(empty.assetsRoot)}\n\n${reachLine(empty.ctx.plan.reach)}\n\nThis harness delivers no assets yet.\n`,
			);
		}
	});

	it("claude_settings_is_the_user_tier", async () => {
		// C9, revised 28 Sep: one file, one tier — `settings.json` under
		// `--setting-sources user`; nothing goes through `--settings`.
		const f = await fixture();
		await claudeAdapter.render(f.ctx);
		const files = await walk(f.agentDir);
		expect(files).toContain("settings.json");
		expect(files).not.toContain("claude-settings.json");
	});

	it("brief_indexes_context_assets_by_path", async () => {
		// D30k: a context asset is listed with its directory and its first line, never inlined.
		const f = await fixture();
		await claudeAdapter.render(f.ctx);
		const brief = await readFile(join(f.agentDir, "CLAUDE.md"), "utf8");
		expect(brief).toContain("## Context");
		expect(brief).toContain(`\`brand-assets\` — \`${f.assetsRoot}/context/brand-assets/\` — Colours, logos and the deck template.`);
		expect(brief).not.toContain("primary: #c8875a");
	});

	it("brief_indexes_environment_assets_with_their_apply_command", async () => {
		// D30m: an environment asset declares; the session applies it through the fence.
		const f = await fixture();
		await claudeAdapter.render(f.ctx);
		const brief = await readFile(join(f.agentDir, "CLAUDE.md"), "utf8");
		expect(brief).toContain("## Environment");
		expect(brief).toContain(`\`deck-tools\` — What the deck tool needs. — apply with \`pip install -r ${f.assetsRoot}/environment/deck-tools/requirements.txt\``);
	});

	it("claude_records_workspace_trust", async () => {
		const f = await fixture();
		await claudeAdapter.render(f.ctx);
		const state = JSON.parse(await readFile(join(f.agentDir, ".claude.json"), "utf8")) as { projects: Record<string, { hasTrustDialogAccepted: boolean }> };
		expect(state.projects[f.ctx.workspace]?.hasTrustDialogAccepted).toBe(true);
	});

	it("claude_denies_web_tools_unless_reach_is_on", async () => {
		// Server-side tools never meet the fence, so the enforced half is the
		// proxy shaping the request (D134); this is the advisory half, and the
		// two are keyed on the same rule — only `on` permits them (D131).
		const off = await fixture();
		await claudeAdapter.render(off.ctx);
		const denies = async (f: Awaited<ReturnType<typeof fixture>>) =>
			(JSON.parse(await readFile(join(f.agentDir, "settings.json"), "utf8")) as { permissions: { deny: string[] } }).permissions.deny;
		expect(await denies(off)).toEqual(expect.arrayContaining(["WebSearch", "WebFetch"]));

		const on = await fixture();
		on.ctx.plan.reach = { mode: "on", hosts: [], setBy: "acme" };
		await claudeAdapter.render(on.ctx);
		expect(await denies(on)).not.toEqual(expect.arrayContaining(["WebSearch"]));
	});

	it("a_command_boundary_reaches_claudes_settings_and_pis_policy", async () => {
		// W6-D153. The runtime's own veto, from the plan. Claude Code gets a
		// `permissions.deny` rule — but **only** for a pattern 07 §8's table
		// proved it holds: a pattern with a shell operator matches no subcommand
		// of anything, so writing `Bash(curl * | sh)` would claim a refusal
		// nobody measured. Pi gets both, with the compiled rule beside each.
		const f = await fixture();
		await claudeAdapter.render(f.ctx);
		const deny = (JSON.parse(await readFile(join(f.agentDir, "settings.json"), "utf8")) as { permissions: { deny: string[] } })
			.permissions.deny;
		expect(deny).toContain("Bash(rm -rf /*)");
		expect(deny.some((rule) => rule.includes("curl"))).toBe(false);

		const p = await fixture();
		await pi.render(p.ctx);
		const policy = JSON.parse(await readFile(join(p.agentDir, "policy.json"), "utf8")) as {
			commands: Array<{ id: string; pattern: string; reason: string; match: string }>;
		};
		expect(policy.commands.map((one) => one.pattern)).toEqual(["rm -rf /*", "curl * | sh"]);
		// The rule the extension applies is the one `@harness/compose` compiled,
		// so a `bash` call is answered the same way in both places.
		for (const one of policy.commands) expect(one.match).toBe(commandRuleSource(one.pattern));
		expect(new RegExp(policy.commands[0].match).test("cd /tmp && rm -rf /var/x")).toBe(true);

		// A plan with no command boundary writes neither, rather than an empty
		// claim: `permissions.deny` keeps only the file denies it always had.
		const none = await fixture();
		none.ctx.plan.commands = [];
		await claudeAdapter.render(none.ctx);
		const bare = (JSON.parse(await readFile(join(none.agentDir, "settings.json"), "utf8")) as { permissions: { deny: string[] } })
			.permissions.deny;
		expect(bare.some((rule) => rule.startsWith("Bash("))).toBe(false);
	});

	it("hooks_cover_failure_events", async () => {
		const f = await fixture();
		await claudeAdapter.render(f.ctx);
		const settings = JSON.parse(await readFile(join(f.agentDir, "settings.json"), "utf8")) as {
			hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
		};
		expect(Object.keys(settings.hooks).sort()).toEqual(["PostToolUse", "PostToolUseFailure"]);
		expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe(settings.hooks.PostToolUseFailure[0].hooks[0].command);
	});

	it("render_writes_only_under_agent_dir", async () => {
		for (const adapter of [pi, claudeAdapter]) {
			const f = await fixture();
			const before = await walk(f.root);
			await adapter.render(f.ctx);
			const after = await walk(f.root);
			const added = after.filter((path) => !before.includes(path));
			const agentRel = relative(f.root, f.agentDir);
			expect(added.every((path) => path.startsWith(`${agentRel}/`))).toBe(true);
			expect(added.length).toBeGreaterThan(0);
		}
	});

	it("render_copies_nothing", async () => {
		const sources = new Set<string>();
		for (const kind of ["skill", "prompt"]) sources.add(kind);
		for (const adapter of [pi, claudeAdapter]) {
			const f = await fixture();
			await adapter.render(f.ctx);
			const assetBodies = new Set([
				await readFile(join(f.assetsRoot, "skill", "quokka", "SKILL.md"), "utf8"),
				await readFile(join(f.assetsRoot, "prompt", "standup", "standup.md"), "utf8"),
			]);
			for (const rel of await walk(f.agentDir)) {
				const path = join(f.agentDir, rel);
				// A link is fine; a regular file with an asset's bytes is a copy.
				if ((await lstat(path)).isSymbolicLink()) continue;
				if (!(await stat(path)).isFile()) continue;
				expect(assetBodies.has(await readFile(path, "utf8"))).toBe(false);
			}
			// Pi keeps no skill directory at all; Claude keeps a link, never a copy.
			expect((await walk(f.agentDir)).some((rel) => rel.startsWith("skills/"))).toBe(adapter === claudeAdapter);
		}
		expect(sources.size).toBe(2);
	});

	it("adapter_cannot_add_host", async () => {
		// Structural: render and launch receive the plan read-only. A frozen
		// plan proves it — a write throws in a strict-mode module.
		for (const adapter of [pi, claudeAdapter]) {
			const f = await fixture();
			Object.freeze(f.ctx.plan);
			Object.freeze(f.ctx.plan.hosts);
			Object.freeze(f.ctx.plan.filesystem);
			await adapter.render(f.ctx);
			adapter.launch(f.ctx, f.ctx.choices.located);
			expect(f.ctx.plan.hosts).toEqual(["openrouter.ai"]);
		}
	});
});

it("pi_native_session_is_pis_own_sign_in", async () => {
	// D11 / W7-D2: no connector, no `harness` provider; Pi's own provider is the
	// default and the plan's model is null, which is what drift expects.
	const f = await fixture();
	const ctx = { ...f.ctx, choices: { ...f.ctx.choices, native: true } };
	await pi.render(ctx);
	const settings = JSON.parse(await readFile(join(f.agentDir, "settings.json"), "utf8")) as { defaultProvider: string; defaultModel: string };
	expect(settings.defaultProvider).toBe(f.ctx.choices.model.provider.id);
	expect(settings.defaultModel).toBe(f.ctx.choices.model.model);
	await expect(readFile(join(f.agentDir, "models.json"), "utf8")).rejects.toThrow();
	const rendered = JSON.parse(await readFile(join(f.agentDir, "rendered.json"), "utf8")) as { model: unknown };
	expect(rendered.model).toBeNull();
});
