import { readFile } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { adoptDir } from "./commands/adopt.js";
import { differs, g, worktreeTree } from "./git.js";
import type { Composed, HarnessDef } from "@harness/compose/contracts";
import { type Me, origin } from "./boot.js";
import type { Credentials } from "./credentials.js";
import { pushOnePath } from "./git.js";
import { readVersions, type Version, type Versions } from "./hydrate.js";
import { assetsRoot, readSelection } from "./selection.js";
import { blocker, isBlocker, refuse, say } from "./output.js";
import { type Ui, terminalUi } from "./prompt.js";
import { loading } from "./loading.js";
import { type ExitRow, exitScreen } from "./screens.js";
import { good } from "./style.js";

export interface ReviewInput {
	/** `W0` — the tree preflight recorded at boot (01 §7). */
	boot: string;
	/** One key, one message: 01 §7.3 exactly. Nothing here can reach a team ref. */
	push(key: string, message: string): Promise<void>;
	/** `Composed.policy.kinds` — what a `made` directory's kind is checked against (§11.11). */
	kinds: string[];
	interactive: boolean;
	/** The controls (08 §10.0 step 4); a test passes its own. */
	ui?: Ui;
	/** Called once the review knows what it will say, before it says it — `run` stops the loading pixels here. */
	ready?: () => void;
	/** The session's harness — the one the person is editing their version of (D119). */
	harness: string;
	/** Step 5a: called once with every key that was kept, after the pushes. */
	kept?: (keys: string[]) => Promise<void>;
	/** Step 4c: a key the person removed this session — delete the person's own copy, if the copy was theirs. */
	remove?: (key: string) => Promise<void>;
	/** Step 5b: called once with every removal that was kept. */
	removed?: (keys: string[]) => Promise<void>;
	/** 01 §8 row 0: a key the subscription never materialised is absent from the
	    work tree for a reason that is not the person's. `candidates()` already
	    passes over it for `changed`; this is the same rule for `removed`.
	    `hydrate.ts`'s `subscription` is the rule, and there is no second copy. */
	subscribed?: (version: Version) => boolean;
}

/**
 * Every `<kind>/<name>` **on disk**, each carrying whether it holds an
 * `asset.json` — the one walk both of §10.0 step 1's lists come out of. A key
 * the boot tree named but the subscription did not materialise (01 §8 row 0) is
 * absent from the work tree, so it differs from the boot tree for a reason that
 * is not a change of the person's — and there would be nothing to push for it
 * either.
 */
async function candidates(): Promise<Array<{ key: string; sidecar: boolean }>> {
	const found = new Map<string, boolean>();
	for (const kind of await readdir(assetsRoot(), { withFileTypes: true }).catch(() => [])) {
		if (!kind.isDirectory()) continue;
		for (const name of await readdir(`${assetsRoot()}/${kind.name}`, { withFileTypes: true }).catch(() => [])) {
			if (!name.isDirectory()) continue;
			const key = `${kind.name}/${name.name}`;
			// An empty directory is a `mkdir` nobody followed up; there is nothing to keep.
			if ((await readdir(`${assetsRoot()}/${key}`).catch(() => [])).length === 0) continue;
			found.set(key, await onDisk(`${key}/asset.json`));
		}
	}
	return [...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, sidecar]) => ({ key, sidecar }));
}

export const onDisk = (key: string): Promise<boolean> => stat(`${assetsRoot()}/${key}`).then(() => true, () => false);

/** `+n −m` for one key, from `git diff --numstat` (§10.0 step 4). */
async function counts(boot: string, work: string, key: string): Promise<string> {
	const out = await g("diff", "--numstat", boot, work, "--", key).catch(() => "");
	let added = 0;
	let removed = 0;
	for (const line of out.split("\n")) {
		const [a, r] = line.split("\t");
		if (a !== undefined && a !== "-") added += Number(a) || 0;
		if (r !== undefined && r !== "-") removed += Number(r) || 0;
	}
	return `+${added} −${removed}`;
}


/** Present in `W₀`, so a delivery brought it and the agent did not make it. */
const inBoot = (boot: string, key: string): Promise<boolean> =>
	g("rev-parse", "--verify", "--quiet", `${boot}:${key}`).then(() => true, () => false);

/**
 * §10.0 (D115) — the one prompt `run` ever makes. Push only: *offer* is a
 * separate verb the summary names, and nothing here can reach the team branch
 * (`exit_review_never_touches_team_ref`).
 */
