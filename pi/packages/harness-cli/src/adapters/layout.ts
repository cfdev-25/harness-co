import { mkdir, writeFile } from "node:fs/promises";
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
