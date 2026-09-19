import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeName } from "../core.js";
import { renderIcon } from "../pixels.js";
import { colorMode } from "../style.js";
import {
	assetContents,
	assetsByKind,
	grantedCapabilities,
	layoutSections,
	toolIsGranted,
	writeAssetFiles,
} from "./layout.js";
import type { Adapter, RenderContext } from "./types.js";

/**
 * Renders the capability vocabulary (agents.md §7.1.2) into Pi's own tool
 * names for `policy.json` — the file Pi's harness extension actually reads
 * (pi/packages/harness/src/index.ts's `applyAllowlist`/`tool_call` handler
 * compares against `event.toolName`, which is a Pi name, never a
 * capability). This is `Adapter.toolNames`'s job, best-effort and advisory:
 * the boundary itself is enforced elsewhere (deny-read, §7.1.1), and Pi's own
 * allowlist is only a courtesy that keeps its UI agreeing with the boundary.
 * One capability can render to several Pi tool names, which is why this is a
 * map to arrays rather than the 1:1 `Record<string,string>` an earlier draft
 * of agents.md §4 assumed.
 */
const CAPABILITY_TO_PI_TOOLS: Record<string, string[]> = {
	"filesystem.read": ["read", "grep", "find", "ls"],
	"filesystem.write": ["edit", "write"],
	"process.exec": ["bash"],
	// No Pi built-in implies outbound network access today; kept here so the
	// map stays the rendering side of the whole fixed vocabulary, not just
	// the part Pi happens to have a button for yet.
	"network.fetch": [],
};

/** Pi's own tool names, unconstrained — i.e. every built-in a fresh Pi
    session ships with. This is the same seven names §7.1.2 calls out as
    Pi's private vocabulary; it survives only as the *default* rendering when
    nothing in the boundary restricts tools at all, matching how every
    session behaved before `allowed_tools` existed. */
const UNCONSTRAINED_PI_TOOLS = Object.values(CAPABILITY_TO_PI_TOOLS).flat();

/** Which Pi tool names `policy.json` should advertise as allowed, given what
    the boundary granted. `null` (nothing in the boundary restricts tools)
    renders to every built-in, byte-identical to the hardcoded list this
    replaces. */
function renderPiBuiltins(granted: Set<string> | null): string[] {
	if (granted === null) return UNCONSTRAINED_PI_TOOLS;
	return Object.entries(CAPABILITY_TO_PI_TOOLS).flatMap(([capability, names]) =>
		granted.has(capability) ? names : [],
	);
}

/** `deploy_tools` names capabilities that need a confirmation, not ones that
    are merely permitted, so it renders on its own rather than through
    `renderPiBuiltins` — a capability appearing here says nothing about
    whether `allowed_tools` also grants it. `tool.<name>` unwraps to the team
    tool's own name; `connector.<name>` has no Pi tool name to become, since
    Pi has no per-connector dispatch tool, so it renders to nothing. */
function renderPiNames(capability: string): string[] {
	if (capability.startsWith("tool.")) return [capability.slice("tool.".length)];
	if (capability.startsWith("connector.")) return [];
	return CAPABILITY_TO_PI_TOOLS[capability] ?? [];
}

