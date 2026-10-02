import type { Choices, ComposedAsset, Composed } from "@harness/compose/contracts";

/**
 * 03 §5.3 — the one function that says what a session loads. The adapters
 * (07 §9) import this rather than owning a copy, which is why it is pure and
 * takes only the two fields of `Choices` it reads.
 */
export function loadSet(composed: Composed, choices: Pick<Choices, "harness" | "view">): { loaded: ComposedAsset[]; missing: string[] } {
	const byId = new Map(composed.assets.map((asset) => [asset.id, asset]));
	// Step 2: no harness is not an empty harness (harnesses.md §0). A harness
	// naming a required id twice is not an error, so the set dedupes. W5-D10:
	// `required` is what every session loads whatever the harness says;
	// `recommended` is copied into a harness when it is created and is an
	// ordinary entry of `harness.assets` from then on, never forced here.
	const wanted =
		choices.harness === null
			? composed.assets.map((asset) => asset.id)
			: [...new Set([...choices.harness.assets, ...composed.policy.required])];
	let loaded = wanted.map((id) => byId.get(id)).filter((asset): asset is ComposedAsset => asset !== undefined);
	// Step 4: under `--team` the session sees the team's copies; the work tree
	// is untouched (08 §6, C14). A copy only the person holds is dropped.
	if (choices.view === "team") {
		loaded = loaded.flatMap((asset) => {
			if (asset.from.kind !== "user") return [asset];
			return asset.shadows ? [{ ...asset, from: asset.shadows.from, tree: asset.shadows.tree, shadows: undefined }] : [];
		});
	}
	// Step 5: an assigned id that resolves to nothing is reported, never dropped (P8).
	return { loaded, missing: wanted.filter((id) => !byId.has(id)) };
}
