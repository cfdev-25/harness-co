import type { Enforcer } from "@harness/compose/contracts";

/**
 * 03 §5.7 row 2. The connector table the proxy loads: one entry per minted
 * alias from the group entry `MintedCredential.resolvedFrom` names, plus the
 * reserved alias `model` (05 §6), whose upstream is the chosen endpoint rather
 * than the entry's own.
 */
export const credentials: Enforcer = {
	name: "credentials",
	plan(composed, choices, minted, plan) {
		const connectors = { ...plan.connectors };
		for (const credential of minted) {
			const group = composed.policy.groups[credential.resolvedFrom.group];
			const entry = group?.entries.find((one) => one.alias === credential.alias);
			// Both are present by construction (02 §7 step 11), so a miss is a bug.
			if (entry === undefined) {
				throw new Error(`the broker minted ${credential.alias} from group ${credential.resolvedFrom.group}, which holds no such entry`);
			}
			// 05 §6 step 5 relies on this having been refused at plan time.
			if (!entry.upstream.startsWith("https://")) throw new Error(`group ${group.name} gives ${entry.alias} the upstream ${entry.upstream}, which is not https`);
			connectors[credential.alias] = { upstream: entry.upstream, attach: entry.attach };
		}
		const alias = choices.model.provider.credential?.alias;
		const model = alias === undefined ? undefined : connectors[alias];
		// D134 reverses D73's "no wire-format field" for the *shaping* half only:
		// the usage sniff is still shape-agnostic, but which capability names a
		// request may carry is the wire format's, so the proxy is told it once.
		if (model !== undefined) connectors.model = { upstream: choices.model.endpoint, attach: model.attach, wireFormat: choices.model.wireFormat };
		return { ...plan, connectors };
	},
};
