import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";
import type { Icon } from "./pixels.js";

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
