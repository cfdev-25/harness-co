import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ChainNode,
	Choices,
	Composed,
	ComposedAsset,
	HarnessProvider,
	RenderContext,
	SpawnPlan,
} from "@harness/compose/contracts";

const org: ChainNode = { kind: "org", path: "acme", ref: "refs/heads/org", commit: "c0" };
const team: ChainNode = { kind: "team", path: "acme.marketing", ref: "refs/heads/teams/marketing", commit: "c1" };

/** One asset per concern the two adapters render, so a golden covers every
    row of 07 §7 and §8 without a second fixture. */
const ASSETS: Array<{ kind: string; name: string; from: ChainNode; files: Record<string, string> }> = [
	{ kind: "skill", name: "quokka", from: org, files: { "SKILL.md": "# quokka\n\nDo the quokka thing.\n" } },
	{ kind: "prompt", name: "standup", from: team, files: { "standup.md": "Write today's standup.\n" } },
	{ kind: "system_prompt", name: "house-style", from: org, files: { "prompt.md": "Write plainly.\n" } },
	{ kind: "memory", name: "release-notes", from: team, files: { "memory.md": "We ship on Thursdays.\n" } },
	{ kind: "tool", name: "deploy", from: team, files: { run: "#!/bin/sh\necho deploy\n" } },
	{ kind: "context", name: "brand-assets", from: org, files: { "CONTEXT.md": "# Brand\nColours, logos and the deck template.\n", "palette.md": "primary: #c8875a\n" } },
	{ kind: "environment", name: "deck-tools", from: team, files: { "ENVIRONMENT.md": "# Deck tools\nWhat the deck tool needs.\n", "requirements.txt": "python-pptx==1.0.2\n" } },
];

export interface Fixture {
	root: string;
	assetsRoot: string;
	sessionDir: string;
	agentDir: string;
	workspace: string;
	ctx: RenderContext;
}

export const PROXY_URL = "http://:s3cr3t-session@127.0.0.1:45871";

export async function fixture(overrides: Partial<RenderContext> = {}): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), "harness-adapters-"));
	const assetsRoot = join(root, "assets");
	const sessionDir = join(root, "sessions", "session-1");
	const agentDir = join(sessionDir, "agent");
	const workspace = join(root, "workspace");
	const assets: ComposedAsset[] = [];
	for (const [index, asset] of ASSETS.entries()) {
		const dir = join(assetsRoot, asset.kind, asset.name);
		await mkdir(dir, { recursive: true });
		const id = `0000000${index}-0000-4000-8000-000000000000`;
		await writeFile(join(dir, "asset.json"), `${JSON.stringify({ id, kind: asset.kind }, null, 2)}\n`);
		for (const [name, content] of Object.entries(asset.files)) await writeFile(join(dir, name), content);
		assets.push({ id, kind: asset.kind, name: asset.name, from: asset.from, tree: `t${index}`, sidecar: { id, kind: asset.kind } });
	}
	await mkdir(agentDir, { recursive: true });
	await mkdir(workspace, { recursive: true });

	const composed: Composed = {
		chain: [org, team],
		assets,
		conflicts: [],
		policy: {
			boundaries: [
				{ id: "b1", scope: { teams: "all" }, kind: "capability", value: "process.exec", holds: "intercepted", reason: "Deploys are confirmed." },
			],
			grants: [],
			groups: {},
			modelProviders: {},
			harnessProviders: {},
			routing: { defaultFor: { teams: {}, harnesses: {}, providers: {} }, approvedFor: { teams: {}, harnesses: {}, providers: {} } },
			kinds: ["skill", "prompt", "system_prompt", "memory", "tool", "context", "environment"],
			required: [],
			recommended: [],
		},
		harnesses: [],
		tree: "composed-tree",
	};
	const provider: HarnessProvider = {
		id: "pi",
		approval: "approved",
		scope: { teams: "all" },
		pin: { repo: "pi", commit: "60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759" },
		speaks: ["openai-completions"],
	};
	const choices: Choices = {
		provider,
		located: { path: "/usr/local/bin/claude", version: "2.1.275" },
		harness: null,
		view: "mine",
		model: {
			provider: { id: "openrouter", endpoints: { "openai-completions": "https://openrouter.ai/api/v1" }, models: ["sonnet"] },
			model: "sonnet",
			wireFormat: "openai-completions",
			endpoint: "https://openrouter.ai/api/v1",
		},
		grants: [],
	};
	const plan: SpawnPlan = {
		hosts: ["openrouter.ai"],
		deny: [],
		reach: { mode: "off", hosts: [], setBy: "acme" },
		connectors: {},
		filesystem: {
			allowWrite: [workspace, agentDir],
			denyRead: [join(root, "denied-tool")],
			denyWrite: [join(workspace, ".claude"), join(workspace, ".pi")],
		},
		// W6-D153. Two on purpose: one Claude Code's own matcher holds, and one
		// only Pi's does (07 §8 rule 4), so the two goldens show the difference
		// rather than a comment claiming it.
		commands: [
			{ id: "acme/b-wipe", pattern: "rm -rf /*", reason: "A wipe of the system root is never a step in a task." },
			{ id: "acme/b-pipe", pattern: "curl * | sh", reason: "A download executed unread runs code nobody has seen." },
		],
		env: {},
		argv: [],
	};
	const ctx: RenderContext = {
		composed,
		choices,
		plan,
		sessionId: "session-1",
		sessionDir,
		agentDir,
		workspace,
		assetsRoot,
		proxyUrl: PROXY_URL,
		...overrides,
	};
	return { root, assetsRoot, sessionDir, agentDir, workspace, ctx };
}

/** Absolute paths differ on every machine, so a golden holds tokens. The
    hashes are checked against the files on disk separately (they cannot be
    byte-stable either, because they cover tokenised paths). */
export function tokenise(text: string, f: Fixture): string {
	return text
		.split(JSON.stringify(f.agentDir).slice(1, -1))
		.join("<agentDir>")
		.split(JSON.stringify(f.sessionDir).slice(1, -1))
		.join("<sessionDir>")
		.split(JSON.stringify(f.assetsRoot).slice(1, -1))
		.join("<assetsRoot>")
		.split(JSON.stringify(f.workspace).slice(1, -1))
		.join("<workspace>")
		.split(JSON.stringify(process.execPath).slice(1, -1))
		.join("<node>")
		.split(JSON.stringify(f.root).slice(1, -1))
		.join("<root>")
		// The landing renderer is this CLI's own `landing.js`, wherever this checkout is (08 §11.1).
		.replace(/"module": "[^"]*\/landing\.js"/g, '"module": "<cli>/landing.js"')
		.replace(/"[0-9a-f]{64}"/g, '"<sha256>"');
}

/**
 * What 03 does with a `Rehydrated`: compare it to `rendered.json`. Kept in
 * the fixture because preflight owns the real comparison; these tests only
 * need the half that proves the adapter reported the difference.
 */
export async function drift(agentDir: string, files: Record<string, string>): Promise<Array<{ file: string }>> {
	const { readFile } = await import("node:fs/promises");
	const recorded = (JSON.parse(await readFile(join(agentDir, "rendered.json"), "utf8")) as { files: Record<string, string> })
		.files;
	return Object.entries(recorded)
		.filter(([file, value]) => files[file] !== value)
		.map(([file]) => ({ file }));
}
