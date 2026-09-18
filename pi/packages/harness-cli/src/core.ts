import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import { type Icon, renderIcon } from "./pixels.js";
import { colorMode } from "./style.js";

export interface Credentials {
	api_url: string;
	token: string;
}

export interface AssetFile {
	path: string;
	content_b64: string;
}

export interface Shadowed {
	asset_id: string;
	org_unit_path: string;
	version_id: string;
	seq: number;
}

export interface AssetRef {
	kind: string;
	name: string;
}

export interface HarnessRef {
	id: string;
	name: string;
	description: string;
	icon: Icon;
	org_unit_path: string;
	/** What it contains, by name. A harness holds only what was put in it. */
	assets: AssetRef[];
}

export interface ManifestAsset {
	kind: string;
	name: string;
	asset_id?: string;
	/** The unit that owns it. Shorter path = broader scope. */
	org_unit_path?: string;
	version_id?: string;
	version_seq?: number;
	shadows?: Shadowed | null;
	files: AssetFile[];
}

export interface Manifest {
	manifest_version?: number;
	issued_at?: string;
	ttl_seconds?: number;
	user: { auth_user_id: string; email?: string; org_unit_path: string; org_unit_id?: string };
	/** The harness this manifest was resolved for, if one was selected. */
	harness?: HarnessRef | null;
	/** Every harness the user could switch to, so `run` can say so. */
	harnesses?: Array<{ id: string; name: string; org_unit_path: string }>;
	/** One array; `kind` is data. A new kind needs no change here. */
	assets: ManifestAsset[];
	boundary: Record<string, unknown> & { deploy_tools?: string[]; allowed_tools?: string[] };
	model: null | {
		provider: string;
		model_id: string;
		base_url: string;
		key_ref: string;
		env_var: string;
	};
}

export interface SessionPaths {
	id: string;
	root: string;
	agent: string;
}

export function harnessHome(): string {
	return process.env.HARNESS_HOME ?? join(homedir(), ".harness");
}

/**
 * The credential lives outside HARNESS_HOME: HARNESS_HOME/assets is writable
 * from inside the jail, and the whole point of the deny-read set is that the
 * agent cannot reach this file.
 */
export function credentialsPath(): string {
	return process.env.HARNESS_CREDENTIALS ?? join(homedir(), ".config", "harness", "credentials.json");
}

export function assetsRoot(): string {
	return join(harnessHome(), "assets");
}

export function assetsGitDir(): string {
	return join(harnessHome(), "assets.git");
}

export function sessionDir(id: string): string {
	return join(harnessHome(), "sessions", id);
}

export async function writeCredentials(credentials: Credentials): Promise<void> {
	const path = credentialsPath();
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
	await chmod(path, 0o600);
}

export async function readCredentials(): Promise<Credentials> {
	const path = credentialsPath();
	const legacy = join(harnessHome(), "credentials.json");
	try {
		return JSON.parse(await readFile(path, "utf8")) as Credentials;
	} catch {
		// One-time move from the pre-assets layout, where the credential shared
		// a directory with what is now the agent-writable work tree.
		try {
			const contents = await readFile(legacy, "utf8");
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			await rename(legacy, path);
			await chmod(path, 0o600);
			return JSON.parse(contents) as Credentials;
		} catch {
			throw new Error("You are not logged in. Run `harness login` first.");
		}
	}
}

export function safeRelative(path: string): string {
	const clean = normalize(path);
	if (!path || clean === ".." || clean.startsWith(`..${sep}`) || resolve("/", clean) === clean) {
		throw new Error(`The manifest contains an unsafe path: ${path}`);
	}
	return clean;
}

export function safeName(name: string): string {
	const clean = basename(name);
	if (!name || clean !== name || name === "." || name === "..") throw new Error(`Unsafe asset name: ${name}`);
	return clean;
}

async function writeAssetFiles(root: string, asset: ManifestAsset): Promise<void> {
	for (const file of asset.files) {
		const target = join(root, safeRelative(file.path));
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, Buffer.from(file.content_b64, "base64"), { mode: 0o600 });
	}
}

export async function materializeManifest(manifest: Manifest, id: string = randomUUID()): Promise<SessionPaths> {
	if (!manifest.model) throw new Error("No model is configured for your workspace.");
	const root = sessionDir(id);
	const agent = join(root, "agent");
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
	// The whole resolved set was hydrated; a session lays out what the
	// selected harness contains. One filter, and every kind below inherits it.
	const byKind = (kind: string) =>
		(manifest.assets ?? []).filter((asset) => asset.kind === kind && inHarness(asset, manifest.harness));
	for (const skill of byKind("skill")) await writeAssetFiles(join(agent, "skills", safeName(skill.name)), skill);

	const contents = (asset: ManifestAsset) =>
		asset.files.map((file) => Buffer.from(file.content_b64, "base64").toString("utf8")).join("\n\n");

	// Broadest scope first, so a user's own system prompt extends the team's
	// rather than preceding it. A shorter owning path means a wider unit.
	const scope = (asset: ManifestAsset) => (asset.org_unit_path ?? "").length;
	const render = (assets: ManifestAsset[]) =>
		[...assets]
			.sort((a, b) => scope(a) - scope(b) || a.name.localeCompare(b.name))
			.map((asset) => `## ${asset.name}\n\n${contents(asset)}`);
	// System prompts are the preamble; memories are standing context after it.
	// Both end up in the system prompt for every message of the session.
	const instructions = [...render(byKind("system_prompt")), ...render(byKind("memory"))].join("\n\n");
	await writeFile(join(agent, "AGENTS.md"), `${instructions}\n`);

	// A saved prompt is not an instruction: nothing reaches the model until
	// someone picks it from `/`. One file per name, because the agent takes the
	// command name from the filename.
	for (const saved of byKind("prompt")) {
		await writeFile(join(agent, "prompts", `${safeName(saved.name)}.md`), contents(saved), { mode: 0o600 });
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
	return { id, root, agent };
}

/**
 * Whether a harness contains an asset.
 *
 * Matched on kind and name, never on the asset's id: the harness says what
 * is in it, and resolution has already decided whose copy of each name this
 * user gets. So pushing your own version of something keeps it in the
 * harnesses that named it.
 *
 * No harness is not an empty harness. With nothing selected everything the
 * user resolves is laid out, which is how sessions behaved before harnesses
 * existed and what a manifest from an older server still means.
 */
export function inHarness(asset: ManifestAsset, harness: HarnessRef | null | undefined): boolean {
	if (!harness) return true;
	return (harness.assets ?? []).some((item) => item.kind === asset.kind && item.name === asset.name);
}

export function frontmatterName(content: string, fallback: string): string {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
	if (!match) return fallback;
	const name = match[1].match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
	return name || fallback;
}
