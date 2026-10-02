import { differs, g, worktreeTree } from "../git.js";
import { readVersions } from "../hydrate.js";
import { refuse, say } from "../output.js";

const REMOTE = "refs/harness/remote";

/**
 * §11.5. `diff <key>` is yours against what was delivered; `--team` is yours
 * against the team's copy — the `shadows.tree` recorded for the key (01 §7.5),
 * or the delivered tree itself when the key is not an override.
 */
export async function diff(key: string | undefined, team: boolean, git: boolean): Promise<number> {
	const versions = await readVersions(REMOTE);
	const work = await worktreeTree();

	if (key === undefined) {
		for (const one of Object.keys(versions).sort()) {
			if (await differs(REMOTE, work, one)) say(`\`${one}\` · ${await lines(REMOTE, work, one)}`);
		}
		return 0;
	}
	const version = versions[key];
	if (version === undefined) {
		refuse("cli.key_unknown", `Nothing called \`${key}\` has been delivered to you.`, "`harness status` lists what you have.");
	}
	// `--team` compares against the team's copy: the `shadows.tree` recorded for
	// the key (01 §7.5), or the delivered tree itself when the key is not an
	// override. A `shadows.tree` is the asset directory alone and carries no
	// `<kind>/<name>` prefix, so that one comparison narrows both sides to the
	// asset and drops the path filter; every other is whole tree to whole tree.
	const shadow = team ? version.shadows?.tree : undefined;
	const [a, b, path] = shadow === undefined ? [REMOTE, work, key] : [shadow, `${work}:${key}`, undefined];
	if (git) {
		say(await g("diff", a, b, ...(path === undefined ? [] : ["--", path])).catch(() => ""));
		return 0;
	}
	say(`\`${key}\` · ${await lines(a, b, path)}`);
	return 0;
}

/** The plain sentence §11.5 asks for when there is no commit message to quote. */
async function lines(a: string, b: string, path?: string): Promise<string> {
	const out = await g("diff", "--numstat", a, b, ...(path === undefined ? [] : ["--", path])).catch(() => "");
	let added = 0;
	let removed = 0;
	for (const line of out.split("\n")) {
		const [plus, minus] = line.split("\t");
		if (plus !== undefined && plus !== "-") added += Number(plus) || 0;
		if (minus !== undefined && minus !== "-") removed += Number(minus) || 0;
	}
	return `${added} lines added, ${removed} removed`;
}
