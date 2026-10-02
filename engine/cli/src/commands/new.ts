import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Composed, HarnessDef } from "@harness/compose/contracts";
import { api } from "../api.js";
import { origin, type Me } from "../boot.js";
import type { Credentials } from "../credentials.js";
import { g, pushOnePath } from "../git.js";
import { refuse, say } from "../output.js";

/** A blank 16×16, `harnesses.md` §6 — the console gives it a drawing later. */
const BLANK = { palette: [], rows: Array.from({ length: 16 }, () => ".".repeat(16)) };

/** The last dotted segment, the way a sentence names a unit (`name_of`). */
const label = (path: string): string => {
	const last = path.split(".").pop() ?? path;
	return last.charAt(0).toUpperCase() + last.slice(1);
};

/** The person's own team, for the hint on the own-branch landing line. */
const ownTeam = (me: Me): string | undefined => me.chain.filter((node) => node.kind === "team").pop()?.path;

/**
 * The dotted path `scope` names. A bare last segment is accepted when exactly
 * one team on the chain ends with it; two are ambiguous. A word that names no
 * team of theirs goes to the server verbatim — an org admin administers nodes
 * that are not on their own chain, and only the server knows which.
 */
function teamPath(me: Me, wanted: string): string {
	const matched = me.chain.filter((node) => node.kind === "team" && node.path.split(".").pop() === wanted);
	if (matched.length > 1) {
		refuse("cli.team_ambiguous", `\`${wanted}\` names more than one team you are on: ${matched.map((node) => node.path).join(", ")}.`, `harness new "…" --team ${matched[0].path}`);
	}
	return matched[0]?.path ?? wanted;
}

/**
 * §11.12 (D107, D116). Creates a harness and says where it landed. Without a
 * flag it goes on the person's branch and is pushed at once, so the console
 * sees it; nobody approves it, because it inherits exactly what the person
 * already holds. With `--team`/`--org` it is an admin's, so the server commits
 * it on the named ref and refuses `harness.not_yours` to anyone else.
 */
export async function newHarness(credentials: Credentials, me: Me, composed: Composed, name: string, from?: string, scope?: string): Promise<number> {
	if (composed.harnesses.some((one) => one.name.toLowerCase() === name.toLowerCase())) {
		refuse("cli.harness_name_taken", `You already have a harness called "${name}".`, `Pick another name, or \`harness switch ${name}\`.`);
	}
	let source: HarnessDef | undefined;
	if (from !== undefined) {
		source = composed.harnesses.find((one) => one.name.toLowerCase() === from.toLowerCase() || one.id === from);
		if (source === undefined) {
			refuse("preflight.harness_unknown", `No harness called \`${from}\`. You have: ${composed.harnesses.map((one) => one.name).join(", ") || "none"}.`, "harness switch");
		}
	}
	// W5-D10: a new harness starts with what the organization recommends —
	// ordinary entries from that moment, which the person may remove. Copying
	// `--from` is the same idea with a different source, so the two union.
	const recommended = composed.policy.recommended.filter((id) => composed.assets.some((asset) => asset.id === id));
	const assets = [...new Set([...(source === undefined ? [] : source.assets), ...recommended])];
	const node = scope === undefined ? undefined : scope === "org" ? (me.chain[0]?.path ?? "org") : teamPath(me, scope);

	if (node === undefined) await onOwnBranch(credentials, me, name, assets);
	else {
		// The copy is the server's: it reads `from`'s assets and the organization's
		// recommended list on the ref it commits to, so `assets` stays empty and
		// nothing here holds a version of them (00 §4.10). The id is resolved
		// locally because `from` is a uuid on the wire.
		await api(credentials, "/v1/harnesses", {
			method: "POST",
			body: JSON.stringify({ name, description: "", icon: BLANK, assets: [], scope: scope === "org" ? "org" : node, ...(source === undefined ? {} : { from: source.id }) }),
		});
	}

	say(`${name}  ·  ${assets.length} ${assets.length === 1 ? "asset" : "assets"}`);
	if (node === undefined) {
		const team = ownTeam(me);
		say(`Created on your branch. Only you have it.${team === undefined ? "" : `  (\`--team ${team.split(".").pop()}\` would make it ${label(team)}'s.)`}`);
		say(`\`harness switch ${name}\` to pick it up.`);
		return 0;
	}
	say(scope === "org" ? "Created on the organization's branch. Every team inherits it." : `Created on ${label(node)}'s branch. Everyone on ${label(node)} inherits it.`);
	say(`\`harness switch ${JSON.stringify(name)} --team\` to pick it up.`);
	return 0;
}

/** 01 §7.3 with a different source for step 3: a scratch file, not a subtree. */
async function onOwnBranch(credentials: Credentials, me: Me, name: string, assets: string[]): Promise<void> {
	const definition: HarnessDef = { id: randomUUID(), name, description: "", icon: BLANK, assets };
	await pushFile(credentials, me, `harnesses/${definition.id}.json`, `${JSON.stringify(definition, null, 2)}\n`, `created harness ${name}`);
}

/** One generated file onto the person's branch — a harness definition here, the
    exit review's harness update (08 §10.0 step 5a) elsewhere. */
export async function pushFile(credentials: Credentials, me: Me, path: string, body: string, message: string): Promise<void> {
	const scratch = await mkdtemp(join(tmpdir(), "harness-new-"));
	let oid: string;
	try {
		const file = join(scratch, basename(path));
		await writeFile(file, body);
		oid = (await g("hash-object", "-w", "--", file)).trim();
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
	await pushOnePath({ token: credentials.token, origin: origin(me), userId: me.user.id, message, source: { path, kind: "blob", oid } });
}
