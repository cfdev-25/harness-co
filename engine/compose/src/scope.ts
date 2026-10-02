import type { Chain, Scope } from "./contracts.js";

/**
 * 03 §5.1, the one scoping primitive. It lives in `compose` because `cli`,
 * `definitions` and the console all need it and none of them may own a
 * second copy; `api` carries a conformance-tested Python twin (04).
 */
export function covers(scope: Scope, chain: Chain, harnessId: string | null): boolean {
	const teams = chain.filter((node) => node.kind === "team").map((node) => node.path);
	// 1. A user path is never a scope target, so only team nodes are compared.
	if (scope.teams !== "all" && !scope.teams.some((team) => teams.includes(team))) return false;
	// 2. Absent `harnesses` is every harness the teams own, so it is not a filter.
	if (scope.harnesses !== undefined) {
		if (harnessId === null) return false;
		if (!scope.harnesses.includes(harnessId)) return false;
	}
	return true;
}

/**
 * 03 §5.1: `(depth, narrowed)`, ordered lexicographically, larger is more
 * specific. `depth` is the index in `chain` of the deepest team the scope
 * names — `-1` for `"all"`, which is also `-1` for a team not on this chain,
 * because a scope that does not reach the person cannot be the more specific
 * of two that do (`covers` has already excluded it).
 */
export function scopeSpecificity(scope: Scope, chain: Chain): [number, number] {
	const narrowed = scope.harnesses === undefined ? 0 : 1;
	if (scope.teams === "all") return [-1, narrowed];
	let depth = -1;
	for (const team of scope.teams) {
		const at = chain.findIndex((node) => node.path === team);
		if (at > depth) depth = at;
	}
	return [depth, narrowed];
}
