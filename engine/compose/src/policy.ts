import type { ChainNode, Grant, SecurityGroup } from "./contracts.js";

/**
 * Every shape in `00 §4.2`/`§4.3` as data, checked by one walker.
 *
 * Eight hand-written validators would be eight places to forget that an
 * unknown key is refused (01 §5 rule 2, 02 §7 rule 11) — so the shapes are a
 * table and there is one rule. A `?` suffix on a key makes it optional.
 */
type Spec = string | Spec[] | { [key: string]: Spec };

const or = (...of: Spec[]): Spec => ({ $or: of });
const rec = (of: Spec, keys?: Spec): Spec => (keys ? { $rec: of, $keys: keys } : { $rec: of });

/** 01 §5 rule 2. Lowercase, because an id that differs only in case is two ids. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const FORMAT = "e:anthropic-messages|openai-completions|openai-responses|google-generative|bedrock-converse";
const SCOPE: Spec = { teams: or(["string"], "e:all"), "harnesses?": ["string"] };
const NEED: Spec = or(
	{ kind: "e:credential", alias: "string" },
	{ kind: "e:asset", id: "uuid" },
	// W5-D15: the environment a tool runs in, by name. Inert here — compose
	// neither resolves it nor adds it to a set; the store's *Add to harness*
	// reads it and brings the environment along (console 04 §12).
	{ kind: "e:environment", name: "string" },
	{ kind: "e:login", tool: "string" },
);

/** Keyed by the file name 01 §4.2 gives it, plus the two shapes that are not files. */
export const SPECS = {
	sidecar: {
		id: "uuid",
		kind: "string",
		"needs?": [NEED],
		"format?": FORMAT,
		// WS3a (wave 5): shown on the organization assets row; written by
		// `PATCH /v1/assets/{id}`, never by a kind's own metadata.
		"description?": "string",
	} as Spec,
	harness: {
		id: "uuid",
		name: "string",
		description: "string",
		icon: { palette: ["string"], rows: ["string"] },
		assets: ["uuid"],
		"reach?": { mode: "e:off|allow|on", "hosts?": ["string"] },
	} as Spec,
	"boundaries.json": [
		{
			id: "string",
			scope: SCOPE,
			kind: "e:endpoint|command|filesystem|capability",
			value: "string",
			holds: "e:enforced|intercepted",
			reason: "string",
		},
	] as Spec,
	"grants.json": [
		{
			id: "string",
			scope: SCOPE,
			"group?": "string",
			// D132: retired, and still accepted by the shape so a branch that holds
			// one composes to `reach-grant-retired` rather than to `malformed`.
			"reach?": "e:outside-endpoints",
			"narrowedFrom?": { grant: "string", aliases: ["string"] },
			by: "string",
		},
	] as Spec,
	"groups.json": [
		{
			name: "string",
			entries: [
				{
					alias: "string",
					secret: { vault: "string", ref: "string" },
					upstream: "string",
					attach: { header: "string", prefix: "string" },
				},
			],
			sources: "e:vault|vault-or-local",
			"mint?": rec("any"),
		},
	] as Spec,
	"harness-providers.json": [
		{
			id: "string",
			// W6-D3. Optional here, required in our presets: a branch seeded before
			// this change holds rows with no name and must keep composing.
			"name?": "string",
			approval: "e:approved|beta|not-approved",
			scope: SCOPE,
			pin: or({ repo: "string", commit: "string" }, { binary: "string", minVersion: "string" }),
			speaks: [FORMAT],
			"reason?": "string",
		},
	] as Spec,
	"model-providers.json": [
		{ id: "string", endpoints: rec("string", FORMAT), models: ["string"], "credential?": { alias: "string" } },
	] as Spec,
	"routing.json": {
		defaultFor: { teams: rec("string"), harnesses: rec("string"), providers: rec("string") },
		approvedFor: { teams: rec(["string"]), harnesses: rec(["string"]), providers: rec(["string"]) },
	} as Spec,
	"kinds.json": ["string"] as Spec,
	// W5-D10. Two lists; a bare array is still accepted and read as `required`,
	// which is what every organization's file holds until an admin changes one.
	"always-loaded.json": or(["uuid"], { "required?": ["uuid"], "recommended?": ["uuid"] }) as Spec,
	// D131. Kept next to the others even though it is per node, not org-only:
	// the shape is one, and which nodes may hold it is 01 §4.2's business.
	"reach.json": { mode: "e:off|allow|on", "hosts?": ["string"] } as Spec,
};

