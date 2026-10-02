import { join } from "node:path";
import type { ComposedAsset, RenderContext, RenderReport } from "@harness/compose/contracts";
import {
	CONCERNS,
	contextAbout,
	contextIndex,
	delivered,
	deliveredSets,
	environmentIndex,
	firstLineOf,
	hasFile,
	commandDenyRules,
	denyPatterns,
	loadSet,
	newRendered,
	reachLine,
	seam,
	sections,
	symlinkAsset,
	toolIndex,
	workTree,
	writeGenerated,
} from "../layout.js";
import { AUDIT_HOOK_SCRIPT } from "./audit-hook.js";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** W5-D11: the brief, as a file under `agentDir`, named by `launch`. */
export const SYSTEM_PROMPT_FILE = "system-prompt.md";

export async function render(ctx: RenderContext): Promise<RenderReport> {
	const { agentDir, assetsRoot, choices, composed, plan, proxyUrl, sessionDir, workspace } = ctx;
	const { loaded } = loadSet(composed, choices);
	const tree = workTree(assetsRoot);
	const r = newRendered();
	const byKind = (kind: string): ComposedAsset[] => loaded.filter((asset) => asset.kind === kind);
	const dropped: RenderReport["dropped"] = [];
	// One count of the delivery, shared with the boot screen (W5-D12).
	const sets = deliveredSets(loaded);

	// Symlinks, never the plugin marketplace (C10): the marketplace loses the
	// cold-start race on every fresh config dir (Spike 0b).
	for (const skill of byKind("skill")) {
		await symlinkAsset(r, agentDir, join("skills", skill.name), assetsRoot, "skill", skill.name);
		r.concerns.skill.push(skill.id);
	}
	for (const prompt of byKind("prompt")) {
		const files = tree.files("prompt", prompt.name);
		if (files.length !== 1) {
			dropped.push({ concern: "prompt", why: `${prompt.name} holds ${files.length} files; a prompt is one file.` });
			continue;
		}
		await symlinkAsset(r, agentDir, join("commands", `${prompt.name}.md`), assetsRoot, "prompt", prompt.name, files[0]);
		r.concerns.prompt.push(prompt.id);
	}

	// The same ordering function as Pi's AGENTS.md.
	const systemPrompts = byKind("system_prompt");
	const memories = byKind("memory");
	const tools = byKind("tool");
	r.concerns.system_prompt = systemPrompts.map((asset) => asset.id);
	r.concerns.memory = memories.map((asset) => asset.id);
	r.concerns.tool_index = tools.map((asset) => asset.id);
	// The seam first and unconditionally, so an empty harness still says where
	// an asset the agent makes belongs (07 §6a).
	const instructions = [
		seam(assetsRoot),
		reachLine(plan.reach),
		delivered(sets),
		// W5-D11 (D137): the `system_prompt` assets are no longer a section of
		// this file. They are `system-prompt.md`, which launch passes with
		// `--append-system-prompt-file` — native, and on disk, which is what
		// D91 said argv was not.
		sections(memories, tree.read),
		toolIndex(assetsRoot, tools),
		contextIndex(assetsRoot, byKind("context"), (name) => contextAbout(assetsRoot, name)),
		environmentIndex(assetsRoot, byKind("environment"), (name, file) => hasFile(join(assetsRoot, "environment", name, file)), (name) => firstLineOf(join(assetsRoot, "environment", name, "ENVIRONMENT.md"))),
	]
		.filter(Boolean)
		.join("\n\n");
	await writeGenerated(r, agentDir, "CLAUDE.md", `${instructions}\n`);
	// W5-D11 (D137). Always written, even empty: `--append-system-prompt-file`
	// refuses a path that is not there ("Append system prompt file not found"),
	// so a harness with no brief would make argv depend on the load set. The
	// hash goes into `rendered.json` like every other generated file, so
	// rehydrate compares the file the model will be given, not a string in argv.
	await writeGenerated(r, agentDir, SYSTEM_PROMPT_FILE, systemPrompts.length === 0 ? "" : `${sections(systemPrompts, tree.read)}\n`);
	await writeGenerated(r, agentDir, "audit-hook.cjs", AUDIT_HOOK_SCRIPT);
	// Claude Code runs settings hooks only for a workspace whose trust dialog was
	// accepted, and records that in the config dir's `.claude.json` — which is
	// fresh every session. The workspace is the one `run` was started in, so
	// the trust is ours to record (found 28 Sep: without it every hook was
	// skipped silently and the audit spool stayed empty).
	await writeGenerated(
		r,
		agentDir,
		".claude.json",
		json({ hasCompletedOnboarding: true, projects: { [workspace]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }),
	);

	// Quoted: the hook command runs through a shell, and both paths live under
	// $HOME, which can contain spaces.
	const command = `"${process.execPath}" "${join(agentDir, "audit-hook.cjs")}" "${join(sessionDir, "audit.jsonl")}"`;
	const hook = [{ matcher: "*", hooks: [{ type: "command", command }] }];
	r.hooks = [command, command];
	r.denies = denyPatterns(plan);
	// W6-D153: the command boundaries, as the runtime's own veto. Measured, not
	// assumed: only the patterns 07 §8's table proves `permissions.deny` holds
	// (`claudeHolds`); the rest are Pi's and the console row says *intercepted
	// by Pi*. Unlike the file denies this half is not advisory — a `Bash(…)`
	// rule is what actually refuses the call.
	r.denies.push(...commandDenyRules(plan));
	// WebSearch and WebFetch run on Anthropic's side of the model call, so the
	// fence never sees them. The enforced half is the proxy taking them out of
	// the request body (05 §6a, D134); this is the advisory half, so the model
	// reads a refusal instead of a silence. Both are keyed on the same rule:
	// only `on` permits provider-side browsing.
	if (plan.reach.mode !== "on") r.denies.push("WebFetch", "WebSearch");
	// 07 §7 / 05 §4.2 say the literal `<proxyUrl>/connectors/model`, and 03's
	// `expected()` compares against exactly that, so that is what is written.
	// It is very likely wrong: Node's fetch refuses a URL carrying credentials
	// ("Request cannot be constructed from a URL that includes credentials"),
	// so no fetch-based client can call this address, and 05 §4.3 accepts
	// `Basic` only on `Proxy-Authorization`. The fix is one line on each side —
	// `new URL(proxyUrl).origin` here and in `preflight/preflight.ts` — and the
	// secret then rides only in the header, which is 07 §7's own rationale.
	// The origin, never the credentialed URL — see `pi/render.ts` (07 §7, 05 §4.2).
	r.model = { endpoint: `${new URL(proxyUrl).origin}/connectors/model`, model: choices.model.model };
	// Never named settings.json (C9): under `--setting-sources user` that file
	// is also loaded as the user tier and every hook fires twice.
	await writeGenerated(
		r,
		agentDir,
		"settings.json",
		json({
			hooks: { PostToolUse: hook, PostToolUseFailure: hook },
			// The advisory layer, so the model receives a refusal it can read.
			// The control is the sandbox's geometry (06), which holds whether or
			// not this file is honoured.
			permissions: { deny: r.denies },
			// No `autoUpdatesChannel`: 2.1.286 validates the file and accepts only
			// "latest" | "stable" | "rc", so the "none" written since wave 3 made it
			// reject — and reject the *whole file*, taking the deny list, the hooks
			// and `claudeMdExcludes` with it behind a dialog (D144). The pin's
			// self-update half is `DISABLE_AUTOUPDATER=1` in `launch`, which is
			// enforced and needs no cooperation from a settings schema; no value the
			// schema accepts would have turned updates off anyway (D7, D14).
			// The floor the organisation set, not what happens to be installed (D7, D14).
			minimumVersion: "binary" in choices.provider.pin ? choices.provider.pin.minVersion : choices.located.version,
			claudeMdExcludes: [join(workspace, "CLAUDE.md")],
		}),
	);

	await writeGenerated(r, agentDir, "rendered.json", json(r));
	// Everything §6 does not call `none`, which today is every concern but the
	// native login a session in org mode does not use.
	const honoured = CONCERNS.filter((concern) => concern !== "model_native");
	return { honoured, dropped };
}