export async function exitReview(input: ReviewInput): Promise<string[]> {
	const work = await worktreeTree();
	const changed: string[] = [];
	const made: string[] = [];
	// D120: a key the boot tree delivered that is no longer on disk was removed
	// this session — a change like any other, kept by pushing the removal.
	const removed: string[] = [];
	// W5-D10: a required asset is in every session's load set, so it cannot
	// leave a harness. The review never offers to keep its removal — a question
	// it would then refuse is worse than the sentence that explains it.
	const delivered = await readVersions(input.boot);
	const refused: string[] = [];
	for (const key of Object.keys(delivered).sort()) {
		if (await onDisk(key)) continue;
		const version = delivered[key];
		if (version === undefined || input.subscribed?.(version) === false) continue;
		if (version.required) refused.push(key);
		else removed.push(key);
	}
	for (const key of refused) say(`\`${key}\` is required, so it stays in every harness; the next session delivers it again.`);
	for (const { key, sidecar } of await candidates()) {
		// A made directory differs from W₀ as well, being new, so it would land in
		// both lists; it belongs in `made` alone, because nothing can push it until
		// it has a sidecar.
		if (!sidecar && !(await inBoot(input.boot, key))) made.push(key);
		else if (await differs(input.boot, work, key)) changed.push(key);
	}
	input.ready?.();
	if (changed.length === 0 && made.length === 0 && removed.length === 0) return changed; // Step 2: print nothing.

	if (!input.interactive) {
		// Step 3: never a prompt; the exact command for each, and continue.
		// The run may have named the harness with a flag rather than a selection, so the hint names it.
		const flag = ` --harness ${JSON.stringify(input.harness)}`;
		for (const key of changed) say(`\`${key}\` changed — \`harness push ${key} --message "…"${flag}\``);
		for (const key of made) say(`\`${key}\` was made this session — \`harness adopt ${join(assetsRoot(), key)}\``);
		for (const key of removed) say(`\`${key}\` was removed this session — \`harness remove ${key}${flag}\``);
		return changed;
	}

	// W5-D12. The same header the boot screen drew, then every change on its
	// own line, then the one choice: all, none, or pick — and only a pick
	// opens the checklist. One message for everything kept; enter alone takes
	// the default.
	say("");
	const rows = {
		changed: await Promise.all(changed.map(async (key) => ({ key, note: await counts(input.boot, work, key) }))),
		made: made.map((key) => ({ key, note: "made this session" })),
		removed: removed.map((key) => ({ key, note: "removed this session" })),
	};
	for (const line of exitScreen(input.harness, rows)) say(line);
	const ui = input.ui ?? terminalUi({ stdin, stdout });
	const offered = [...changed, ...made, ...removed];
	const choice = await ui.select("Keep these as yours?", ["All", "None", "Pick"]);
	if (choice === null || choice === 1) return changed;
	let keep = offered;
	if (choice === 2) {
		const ticked = await ui.checklist("Which?", offered);
		if (ticked === null || ticked.length === 0) return changed;
		keep = ticked.map((at) => offered[at] as string);
	}
	const message = await ui.line("Message?", "enter for the default");
	const saving = loading("saving", stdout);
	const done: string[] = [];
	const gone: string[] = [];
	try {
		for (const key of keep) {
			if (removed.includes(key)) {
				if (await keepRemoval(input, key)) gone.push(key);
			} else if (await keepOne(input, made, key, message)) done.push(key);
		}
		if (done.length > 0 && input.kept) await input.kept(done);
		if (gone.length > 0 && input.removed) await input.removed(gone);
	} finally {
		saving.stop();
	}
	if (done.length + gone.length > 0) say(`${good("✓")} progress saved to your ${input.harness}`);
	return changed;
}

/** Step 4c: a removal is kept by deleting the person's own copy (step 6 on failure). */
async function keepRemoval(input: ReviewInput, key: string): Promise<boolean> {
	try {
		await input.remove?.(key);
		return true;
	} catch (thrown) {
		if (!isBlocker(thrown)) throw thrown;
		blocker(thrown);
		return false;
	}
}

/**
 * Step 4: keeping a `made` directory is `adopt` in place (§11.11) and then the
 * ordinary push. Step 6: either half failing is printed with its blocker and
 * the review continues with the next key.
 */
async function keepOne(input: ReviewInput, made: string[], key: string, message: string): Promise<boolean> {
	try {
		// The kind is the directory it sits in, not its shape: the seam asked the
		// agent for `<kind>/<name>/` (07 §6a), and a made `prompt/x/x.md` would
		// otherwise be inferred a memory and moved.
		if (made.includes(key)) await adoptDir(join(assetsRoot(), key), false, input.kinds, key.split("/")[0]);
		await input.push(key, message.trim() === "" ? `Update ${key}` : message.trim());
		return true;
	} catch (thrown) {
		if (!isBlocker(thrown)) throw thrown;
		blocker(thrown);
		return false;
	}
}

/**
 * D118: a push never lands loose. `target` is a harness name or id (`--harness`);
 * without one the selection stands; without either, `cli.no_harness_target`.
 */
