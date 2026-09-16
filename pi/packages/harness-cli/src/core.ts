import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";

export interface Credentials {
	api_url: string;
	token: string;
}

export interface AssetFile {
	path: string;
	content_b64: string;
}

export interface ManifestAsset {
	name: string;
	asset_id?: string;
	version_seq?: number;
	files: AssetFile[];
}

export interface Manifest {
	user: { auth_user_id: string; email?: string; org_unit_path: string; org_unit_id?: string };
	skills: ManifestAsset[];
	memories: ManifestAsset[];
	connections?: Array<{ key_ref?: string; ref?: string }>;
	tools?: Array<{ name: string }>;
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

export function harnessHome(home = process.env.HARNESS_HOME ?? join(homedir(), ".harness")): string {
	return home;
}

export function credentialsPath(home?: string): string {
	return join(harnessHome(home), "credentials.json");
}

export async function writeCredentials(credentials: Credentials, home?: string): Promise<void> {
	const path = credentialsPath(home);
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
	await chmod(path, 0o600);
}

export async function readCredentials(home?: string): Promise<Credentials> {
	try {
		return JSON.parse(await readFile(credentialsPath(home), "utf8")) as Credentials;
	} catch {
		throw new Error("You are not logged in. Run `harness login` first.");
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

export async function materializeManifest(
	manifest: Manifest,
	home?: string,
	id: string = randomUUID(),
): Promise<SessionPaths> {
	if (!manifest.model) throw new Error("No model is configured for your workspace.");
	const root = join(harnessHome(home), "sessions", id);
	const agent = join(root, "agent");
	await mkdir(join(agent, "skills"), { recursive: true, mode: 0o700 });
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
	for (const skill of manifest.skills) await writeAssetFiles(join(agent, "skills", safeName(skill.name)), skill);
	const memories = manifest.memories
		.map((memory) => {
			const text = memory.files.map((file) => Buffer.from(file.content_b64, "base64").toString("utf8")).join("\n\n");
			return `## ${memory.name}\n\n${text}`;
		})
		.join("\n\n");
	await writeFile(join(agent, "AGENTS.md"), `${memories}\n`);

	const builtins = ["read", "bash", "edit", "write", "grep", "find", "ls"];
	const allowedTools = Array.from(
		new Set([...builtins, ...(manifest.boundary.allowed_tools ?? []), ...(manifest.tools ?? []).map((t) => t.name)]),
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
	return { id, root, agent };
}

export function frontmatterName(content: string, fallback: string): string {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
	if (!match) return fallback;
	const name = match[1].match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
	return name || fallback;
}
