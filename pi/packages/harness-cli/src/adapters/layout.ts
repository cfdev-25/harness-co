import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inHarness, type Manifest, type ManifestAsset, safeRelative } from "../core.js";

/** Write one asset's files under `root`, exactly as the manifest packed them. */
export async function writeAssetFiles(root: string, asset: ManifestAsset): Promise<void> {
	for (const file of asset.files) {
		const target = join(root, safeRelative(file.path));
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, Buffer.from(file.content_b64, "base64"), { mode: 0o600 });
	}
}

/**
 * The whole resolved set was hydrated; a session lays out what the selected
 * harness contains. One filter, shared by every adapter and every kind each
 * one renders, so "what belongs in this session" cannot drift between them.
 */
export function assetsByKind(manifest: Manifest): (kind: string) => ManifestAsset[] {
	return (kind: string) =>
		(manifest.assets ?? []).filter((asset) => asset.kind === kind && inHarness(asset, manifest.harness));
}

export function assetContents(asset: ManifestAsset): string {
	return asset.files.map((file) => Buffer.from(file.content_b64, "base64").toString("utf8")).join("\n\n");
}

// Broadest scope first, so a user's own system prompt extends the team's
// rather than preceding it. A shorter owning path means a wider unit.
function scope(asset: ManifestAsset): number {
	return (asset.org_unit_path ?? "").length;
}

/** Sections for an instructions file, broadest scope first then name — the
    same ordering rule for every adapter that concatenates assets into one
    file, so the same manifest never reads in two different orders. */
export function layoutSections(assets: ManifestAsset[]): string[] {
	return [...assets]
		.sort((a, b) => scope(a) - scope(b) || a.name.localeCompare(b.name))
		.map((asset) => `## ${asset.name}\n\n${assetContents(asset)}`);
}

/**
 * What `boundary.allowed_tools` grants, in the capability vocabulary
 * (agents.md §7.1.2: `filesystem.read`, `process.exec`, `tool.<name>`, ...).
 * The server now stores capabilities, never a tool name, so this is a
 * straight read — no per-agent translation happens here. `null` is
 * "unconstrained" (same rule as `merge_boundaries`' allowlists): nobody in
 * the chain restricted tools, so every capability is granted, which is what
 * every session behaved like before this boundary field existed. `[]` is a
 * policy that permits nothing, not the same thing as absent.
 */
export function grantedCapabilities(manifest: Manifest): Set<string> | null {
	const allowed = manifest.boundary.allowed_tools;
	return allowed == null ? null : new Set(allowed);
}

/** Whether a team tool asset named `name` may run in this session: it must be
    in the harness (or no harness is selected) *and*, if the boundary
    constrains tools at all, carry its own `tool.<name>` capability. Shared
    because both an adapter's advisory rendering and the real deny-read
    enforcement (src/enforcers/filesystem.ts) must agree on the same answer —
    a divergence between what a policy.json says and what the sandbox
    enforces is exactly the gap agents.md §7.1 closes. */
export function toolIsGranted(manifest: Manifest, name: string): boolean {
	const granted = grantedCapabilities(manifest);
	return granted === null || granted.has(`tool.${name}`);
}

/**
 * Every `tool/<name>` directory already hydrated onto disk that this session
 * must not be able to read — because the selected harness does not contain
 * it, or `tool.<name>` is not in `allowed_tools` (agents.md §7.1.1).
 *
 * Fail closed: a directory on disk with no matching in-harness tool asset at
 * all (stale from a harness switch, or a name the manifest never mentions) is
 * denied too, since there is nothing here to classify it by.
 */
export async function deniedToolDirs(manifest: Manifest, assetsRoot: string): Promise<string[]> {
	const toolRoot = join(assetsRoot, "tool");
	let entries: string[];
	try {
		entries = await readdir(toolRoot);
	} catch {
		return []; // Nothing hydrated under tool/ yet, so nothing to deny.
	}
	const inScope = new Set(assetsByKind(manifest)("tool").map((tool) => tool.name));
	return entries
		.filter((name) => !inScope.has(name) || !toolIsGranted(manifest, name))
		.map((name) => join(toolRoot, name));
}