export async function resolveHarness(composed: Composed, target?: string): Promise<HarnessDef> {
	const wanted = target?.toLowerCase();
	const selection = wanted === undefined ? await readSelection() : undefined;
	const harness = composed.harnesses.find((one) =>
		wanted === undefined ? one.id === selection?.harness_id : one.id === wanted || one.name.toLowerCase() === wanted,
	);
	if (harness !== undefined) return harness;
	if (wanted !== undefined) {
		refuse("preflight.harness_unknown", `No harness called \`${target}\`. You have: ${composed.harnesses.map((one) => one.name).join(", ") || "none"}.`, "harness switch");
	}
	refuse("cli.no_harness_target", "Every push lands in a harness, and none is selected.", "`harness switch <name>` picks one for every push; `--harness <name>` names one for this push.");
}

/**
 * Step 5a. A pushed asset joins its harness: `harnesses/<id>.json` on the
 * person's own branch, the harness's id kept (D3, the person's version of it),
 * `assets` extended. One commit for all of them; nothing when every key is
 * already listed. Returns the harness's name for the sentence.
 */
export async function joinHarness(
	composed: Composed,
	push: (path: string, body: string, message: string) => Promise<void>,
	keys: string[],
	target?: string,
	quiet = false,
): Promise<string> {
	const harness = await resolveHarness(composed, target);
	const ids: string[] = [];
	for (const key of keys) {
		const sidecar = JSON.parse(await readFile(join(assetsRoot(), key, "asset.json"), "utf8")) as { id: string };
		if (!harness.assets.includes(sidecar.id) && !ids.includes(sidecar.id)) ids.push(sidecar.id);
	}
	if (ids.length > 0) {
		const definition: HarnessDef = { ...harness, assets: [...harness.assets, ...ids] };
		await push(`harnesses/${harness.id}.json`, `${JSON.stringify(definition, null, 2)}\n`, `Add ${ids.length} to ${harness.name}`);
		if (!quiet) say(`Added to ${harness.name} (your version): ${keys.join(", ")}.`);
	}
	return harness.name;
}

/**
 * D120. The person's own copy of `key` — the one their branch holds — is
 * deleted from their branch; a copy the team or the organisation holds is
 * theirs to keep, and leaving the harness (`leaveHarness`) is what removes it
 * from this person's sessions. `versions` is the delivery this decision is
 * against: the boot tree in the review, `refs/harness/remote` for `remove`.
 */
export async function removeOwnCopy(
	credentials: Credentials,
	me: Me,
	versions: Versions,
	key: string,
	quiet = false,
): Promise<void> {
	const version = versions[key];
	if (version === undefined || version.from !== me.chain[me.chain.length - 1]?.path) return;
	await pushOnePath({ token: credentials.token, origin: origin(me), userId: me.user.id, message: `Remove ${key}`, source: { path: `assets/${key}`, kind: "absent" } });
	if (!quiet) say(`Deleted \`${key}\` from your branch.`);
}

/**
 * W5-D10. `cli.asset_required`: an id on the organisation's `required` list is
 * in every session's load set (03 §5.3), so removing it from a harness would
 * be a decision the next boot undoes. Refused before anything is deleted.
 */
export function refuseIfRequired(versions: Versions, keys: string[]): void {
	const held = keys.filter((key) => versions[key]?.required === true);
	if (held.length === 0) return;
	const one = held.length === 1;
	refuse(
		"cli.asset_required",
		`${held.join(", ")} ${one ? "is" : "are"} required: every session loads ${one ? "it" : "them"}, so ${one ? "it cannot" : "they cannot"} be removed from a harness.`,
		"An organisation admin decides what is required, on the organisation's Assets screen.",
	);
}

/** Step 5b, the counterpart of `joinHarness`: the ids leave the person's version of the harness. */
export async function leaveHarness(
	composed: Composed,
	push: (path: string, body: string, message: string) => Promise<void>,
	versions: Versions,
	keys: string[],
	target?: string,
	quiet = false,
): Promise<string> {
	refuseIfRequired(versions, keys);
	const harness = await resolveHarness(composed, target);
	const ids = new Set(keys.map((key) => versions[key]?.id).filter((id): id is string => id !== undefined));
	const assets = harness.assets.filter((id) => !ids.has(id));
	if (assets.length !== harness.assets.length) {
		const definition: HarnessDef = { ...harness, assets };
		await push(`harnesses/${harness.id}.json`, `${JSON.stringify(definition, null, 2)}\n`, `Remove ${harness.assets.length - assets.length} from ${harness.name}`);
		if (!quiet) say(`Removed from ${harness.name} (your version): ${keys.join(", ")}.`);
	}
	return harness.name;
}
