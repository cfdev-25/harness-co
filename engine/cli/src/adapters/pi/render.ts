import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { modelBrief, reachBrief } from "../../landing.js";
import { colorMode } from "../../style.js";
import { commandRuleSource } from "@harness/compose";
import type { ComposedAsset, RenderContext, RenderReport } from "@harness/compose/contracts";
import {
	CONCERNS,
	contextAbout,
	contextIndex,
	delivered,
	deliveredCounts,
	deliveredSets,
	environmentIndex,
	firstLineOf,
	hasFile,
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

/** The capability vocabulary (00 §4.3) in Pi's own tool names. Advisory: it
    is what the extension needs to *say*, never what it needs to enforce. */
const PI_TOOLS: Record<string, string[]> = {
	"filesystem.read": ["read", "grep", "find", "ls"],
	"filesystem.write": ["edit", "write"],
	"process.exec": ["bash"],
};

const piNames = (capability: string): string[] =>
	capability.startsWith("tool.") ? [capability.slice(5)] : (PI_TOOLS[capability] ?? []);

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** W5-D11: the brief, as a file under `agentDir`. The extension appends it to
    the runtime's own prompt on `before_agent_start`; `policy.json` names it. */
export const SYSTEM_PROMPT_FILE = "system-prompt.md";

export async function render(ctx: RenderContext): Promise<RenderReport> {
	const { agentDir, assetsRoot, choices, composed, plan, proxyUrl } = ctx;
	const { loaded } = loadSet(composed, choices);
	const tree = workTree(assetsRoot);
	const r = newRendered();
	const byKind = (kind: string): ComposedAsset[] => loaded.filter((asset) => asset.kind === kind);
	const dropped: RenderReport["dropped"] = [];
	// One count of the delivery, shared with the boot screen (W5-D12).
	const sets = deliveredSets(loaded);
	await mkdir(join(agentDir, "sessions"), { recursive: true, mode: 0o700 });
	// Named to Pi as its one prompt-template directory (launch); it must exist
	// even when no prompt asset is delivered, or Pi reports a conflict.
	await mkdir(join(agentDir, "prompts"), { recursive: true, mode: 0o700 });

	// Skills are pointers into the work tree — Pi's native mechanism (D95).
	const skills = byKind("skill");
	r.concerns.skill = skills.map((skill) => skill.id);
	// The **origin**, never the credentialed URL. Node's fetch refuses a URL
	// carrying credentials, so no fetch-based client could call this address;
	// and writing the secret into a file the jail can read would hand it to the
	// agent for nothing. It rides in the header instead, which is 07 §7's own
	// rationale, and 03's `expected()` compares against this same origin.
	const endpoint = `${new URL(proxyUrl).origin}/connectors/model`;
	// D11 / W7-D2: a native session is the person's own Pi sign-in. Pi's own
	// provider is the default, the stored login is seeded into the agent dir by
	// `run` (`seedAgentCredentials`), and there is no connector — the plan has
	// no model connector either, which is what 03's `expected()` checks against.
	r.model = choices.native ? null : { endpoint, model: choices.model.model };
	await writeGenerated(
		r,
		agentDir,
		"settings.json",
		json({
			defaultProvider: choices.native ? choices.model.provider.id : "harness",
			defaultModel: choices.model.model,
			skills: skills.map((skill) => tree.dir("skill", skill.name)),
			defaultProjectTrust: "never",
			// 08 §11.1: the landing is ours (our header), so Pi's own start-up listing is off.
			quietStartup: true,
			enableInstallTelemetry: false,
			enableAnalytics: false,
		}),
	);
	// The "key" Pi sends is the proxy's session secret from the child
	// environment (08 §7), which the proxy verifies and replaces with the real
	// credential (05 §4.2, C23): Pi's SDK clients do not honour HTTP_PROXY for
	// a plaintext URL, so it has to ride in the API-key header. See A7. A native
	// session has no such provider: Pi reaches the model host through the tunnel
	// with its own sign-in.
	if (!choices.native) {
		await writeGenerated(
			r,
			agentDir,
			"models.json",
			json({
				providers: {
					harness: {
						baseUrl: endpoint,
						apiKey: "$HARNESS_SESSION_SECRET",
						api: choices.model.wireFormat,
						models: [{ id: choices.model.model, name: choices.model.model }],
					},
				},
			}),
		);
	}

	const systemPrompts = byKind("system_prompt");
	const memories = byKind("memory");
	const tools = byKind("tool");
	r.concerns.system_prompt = systemPrompts.map((asset) => asset.id);
	r.concerns.memory = memories.map((asset) => asset.id);
	r.concerns.tool_index = tools.map((asset) => asset.id);
	// The seam first and unconditionally, so an empty harness still says where
	// an asset the agent makes belongs (07 §6a).
	const agents = [
		seam(assetsRoot),
		reachLine(plan.reach),
		delivered(sets),
		// W5-D11 (D137): the `system_prompt` assets are no longer a section of
		// this file. They are `system-prompt.md`, which the extension appends to
		// Pi's own system prompt on `before_agent_start` — the runtime's seam,
		// not a heading in a memory file.
		sections(memories, tree.read),
		toolIndex(assetsRoot, tools),
		contextIndex(assetsRoot, byKind("context"), (name) => contextAbout(assetsRoot, name)),
		environmentIndex(assetsRoot, byKind("environment"), (name, file) => hasFile(join(assetsRoot, "environment", name, file)), (name) => firstLineOf(join(assetsRoot, "environment", name, "ENVIRONMENT.md"))),
	]
		.filter(Boolean)
		.join("\n\n");
	await writeGenerated(r, agentDir, "AGENTS.md", `${agents}\n`);
	// Written even when empty, so the extension's one check is "is it empty",
	// and so `rendered.json` records the hash of the file the model will be
	// given rather than of a file that sometimes exists.
	await writeGenerated(r, agentDir, SYSTEM_PROMPT_FILE, systemPrompts.length === 0 ? "" : `${sections(systemPrompts, tree.read)}\n`);

	for (const prompt of byKind("prompt")) {
		const files = tree.files("prompt", prompt.name);
		if (files.length !== 1) {
			dropped.push({ concern: "prompt", why: `${prompt.name} holds ${files.length} files; a prompt is one file.` });
			continue;
		}
		await symlinkAsset(r, agentDir, join("prompts", `${prompt.name}.md`), assetsRoot, "prompt", prompt.name, files[0]);
		r.concerns.prompt.push(prompt.id);
	}

	r.denies = denyPatterns(plan);
	const harness = choices.harness;
	// A capability boundary takes a built-in away; `intercepted` asks instead
	// of refusing (prd-v2 §7). Neither is enforcement — the read geometry is
	// (06) — so this only keeps Pi's UI agreeing with the boundary.
	const capability = (holds: string) =>
		new Set(
			composed.policy.boundaries
				.filter((b) => b.kind === "capability" && b.holds === holds && !b.value.startsWith("require:"))
				.flatMap((b) => piNames(b.value)),
		);
	const refused = capability("enforced");
	await writeGenerated(
		r,
		agentDir,
		"policy.json",
		json({
			session_id: ctx.sessionId,
			allowed: [...new Set(Object.values(PI_TOOLS).flat()), ...tools.map((tool) => tool.name)].filter(
				(tool) => !refused.has(tool),
			),
			confirm: [...capability("intercepted")],
			denies: r.denies,
			// W6-D153: the command boundaries this session carries, each with the
			// compiled rule `@harness/compose` built from its pattern. The
			// extension is in the vendored Pi tree and cannot import that
			// package, so it is handed the rule rather than a second copy of it:
			// `new RegExp(match).test(command.trim())` and nothing more. Unlike
			// `denies` above this is not advisory — the extension refuses the
			// call, which is what `intercepted` means (06 §13).
			commands: plan.commands.map((one) => ({
				id: one.id,
				pattern: one.pattern,
				reason: one.reason,
				match: commandRuleSource(one.pattern),
			})),
			assetsRoot,
			// W5-D11: where the brief is. The extension already reads this file
			// from the agent dir, so the path rides with the rest of what it
			// needs to *say* and nothing has to be discovered.
			system_prompt_file: join(agentDir, SYSTEM_PROMPT_FILE),
			// 08 §11.1: the landing Pi draws as its header, re-rendered at every
			// width. The inputs travel as data and the drawing function as a path
			// into this CLI's own `dist/`, which the extension imports at start —
			// one renderer for the boot screen, the exit review and Pi's header.
			landing: {
				module: fileURLToPath(new URL("../../landing.js", import.meta.url)),
				mode: colorMode(),
				frame: {
					icon: harness?.icon ?? null,
					name: harness?.name ?? "Pi",
					description: harness?.description ?? "",
					delivered: deliveredCounts(sets),
					model: modelBrief(choices),
					reach: reachBrief(plan.reach),
					workspace: ctx.workspace,
				},
			},
		}),
	);

	await writeGenerated(r, agentDir, "rendered.json", json(r));
	// Everything §6 does not call `none`, which today is every concern but the
	// native login a session in org mode does not use.
	const honoured = CONCERNS.filter((concern) => concern !== "model_native");
	return { honoured, dropped };
}
