import { readdir, stat } from "node:fs/promises";
import { differs, ensureRepo, g, worktreeTree } from "../git.js";
import { readVersions } from "../hydrate.js";
import { say, table } from "../output.js";
import { assetsRoot } from "../selection.js";

const REMOTE = "refs/harness/remote";

export interface StatusRow {
	key: string;
	state: string;
	shadows: string | null;
}

/**
 * §11.4. No network: the answer is the work tree, `refs/harness/remote` and the
 * `versions.json` recorded with it. Exit 0 always.
 */
export async function status(json: boolean): Promise<number> {
	await ensureRepo();
	const remote = await g("rev-parse", "--verify", "--quiet", `${REMOTE}^{commit}`).catch(() => undefined);
	const versions = await readVersions(remote);
	const work = await worktreeTree();
	const rows: StatusRow[] = [];

	for (const key of Object.keys(versions).sort()) {
		const version = versions[key];
		// S10 / 01 §8: a key no harness of theirs names is listed, never hidden,
		// but it is not on disk — so it is not "modified" either.
		const here = await stat(`${assetsRoot()}/${key}`).then(() => true, () => false);
		// `conflict` is dirty **and** the delivered tree moved since; with one
		// delivery recorded there is nothing to have moved, so it cannot arise here.
		const state = !here ? "not checked out \u00b7 in no harness of yours" : (await differs(work, remote, key)) ? "modified" : "clean";
		rows.push({ key, state, shadows: version.shadows?.from ?? null });
	}

	// Keys in the work tree that `versions.json` never named.
	const known = new Set(Object.keys(versions));
	const mine: string[] = [];
	for (const kind of await readdir(assetsRoot(), { withFileTypes: true }).catch(() => [])) {
		if (!kind.isDirectory()) continue;
		for (const name of await readdir(`${assetsRoot()}/${kind.name}`, { withFileTypes: true }).catch(() => [])) {
			const key = `${kind.name}/${name.name}`;
			if (name.isDirectory() && !known.has(key)) mine.push(key);
		}
	}

	if (json) {
		say(JSON.stringify([...rows, ...mine.map((key) => ({ key, state: "yours only", shadows: null }))], null, 2));
		return 0;
	}
	if (rows.length === 0 && mine.length === 0) {
		say("Nothing has been delivered to you yet. `harness pull` fetches it.");
		return 0;
	}
	for (const line of table(rows.map((one) => [one.key, one.state, one.shadows === null ? "" : `override (team at ${one.shadows})`]))) say(line);
	for (const key of mine.sort()) {
		say(`\`${key}\` is yours only — \`harness push\` to keep it, \`harness adopt\` if you made it by hand.`);
	}
	return 0;
}
