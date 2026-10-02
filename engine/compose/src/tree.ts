import type { ComposedAsset, Reader } from "./contracts.js";
import { cmp } from "./sidecar.js";

/** One row of `versions.json`, 01 §7.5. Node paths, not commits, name the source. */
interface Version {
	id: string;
	kind: string;
	from: string;
	commit: string;
	tree: string;
	shadows?: { from: string; tree: string };
	/** W5-D10: on the organization's `required` list, so every session loads it
	    and no harness may drop it. (Was `alwaysLoaded`.) */
	required: boolean;
}

/**
 * git orders a tree entry as if a directory's name ended in "/", so `a-b`
 * sorts before `a/` but after `a-b/`. Both `Reader`s are handed entries in
 * this order, which is why the same input always yields the same tree id.
 */
const entryKey = (entry: { name: string; mode: string }) => (entry.mode === "040000" ? `${entry.name}/` : entry.name);

/**
 * 01 §6 steps 13 and 14. Blob oids are reused from the branches untouched, so
 * the composed tree shares every object with them and is cheap to check out;
 * only `versions.json` is a new object.
 */
export async function buildTree(
	assets: ComposedAsset[],
	required: string[],
	reader: Reader,
): Promise<{ tree: string; versions: Record<string, Version> }> {
	const versions: Record<string, Version> = {};
	const byKind = new Map<string, Array<{ name: string; mode: string; oid: string }>>();
	for (const asset of assets) {
		versions[`${asset.kind}/${asset.name}`] = {
			id: asset.id,
			kind: asset.kind,
			from: asset.from.path,
			commit: asset.from.commit,
			tree: asset.tree,
			...(asset.shadows ? { shadows: { from: asset.shadows.from.path, tree: asset.shadows.tree } } : {}),
			required: required.includes(asset.id),
		};
		byKind.set(asset.kind, [...(byKind.get(asset.kind) ?? []), { name: asset.name, mode: "040000", oid: asset.tree }]);
	}
	// 13. Keys sorted, so the blob is a function of the delivery and nothing else.
	const sorted: Record<string, Version> = {};
	for (const key of Object.keys(versions).sort(cmp)) sorted[key] = versions[key];
	const versionsOid = await reader.write(new TextEncoder().encode(`${JSON.stringify(sorted, null, 2)}\n`));

	// 14. The work tree root is the branch's assets/ directory, so there is no
	// assets/ prefix here (01 §4.3).
	const root = [{ name: "versions.json", mode: "100644", oid: versionsOid }];
	for (const [kind, entries] of [...byKind].sort((a, b) => cmp(a[0], b[0])))
		root.push({
			name: kind,
			mode: "040000",
			oid: await reader.mktree([...entries].sort((a, b) => cmp(entryKey(a), entryKey(b)))),
		});
	return { tree: await reader.mktree(root.sort((a, b) => cmp(entryKey(a), entryKey(b)))), versions: sorted };
}
