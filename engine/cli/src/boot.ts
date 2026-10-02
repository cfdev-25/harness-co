import { compose, gitReader } from "@harness/compose";
import type { Chain, Composed } from "@harness/compose/contracts";
import { api } from "./api.js";
import type { Credentials } from "./credentials.js";
import { fetchChain, offlineChain } from "./git.js";
import { hydrate } from "./hydrate.js";
import { assetsGitDir } from "./selection.js";
import { refuse, say } from "./output.js";

/** `GET /v1/me` (00 §4.10), plus the two fields 01 §7.2 needs to name `origin`. */
export interface Me {
	user: { id: string; email?: string | null };
	chain: Chain;
	role: { level: "member" | "team-admin" | "org-admin"; at: string | null };
	org: string;
	definitions: string;
}

/** Row 0's one server call, and `--as`'s gate (§6): a `403` before any fetch. */
export async function whoIs(credentials: Credentials, as?: string): Promise<Me> {
	try {
		return await api<Me>(credentials, `/v1/me${as === undefined ? "" : `?as=${encodeURIComponent(as)}`}`);
	} catch (thrown) {
		if ((thrown as { status?: number }).status === 403 && as !== undefined) {
			refuse("cli.as_not_admin", `You are not an admin of a team ${as} is in, so their version is not yours to open.`, "Ask an organisation admin.");
		}
		refuse("preflight.api_unreachable", `Could not reach the Harness API at ${credentials.api_url}.`, "Is it running? `harness preflight identity`.");
	}
}

export const origin = (me: Me): string => `${me.definitions}/${me.org}.git`;

/** Row 1. `--offline` skips this row and only this row (D113). */
export async function rowFetch(credentials: Credentials, me: Me, offline: boolean): Promise<Chain> {
	return offline ? offlineChain() : fetchChain(credentials.token, origin(me), me.chain);
}

/** Row 2. A non-empty `conflicts` is the boot's first refusal (01 §9). */
export async function rowCompose(chain: Chain): Promise<Composed> {
	const composed = await compose(chain, gitReader(assetsGitDir()));
	if (composed.conflicts.length > 0) {
		const first = composed.conflicts[0];
		// Every kind names the thing it is about under one of these four keys.
		const named = first as { path?: string; grant?: string; at?: string; id?: string };
		const where = named.path ?? named.grant ?? named.at ?? named.id ?? first.kind;
		// 01 §9's table. Two of the kinds have a remedy that is not the Assets
		// screen, and an organisation upgrading across 01 D132 meets one of them
		// on every session until an admin removes the grant, so it must say so.
		const remedy =
			first.kind === "reach-grant-retired"
				? "Reach is `policy/reach.json` now, not a grant. An organisation admin removes this grant and sets reach under Boundaries → Reach."
				: first.kind === "reach-widened"
					? `Reach only ever narrows on the way down: ${"why" in first ? first.why : "this step gives more than it inherits"}. An admin of the node above sets it there.`
					: "An organisation admin fixes it on the Assets screen; `harness preflight assets` lists every one.";
		refuse(`compose.${first.kind.replace(/-/g, "_")}`, `Your organisation's definitions do not compose: ${first.kind} at ${where}.`, remedy);
	}
	return composed;
}

/** Row 3. The full composed set, never the harness subset (S2). */
export async function rowHydrate(composed: Composed): Promise<void> {
	await hydrate(composed, say);
}
