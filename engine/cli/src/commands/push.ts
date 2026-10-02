import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Me } from "../boot.js";
import { origin } from "../boot.js";
import type { Credentials } from "../credentials.js";
import { g, pushOnePath, worktreeTree } from "../git.js";
import { readVersions } from "../hydrate.js";
import { refuse, say } from "../output.js";
import { assetsRoot } from "../selection.js";

/**
 * `key := relative(assetsRoot, path)`, inside the work tree (01 §7.3 step 1).
 * A bare `<kind>/<name>` is the form the command sheet prints, so it is taken
 * against the work tree; anything else is taken against the person's cwd.
 */
export function keyFor(path: string): string {
	const candidates = isAbsolute(path) ? [path] : [resolve(assetsRoot(), path), resolve(path)];
	for (const candidate of candidates) {
		const key = relative(assetsRoot(), candidate);
		if (key !== "" && !key.startsWith("..")) return key.split("/").slice(0, 2).join("/");
	}
	refuse("repo.not_in_work_tree", `\`${path}\` is not inside ${assetsRoot()}, so it is not yours to push.`, "`harness adopt <path>` moves it in first.");
}

/**
 * 01 §7.3, steps 1–9. One path, one commit on `main`, one refspec. `push` never
 * mints an id (D3, C15) and `refs/harness/remote` is untouched (S3).
 */
export async function pushKey(credentials: Credentials, me: Me, key: string, message: string, quiet = false): Promise<string> {
	const sidecar = await readFile(join(assetsRoot(), key, "asset.json"), "utf8").catch(() => undefined);
	if (sidecar === undefined) {
		refuse("repo.no_sidecar", `\`${key}\` has no \`asset.json\`, so it has no identity to push under.`, `harness adopt ${key}`);
	}
	const mine = (JSON.parse(sidecar) as { id?: string }).id;
	// Step 2, from the delivery's own record rather than a second composition:
	// `versions.json` carries the winning id at every path (01 §7.5).
	const delivered = (await readVersions("refs/harness/remote"))[key];
	if (delivered !== undefined && mine !== delivered.id) {
		refuse("repo.id_mismatch", `\`${key}\` carries a different id from the one delivered at that path.`, `harness adopt --new-id ${key}`);
	}
	const work = await worktreeTree();
	const sub = await g("rev-parse", `${work}:${key}`);
	const commit = await pushOnePath({ token: credentials.token, origin: origin(me), userId: me.user.id, message, source: { path: `assets/${key}`, kind: "tree", oid: sub } });
	if (!quiet) say(`Pushed \`${key}\` to your version.`);
	return commit;
}
