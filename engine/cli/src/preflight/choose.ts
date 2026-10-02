import { covers } from "@harness/compose";
import type { Blocker, Chain, Choices, Composed, HarnessDef, HarnessProvider, Scope } from "@harness/compose/contracts";

/** 08 §6's grammar: the one undashed word, the one non-reserved dashed word,
    `--team`, and `--model <provider>/<id>`. */
export interface ChooseArgv {
	provider?: string; harnessFlag?: string; team?: boolean; model?: string;
}

/** The parsed `$HARNESS_HOME/harness.json` (00 D28). */
export interface Selection {
	harness_id?: string; name?: string; version?: "mine" | "team";
}

/** The `GET /v1/me` body; only `role` is read here (D50). */
export interface Me {
	role: { level: "member" | "team-admin" | "org-admin"; at: string | null };
}

const PROVIDERS = "/console/org/providers";
const teamsOf = (scope: Scope) => (scope.teams === "all" ? "every team" : scope.teams.join(", "));

/** D30i: `routing`'s `teams` keys are team paths **or the organisation's path**,
    so the walk is every node above the person, root first — nearest last. */
export const routedNodes = (chain: Chain): string[] => chain.filter((node) => node.kind !== "user").map((node) => node.path);

/** Every refusal in this file is 03 §7's row for its code, verbatim. */
function refuse(code: string, message: string, remedy: string, link?: string): never {
	throw (link === undefined ? { code, message, remedy } : { code, message, remedy, link }) satisfies Blocker;
}

/**
 * 03 §5.2. No I/O: `locate` is the Choose row's only I/O and `preflight.ts`
 * runs it, so this stays a pure function of the composition and the words.
 * The first failing step refuses with its `Blocker`.
 */
