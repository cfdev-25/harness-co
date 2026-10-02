import type { Composed, HarnessProvider } from "@harness/compose/contracts";
import { api } from "../api.js";
import type { Credentials } from "../credentials.js";
import { refuse, say, table } from "../output.js";

/** The three verbs, in the words `policy/harness-providers.json` stores. */
const APPROVAL = { approve: "approved", beta: "beta", decline: "not-approved" } as const;
export type ProviderVerb = keyof typeof APPROVAL;

const teamsOf = (scope: HarnessProvider["scope"]) => (scope.teams === "all" ? "every team" : scope.teams.join(", "));
const pinOf = (pin: HarnessProvider["pin"]) => ("repo" in pin ? `${pin.repo}@${pin.commit.slice(0, 7)}` : `${pin.binary} ≥ ${pin.minVersion}`);

/**
 * §11.20 (D117). The Providers screen from the terminal. Bare: the composed
 * catalogue, with no I/O of its own. A verb: the one write the console makes,
 * `PUT /v1/providers/harness/{id}`, which the server refuses to anyone who is
 * not an organisation admin — in its own sentence.
 */
export async function providers(credentials: Credentials, composed: Composed, verb: ProviderVerb | undefined, id: string | undefined, reason: string | undefined, teams: string | undefined): Promise<number> {
	const rows = Object.values(composed.policy.harnessProviders);
	if (verb === undefined) {
		for (const line of table(rows.map((one) => [one.id, one.approval, teamsOf(one.scope), pinOf(one.pin), one.reason ?? ""]))) say(line);
		return 0;
	}
	const current = rows.find((one) => one.id === id);
	if (current === undefined) {
		refuse("cli.provider_unknown", `"${id}" is not a runtime your organisation has listed. You have: ${rows.map((one) => one.id).join(", ") || "none"}.`, `harness providers ${verb} ${rows[0]?.id ?? "<runtime>"}`);
	}
	// The console asks for a reason too: a runtime turned off without one is a
	// row nobody can explain a week later.
	if (verb === "decline" && reason === undefined) {
		refuse("cli.reason_required", "Declining a runtime needs a reason: everyone who tries to run it is shown it.", `harness providers decline ${current.id} --reason "…"`);
	}
	const approval = APPROVAL[verb];
	const scope = { teams: teams === undefined ? ("all" as const) : teams.split(",").map((one) => one.trim()) };
	// `pin` and `speaks` are the row's own: this verb moves the approval and the
	// scope, and the server writes the whole row back.
	const result = await api<{ commit: string }>(credentials, `/v1/providers/harness/${encodeURIComponent(current.id)}`, {
		method: "PUT",
		body: JSON.stringify({ approval, reason, scope, pin: current.pin, speaks: current.speaks }),
	});
	say(`${current.id} ${approval} for ${teamsOf(scope)} · commit ${result.commit.slice(0, 7)}`);
	return 0;
}