async function render(ctx: RenderContext): Promise<void> {
	const { manifest, id, sessionDir: root, agentDir: agent } = ctx;
	if (!manifest.model) throw new Error("No model is configured for your workspace.");
	await mkdir(join(agent, "skills"), { recursive: true, mode: 0o700 });
	await mkdir(join(agent, "prompts"), { recursive: true, mode: 0o700 });
	await mkdir(join(agent, "sessions"), { recursive: true, mode: 0o700 });

	const providerId = manifest.model.provider;
	await writeFile(
		join(agent, "settings.json"),
		`${JSON.stringify(
			{
				defaultProvider: providerId,
				defaultModel: manifest.model.model_id,
				defaultProjectTrust: "never",
				enableInstallTelemetry: false,
				enableAnalytics: false,
			},
			null,
			2,
		)}\n`,
	);
	await writeFile(
		join(agent, "models.json"),
		`${JSON.stringify(
			{
				providers: {
					[providerId]: {
						baseUrl: manifest.model.base_url,
						apiKey: `$${manifest.model.env_var}`,
						api: "openai-completions",
						models: [{ id: manifest.model.model_id, name: manifest.model.model_id }],
					},
				},
			},
			null,
			2,
		)}\n`,
	);
	const byKind = assetsByKind(manifest);
	for (const skill of byKind("skill")) await writeAssetFiles(join(agent, "skills", safeName(skill.name)), skill);

	// System prompts are the preamble; memories are standing context after it.
	// Both end up in the system prompt for every message of the session.
	const instructions = [...layoutSections(byKind("system_prompt")), ...layoutSections(byKind("memory"))].join("\n\n");
	await writeFile(join(agent, "AGENTS.md"), `${instructions}\n`);

	// A saved prompt is not an instruction: nothing reaches the model until
	// someone picks it from `/`. One file per name, because the agent takes the
	// command name from the filename.
	for (const saved of byKind("prompt")) {
		await writeFile(join(agent, "prompts", `${safeName(saved.name)}.md`), assetContents(saved), { mode: 0o600 });
	}

	// `manifest.boundary.allowed_tools`/`deploy_tools` are capabilities now
	// (agents.md §7.1.2) — the server holds no agent's tool-name vocabulary.
	// This is the rendering layer `Adapter.toolNames` describes: it turns
	// those capabilities into Pi's own names for `policy.json`, which is all
	// Pi's harness extension actually reads. Best-effort and advisory; the
	// boundary itself does not depend on it (real enforcement is deny-read,
	// wired in index.ts's `run` via `deniedToolDirs`).
	const granted = grantedCapabilities(manifest);
	const allowedTools = Array.from(
		new Set([
			...renderPiBuiltins(granted),
			...byKind("tool")
				.filter((tool) => toolIsGranted(manifest, tool.name))
				.map((tool) => tool.name),
		]),
	);
	const deployTools = Array.from(new Set((manifest.boundary.deploy_tools ?? []).flatMap(renderPiNames)));
	await writeFile(
		join(root, "policy.json"),
		`${JSON.stringify(
			{
				...manifest.boundary,
				allowed_tools: allowedTools,
				deploy_tools: deployTools,
				session_id: id,
			},
			null,
			2,
		)}\n`,
	);
	await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	// The drawing is rendered here, not in the agent: the CLI and the agent
	// share a terminal, so the parent's capability detection is the right
	// one, and the extension stays a reader of small files.
	if (manifest.harness) {
		const { id: selected, name, description, org_unit_path, icon } = manifest.harness;
		const card = { id: selected, name, description, org_unit_path, lines: renderIcon(icon, colorMode()) };
		await writeFile(join(root, "harness.json"), `${JSON.stringify(card, null, 2)}\n`);
	}
}

function launch(ctx: RenderContext): { argv: string[]; env: Record<string, string> } {
	// Two levels up from src/adapters/: the package root, then its siblings.
	const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const piEntry = resolve(packageRoot, "../coding-agent/dist/bundle/cli.js");
	const extension = resolve(packageRoot, "../harness/dist/index.js");
	const theme = resolve(packageRoot, "../harness/themes/harness-dark.json");
	return {
		argv: [
			// Pi ships as a bundle, not an executable, so it names its own
			// interpreter; `run` spawns argv[0] verbatim.
			process.execPath,
			piEntry,
			"--offline",
			"--no-approve",
			"--no-extensions",
			"-e",
			extension,
			"--theme",
			theme,
			"--use-theme",
			"harness-dark",
			// Discovery off, so nothing from this machine is loaded, and
			// then the one directory we delivered named explicitly.
			"--no-prompt-templates",
			"--prompt-template",
			join(ctx.agentDir, "prompts"),
		],
		env: {
			PI_CODING_AGENT_DIR: ctx.agentDir,
			PI_CODING_AGENT_SESSION_DIR: join(ctx.agentDir, "sessions"),
			PI_TELEMETRY: "0",
		},
	};
}

export const pi: Adapter = { id: "pi", render, launch };