export function choose(composed: Composed, argv: ChooseArgv, selection: Selection | undefined, me: Me): Omit<Choices, "located"> {
	const teams = routedNodes(composed.chain);
	const here = teams[teams.length - 1] ?? "your organisation";

	// Step 1: the provider word.
	const known = Object.values(composed.policy.harnessProviders);
	const listed = known.map((one) => one.id).join(", ");
	const example = `harness run ${known[0]?.id ?? "<runtime>"}`;
	let provider: HarnessProvider | undefined;
	if (argv.provider === undefined) {
		if (known.length !== 1) refuse("preflight.provider_ambiguous", `Say which runtime: ${listed}.`, example);
		provider = known[0];
	} else {
		provider = known.find((one) => one.id === argv.provider);
		if (!provider) refuse("preflight.provider_unknown", `\`${argv.provider}\` is not a runtime your organisation has listed. Listed: ${listed}.`, example);
	}

	// Step 2: approval, then the beta rule the broker re-checks at mint (D50).
	if (provider.approval === "not-approved") {
		refuse("preflight.provider_not_approved", `${provider.id} is not approved for use: ${provider.reason ?? "no reason was recorded"}.`, "Ask an organisation admin to approve it.", PROVIDERS);
	}
	if (provider.approval === "beta" && me.role.level === "member") {
		refuse("preflight.provider_beta", `${provider.id} is in beta; only an admin may be handed credentials with it.`, "Ask an admin to approve it, or run an approved runtime.", PROVIDERS);
	}

	// Step 3: approval scope is by team only — the harness is not chosen yet.
	if (!covers(provider.scope, composed.chain, null)) {
		refuse("preflight.provider_out_of_scope", `${provider.id} is approved for ${teamsOf(provider.scope)}, not for ${here}.`, "Ask an organisation admin to widen its approval scope.", PROVIDERS);
	}

	// Step 4: the harness. A flag never writes the selection (harnesses.md §8.2),
	// and a selection naming a harness that is gone never falls back in silence.
	let harness: HarnessDef | null = null;
	if (argv.harnessFlag !== undefined) {
		const want = argv.harnessFlag.toLowerCase();
		const matched = composed.harnesses.filter((one) => one.name.toLowerCase() === want || one.id === argv.harnessFlag);
		if (matched.length === 0) refuse("preflight.harness_unknown", `No harness called \`${argv.harnessFlag}\`. You have: ${composed.harnesses.map((one) => one.name).join(", ") || "none"}.`, "harness switch");
		if (matched.length > 1) {
			refuse("preflight.harness_ambiguous", `\`${argv.harnessFlag}\` names more than one harness: ${matched.map((one) => `${one.name} (${one.id})`).join(", ")}.`, `harness run --${matched[0].id}`);
		}
		harness = matched[0];
	} else if (selection?.harness_id !== undefined) {
		harness = composed.harnesses.find((one) => one.id === selection.harness_id) ?? null;
		if (harness === null) refuse("preflight.harness_gone", `Your harness \`${selection.name ?? selection.harness_id}\` no longer exists, or is no longer shared with you.`, "harness switch");
	} else {
		// D119: a session is always in a harness — the person is always on their
		// own version of one — so there is nothing to run "everything" against.
		refuse("cli.no_harness", "Every session runs in a harness, and none is selected.", `harness switch <name>, or harness run ${provider.id} --<name>; harness new "<name>" makes one.`);
	}

	// Step 5: the grants covering this harness for this person.
	const grants = composed.policy.grants.filter((grant) => covers(grant.scope, composed.chain, harness?.id ?? null));

	// Step 6: the model. D8's precedence, then D23's override, then C19.
	const routing = composed.policy.routing;
	const approved = new Set([
		...(harness ? (routing.approvedFor.harnesses[harness.id] ?? []) : []),
		...(routing.approvedFor.providers[provider.id] ?? []),
		...teams.flatMap((team) => routing.approvedFor.teams[team] ?? []),
	]);
	if (approved.size === 0) refuse("preflight.model_none_approved", `No model provider is approved for ${here}.`, "Ask an organisation admin to approve one.", PROVIDERS);
	const defaultId =
		(harness ? routing.defaultFor.harnesses[harness.id] : undefined) ??
		routing.defaultFor.providers[provider.id] ??
		[...teams].reverse().map((team) => routing.defaultFor.teams[team]).find((one) => one !== undefined);
	if (defaultId === undefined) {
		const scopes = [harness?.name, provider.id, here].filter((one) => one !== undefined).join("/");
		refuse("preflight.model_no_default", `No model provider is the default for ${scopes}.`, "Ask an organisation admin to set one.", PROVIDERS);
	}
	if (!approved.has(defaultId)) {
		refuse("preflight.model_default_not_approved", `${defaultId} is the default here but is not approved for ${here}.`, "Ask an organisation admin to approve it, or to change the default.", PROVIDERS);
	}
	const cut = argv.model === undefined ? -1 : argv.model.indexOf("/");
	const chosenId = argv.model === undefined ? defaultId : cut === -1 ? argv.model : argv.model.slice(0, cut);
	if (argv.model !== undefined && !approved.has(chosenId)) {
		refuse("preflight.model_not_approved", `${chosenId} is not approved for ${here}. Approved: ${[...approved].join(", ")}.`, `--model ${[...approved][0]}/<id>`, PROVIDERS);
	}
	const mp = composed.policy.modelProviders[chosenId];
	// 01 validates every reference in routing, so a miss here is a bug, not a Blocker.
	if (mp === undefined) throw new Error(`routing names the model provider ${chosenId}, which the composition does not hold`);
	const exposes = Object.keys(mp.endpoints);
	const wireFormat = provider.speaks.find((format) => mp.endpoints[format] !== undefined);
	if (wireFormat === undefined) {
		refuse(
			"preflight.format_mismatch",
			`${provider.id} speaks ${provider.speaks.join(", ")}, but ${mp.id} exposes ${exposes.join(", ") || "no wire format at all"}.`,
			`Route ${harness?.name ?? "this session"} through a provider exposing ${provider.speaks.join(" or ")}, or run a runtime that speaks ${exposes.join(" or ") || "one of them"}.`,
			PROVIDERS,
		);
	}
	const model = (argv.model !== undefined && cut !== -1 ? argv.model.slice(cut + 1) : mp.models[0]) ?? "";
	if (!mp.models.includes(model)) refuse("preflight.model_unknown", `${mp.id} lists no model called \`${model}\`.`, `Choose one of: ${mp.models.join(", ") || "none"}.`, PROVIDERS);

	// D9's last row, D11: no covering grant supplies the model credential, so the
	// session runs on the person's own sign-in rather than refusing.
	// `preflight.ts` completes the flag with the adapter's `model_native` support
	// and its `modelNative` list.
	//
	// W7-D2 retires the old *gateway mode is never native* clause here: a model
	// provider with no `credential` at all used to mean an organisation gateway,
	// and W6-D6 retired that — a row nobody holds a key for is no longer usable
	// as one. So *no key reaches me* is the whole rule, whether that is because
	// the provider names no alias or because nothing granted to me holds it, and
	// it is the same rule the broker reads (`broker.needs_key`, 04 §5.3 step 5).
	const alias = mp.credential?.alias;
	const native =
		alias === undefined ||
		!grants.some((grant) => {
			const group = grant.group === undefined ? undefined : composed.policy.groups[grant.group];
			if (group === undefined || (grant.narrowedFrom !== undefined && !grant.narrowedFrom.aliases.includes(alias))) return false;
			return group.entries.some((entry) => entry.alias === alias);
		});

	// Step 7: the view. `--team` is per run and is never written to the selection.
	const view = argv.team === true || selection?.version === "team" ? "team" : "mine";
	const model_ = { provider: mp, model, wireFormat, endpoint: mp.endpoints[wireFormat] as string };
	// D132: nothing here derives reach. It is `policy/reach.json`, composed, and
	// the harness's own last step is taken by the `network` enforcer (D131).
	return { provider, harness, view, model: model_, grants, native };
}