function check(value: unknown, spec: Spec, at: string): string | null {
	if (typeof spec === "string") {
		if (spec === "any") return null;
		if (spec === "uuid")
			return typeof value === "string" && UUID.test(value) ? null : `${at} is not a lowercase RFC 4122 uuid`;
		if (spec.startsWith("e:")) {
			const values = spec.slice(2).split("|");
			return typeof value === "string" && values.includes(value) ? null : `${at} must be one of ${values.join(", ")}`;
		}
		return typeof value === spec ? null : `${at} must be a ${spec}`;
	}
	if (Array.isArray(spec)) {
		if (!Array.isArray(value)) return `${at} must be an array`;
		for (let at_ = 0; at_ < value.length; at_++) {
			const why = check(value[at_], spec[0], `${at}[${at_}]`);
			if (why) return why;
		}
		return null;
	}
	if ("$or" in spec) {
		const alternatives = spec.$or as Spec[];
		return alternatives.some((alternative) => check(value, alternative, at) === null)
			? null
			: `${at} is none of the shapes it may take`;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return `${at} must be an object`;
	if ("$rec" in spec) {
		for (const [key, entry] of Object.entries(value)) {
			const keyWhy = spec.$keys === undefined ? null : check(key, spec.$keys, `${at}'s key ${key}`);
			const why = keyWhy ?? check(entry, spec.$rec, `${at}.${key}`);
			if (why) return why;
		}
		return null;
	}
	const extra = new Set(Object.keys(value));
	for (const [declared, field] of Object.entries(spec)) {
		const key = declared.endsWith("?") ? declared.slice(0, -1) : declared;
		extra.delete(key);
		const entry = (value as Record<string, unknown>)[key];
		if (entry === undefined) {
			if (declared === key) return `${at} is missing ${key}`;
			continue;
		}
		const why = check(entry, field, `${at}.${key}`);
		if (why) return why;
	}
	// 01 §5 rule 2: a sidecar is not a place for a kind's own metadata.
	return extra.size === 0 ? null : `${at} has unknown key${extra.size > 1 ? "s" : ""} ${[...extra].sort().join(", ")}`;
}

/** Parse and validate one file's bytes. The `why` is the `Conflict.malformed` text. */
export function readJson(bytes: Uint8Array, spec: Spec, at: string): { value: unknown } | { why: string } {
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
	} catch (error) {
		// The one failure mode the doc names for a file on a branch: git carries
		// whatever a file claims (prd-v2 §4.1), so this is data, never a bug.
		return { why: `${at} does not parse: ${(error as Error).message}` };
	}
	const why = check(value, spec, at);
	return why === null ? { value } : { why };
}

/**
 * 01 §6 step 9, clauses (a)–(e): is this grant on a team node a narrowing of
 * one the chain already holds? Returns the clause that failed, or null.
 * `prd-v2.md` §6.4 as arithmetic; 02 §7 rule 12 is this function.
 *
 * The clause is returned as data as well as prose so 02 §10 can choose between
 * `grant_widens` and `grant_outside_subtree` without reading English.
 * `"none"` is step 8 — a team grant that narrows nothing at all.
 */
export function narrowingFault(
	grant: Grant,
	node: ChainNode,
	held: Grant[],
	groups: Record<string, SecurityGroup>,
): { clause: "none" | "a" | "b" | "c" | "d" | "e"; why: string } | null {
	const fault = (clause: "none" | "a" | "b" | "c" | "d" | "e", why: string) => ({ clause, why });
	const from = grant.narrowedFrom;
	// 8. Every grant on a team node must carry narrowedFrom.
	if (!from) return fault("none", "a team may only narrow a grant it holds, and this one names none");
	// (a)
	const source = held.find((candidate) => candidate.id === from.grant);
	if (!source) return fault("a", `(a) no grant called ${from.grant} is held above ${node.path}`);
	// (b) the source's scope must reach N: "all", N itself, or an ancestor of N.
	const inside = (path: string, under: string) => path === under || path.startsWith(`${under}.`);
	if (source.scope.teams !== "all" && !source.scope.teams.some((team) => inside(node.path, team)))
		return fault("b", `(b) ${from.grant} does not reach ${node.path}`);
	// (c) the narrowing stays inside N's subtree and may not widen the harnesses.
	if (grant.scope.teams === "all") return fault("c", `(c) a narrowed grant names teams inside ${node.path}, never every team`);
	const outside = grant.scope.teams.filter((team) => !team.startsWith(`${node.path}.`));
	if (outside.length) return fault("c", `(c) ${outside.join(", ")} is not inside ${node.path}`);
	const sourceHarnesses = source.scope.harnesses;
	if (sourceHarnesses && !(grant.scope.harnesses ?? []).every((id) => sourceHarnesses.includes(id)))
		return fault("c", `(c) its harnesses are not among ${from.grant}'s`);
	// (d) reach cannot be narrowed by alias, and a team may only pass on what it holds.
	if (!source.group) return fault("d", `(d) ${from.grant} grants reach, which cannot be narrowed by alias`);
	const group = groups[source.group];
	if (!group) return fault("d", `(d) ${from.grant} names the group ${source.group}, which the organization does not define`);
	// A grant narrowed from an already-narrowed one may only keep that one's
	// aliases: tighten only, so the trail can never widen a step at a time.
	const holdable = source.narrowedFrom ? source.narrowedFrom.aliases : group.entries.map((entry) => entry.alias);
	const unheld = from.aliases.filter((alias) => !holdable.includes(alias));
	if (from.aliases.length === 0) return fault("d", `(d) it narrows ${from.grant} to no alias at all`);
	if (unheld.length) return fault("d", `(d) ${node.path} does not hold ${unheld.join(", ")} in ${source.group}`);
	// (e)
	if (grant.group !== source.group)
		return fault("e", `(e) its group ${grant.group ?? "(none)"} is not ${from.grant}'s group ${source.group}`);
	return null;
}
