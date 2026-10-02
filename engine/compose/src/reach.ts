import type { EffectiveReach, HarnessDef, Reach } from "./contracts.js";

/**
 * D131's arithmetic: reach narrows down the chain and never widens.
 *
 * `off` reaches nothing, `allow` reaches a list, `on` reaches everything but a
 * list — so the modes are ordered `on` ⊃ `allow` ⊃ `off` and a step may only
 * move down that order. Within a mode the same rule holds over the list: an
 * allow-list may lose hosts, a deny-list may gain them, and never the reverse.
 *
 * Hosts are compared as written. A pattern is not the host it matches, so
 * `*.github.com` and `api.github.com` are two entries and neither implies the
 * other — which keeps "did this step widen?" a set question with one answer.
 */
export const RANK: Record<Reach["mode"], number> = { on: 0, allow: 1, off: 2 };

/** C32 for reach: absent everywhere is `off`, set by the node that could turn it on. */
export const noReach = (at: string): EffectiveReach => ({ mode: "off", hosts: [], setBy: at });

/** One step of the walk. `why` is set when the step widened: the parent stands. */
export function narrowReach(parent: EffectiveReach, step: Reach, at: string): { reach: EffectiveReach; why?: string } {
	const stand = (why: string) => ({ reach: parent, why });
	if (RANK[step.mode] < RANK[parent.mode])
		return stand(`reach at ${at} is \`${step.mode}\`, which is wider than the \`${parent.mode}\` it inherits from ${parent.setBy}`);
	if (step.mode === "allow" && parent.mode === "allow") {
		const added = step.hosts.filter((host) => !parent.hosts.includes(host));
		if (added.length > 0) return stand(`${at} adds ${added.join(", ")} to an allow-list ${parent.setBy} does not hold them in`);
	}
	if (step.mode === "allow" && parent.mode === "on") {
		// Moving `on` → `allow` is a narrowing, but a host the parent denies is
		// still denied: an allow-list may not name it back.
		const denied = step.hosts.filter((host) => parent.hosts.includes(host));
		if (denied.length > 0) return stand(`${at} allows ${denied.join(", ")}, which ${parent.setBy} denies`);
	}
	if (step.mode === "on") {
		// Anything wider than the parent was refused above, so the parent is `on` too.
		const removed = parent.hosts.filter((host) => !step.hosts.includes(host));
		if (removed.length > 0) return stand(`${at} drops ${removed.join(", ")} from a deny-list it inherits from ${parent.setBy}`);
	}
	const hosts = step.mode === "off" ? [] : [...step.hosts];
	const unchanged = step.mode === parent.mode && hosts.length === parent.hosts.length && hosts.every((host, at_) => host === parent.hosts[at_]);
	// A step that restates what it inherits narrowed nothing, so `setBy` still
	// names the node a person must go to in order to change it.
	return { reach: unchanged ? parent : { mode: step.mode, hosts, setBy: at } };
}

/**
 * The chain's reach with the harness's own last step applied (D131). Compose
 * cannot do this itself — `EffectivePolicy` is every harness at once — so the
 * session applies it, and compose reports the widening ones as conflicts.
 */
export function effectiveReach(chain: EffectiveReach, harness: Pick<HarnessDef, "id" | "reach"> | null): EffectiveReach {
	return harness?.reach ? narrowReach(chain, harness.reach, `harness:${harness.id}`).reach : chain;
}

/** D133's one matching rule: an exact host, or `*.suffix` for any subdomain of
    it but not the apex. The same rule the deny list has used since D77. */
export function hostMatches(host: string, pattern: string): boolean {
	const one = pattern.toLowerCase().replace(/:443$/, "");
	return one.startsWith("*.") ? host.endsWith(one.slice(1)) : host === one;
}

/** Does reach alone permit this host? `plan.hosts` and `plan.deny` are the
    tunnel's business (D133); this is the policy half, and it is pure. */
export function reachAllows(reach: Reach, host: string): { ok: true } | { ok: false; reason: "reach.off" | "reach.not-listed" | "reach.denied" } {
	if (reach.mode === "off") return { ok: false, reason: "reach.off" };
	const listed = reach.hosts.some((pattern) => hostMatches(host, pattern));
	if (reach.mode === "allow") return listed ? { ok: true } : { ok: false, reason: "reach.not-listed" };
	return listed ? { ok: false, reason: "reach.denied" } : { ok: true };
}
