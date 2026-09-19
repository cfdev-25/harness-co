import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeName } from "../core.js";
import { renderIcon } from "../pixels.js";
import { colorMode } from "../style.js";
import { assetContents, assetsByKind, layoutSections, writeAssetFiles } from "./layout.js";
import type { Adapter, RenderContext } from "./types.js";

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

	const builtins = ["read", "bash", "edit", "write", "grep", "find", "ls"];
	const allowedTools = Array.from(
		new Set([...builtins, ...(manifest.boundary.allowed_tools ?? []), ...byKind("tool").map((tool) => tool.name)]),
	);
	await writeFile(
		join(root, "policy.json"),
		`${JSON.stringify(
			{
				...manifest.boundary,
				allowed_tools: allowedTools,
				deploy_tools: manifest.boundary.deploy_tools ?? [],
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
