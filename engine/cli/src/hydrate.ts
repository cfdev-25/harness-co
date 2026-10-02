import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Composed } from "@harness/compose/contracts";
import { differs, ensureRepo, g, withIndex, worktreeTree } from "./git.js";
import { assetsRoot } from "./selection.js";

const REMOTE = "refs/harness/remote";
const VERSIONS = "versions.json";

/** One row of `versions.json` (01 §7.5), written into the composed tree by compose. */
export interface Version {
	id: string;
	kind: string;
	from: string;
	commit: string;
	tree: string;
	shadows?: { from: string; tree: string };
	/** W5-D10: on the organization's `required` list. */
	required: boolean;
}

export type Versions = Record<string, Version>;

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}

async function revision(ref: string): Promise<string | undefined> {
	return g("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).catch(() => undefined);
}

/** `versions.json` at a tree-ish. Absent or unreadable composes to nothing (C32). */
export async function readVersions(treeish: string | undefined): Promise<Versions> {
	if (treeish === undefined) return {};
	return g("show", `${treeish}:${VERSIONS}`)
		.then((text) => JSON.parse(text) as Versions)
		.catch(() => ({}));
}

/**
 * 01 §8. Per person, not per session: `switch` changes nothing on disk, so
 * C14 holds literally. No harness on the chain means no filter at all
 * (harnesses.md §0 — no harness is not an empty harness).
 */
export function subscription(composed: Composed): (version: Version) => boolean {
	if (composed.harnesses.length === 0) return () => true;
	const named = new Set([...composed.harnesses.flatMap((harness) => harness.assets), ...composed.policy.required]);
	return (version) => named.has(version.id);
}

/** Replaces one asset directory with the delivered copy. */
async function take(incoming: string, key: string): Promise<void> {
	const scratch = await mkdtemp(join(tmpdir(), "harness-co-"));
	try {
		await rm(join(assetsRoot(), key), { recursive: true, force: true });
		await withIndex(join(scratch, "index"), () => g("checkout", incoming, "--", key));
		// A tool is "a directory containing an executable named run", and a tree
		// entry's mode is not tracked here, so the convention is restored.
		await chmod(join(assetsRoot(), key, "run"), 0o755).catch(() => undefined);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/**
 * Boot row 3. `asset-sync.md` §4 unchanged, with 01 §7.4's one substitution —
 * `incoming` is the **composed tree**, whose objects compose already wrote into
 * `assets.git` — and row 0 for the subscription (01 §8). Never writes over a
 * path the person changed.
 */
export async function hydrate(composed: Composed, notify: (message: string) => void): Promise<void> {
	await ensureRepo();
	const incoming = await g("commit-tree", composed.tree, "-m", "hydrate");
	const work = await worktreeTree();
	const remote = await revision(REMOTE);

	const delivered = await readVersions(incoming);
	const previous = await readVersions(remote);
	const subscribed = subscription(composed);
	const keys = new Set([...Object.keys(delivered), ...Object.keys(previous)]);

	for (const key of [...keys].sort()) {
		const version = delivered[key];

		// Row 0: sparse materialisation. An unsubscribed key is listed in
		// `versions.json` either way — a session records everything it was
		// offered (C17) — but it is not laid out on disk.
		if (version !== undefined && !subscribed(version)) {
			if (await exists(join(assetsRoot(), key))) {
				if (remote !== undefined && (await differs(work, remote, key))) {
					notify(`\`${key}\` is not in any of your harnesses; kept because you changed it.`);
				} else {
					await rm(join(assetsRoot(), key), { recursive: true, force: true });
					notify(`\`${key}\` is not in any of your harnesses; removed. \`harness push ${key} --harness <name>\` adds it to one.`);
				}
			}
			continue;
		}

		// Row 1: the person already has exactly what was delivered. Converges an
		// adopted directory, or a push that has just been accepted.
		if (!(await differs(work, incoming, key))) continue;

		if (remote === undefined) {
			// Rows 2 / 2b: first hydration, so there is no base to compare to.
			if (await exists(join(assetsRoot(), key))) {
				notify(`${key} exists locally but was never delivered. \`harness push\` to keep yours, \`harness reset ${key}\` to take the team's.`);
			} else {
				await take(incoming, key);
			}
			continue;
		}

		// A key row 0 laid out nothing for (or removed) is absent, not edited: when
		// a harness names it again it is taken, not treated as a local deletion.
		const localChanged = (await exists(join(assetsRoot(), key))) && (await differs(work, remote, key));
		const teamChanged = await differs(remote, incoming, key);

		if (!localChanged) {
			// Row 3: the only row that writes, and only where the work tree still
			// matches the previous delivery.
			if (version !== undefined) {
				await take(incoming, key);
				notify(`Updated ${key}.`);
			} else {
				await rm(join(assetsRoot(), key), { recursive: true, force: true });
				notify(`${key} is no longer provided by your team.`);
			}
			continue;
		}

		if (!teamChanged) continue; // Row 4: local edits, team unchanged.

		// Row 5: both moved. Surfaced, never resolved for them.
		notify(
			version !== undefined
				? `${key}: you changed it and the team changed it. \`harness push\` keeps yours, \`harness reset ${key}\` takes theirs.`
				: `${key} is no longer provided by your team; your local copy is kept.`,
		);
	}

	await g("update-ref", REMOTE, incoming);

	// asset-sync §5: a personal override shadows the team's copy indefinitely,
	// so say so when the copy behind the override moves (01 §7.5).
	for (const [key, version] of Object.entries(delivered)) {
		const before = previous[key]?.shadows;
		if (version.shadows !== undefined && before !== undefined && version.shadows.tree !== before.tree) {
			notify(`The team's ${key} moved on but your personal override is in effect. \`harness reset ${key}\` to take theirs.`);
		}
	}
}
