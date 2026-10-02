import { rm } from "node:fs/promises";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import type { HarnessDef } from "@harness/compose/contracts";
import { ensureRepo, g } from "../git.js";
import { readVersions } from "../hydrate.js";
import { refuse, say } from "../output.js";
import { assetsRoot, readSelection } from "../selection.js";

const REMOTE = "refs/harness/remote";

/**
 * D106: every key in the selected harness, else every delivered key. The
 * harness names ids and `versions.json` maps each key to the id it carries, so
 * the harness definition comes from the composition — the only place a harness
 * on the chain exists — and never from a file on disk.
 */
async function allKeys(harnesses: HarnessDef[]): Promise<string[]> {
	const versions = await readVersions(REMOTE);
	const selection = await readSelection();
	const selected = harnesses.find((one) => one.id === selection?.harness_id);
	if (selected === undefined) return Object.keys(versions).sort();
	const ids = new Set(selected.assets);
	return Object.keys(versions)
		.filter((key) => ids.has(versions[key].id))
		.sort();
}

/** §11.10. Discards the person's changes and takes the delivered copy. */
export async function reset(key: string | undefined, all: boolean, yes: boolean, harnesses: HarnessDef[] = []): Promise<number> {
	await ensureRepo();
	const versions = await readVersions(REMOTE);
	if (Object.keys(versions).length === 0) {
		refuse("cli.key_unknown", "Nothing has been delivered to you yet, so there is nothing to reset to.", "`harness pull` first.");
	}
	const keys = all ? await allKeys(harnesses) : key === undefined ? [] : [key];
	if (keys.length === 0) refuse("cli.key_unknown", "Say which key to reset, or pass `--all`.", "`harness status` lists what you have.");
	for (const one of keys) {
		if (versions[one] === undefined) {
			refuse("cli.key_unknown", `Nothing called \`${one}\` has been delivered to you.`, "`harness status` lists what you have.");
		}
	}
	if (!yes) {
		if (stdin.isTTY !== true) {
			refuse("cli.reset_needs_yes", `This discards your changes to \`${keys.join("`, `")}\`.`, "Re-run with `--yes`.");
		}
		for (const one of keys) say(`  ${one}`);
		const rl = createInterface({ input: stdin, output: stdout });
		const answer = await rl.question(`Discard your changes to ${keys.length === 1 ? "this" : "these"}? [y/N] `).finally(() => rl.close());
		if (answer.trim().toLowerCase() !== "y") return 1;
	}
	for (const one of keys) {
		await rm(join(assetsRoot(), one), { recursive: true, force: true });
		await g("checkout", REMOTE, "--", one);
		say(`Reset \`${one}\` to the team's version.`);
	}
	return 0;
}
