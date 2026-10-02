import { covers } from "@harness/compose";
import type { Composed, Scope } from "@harness/compose/contracts";
import { registerScheme, unregisterScheme } from "../os/scheme.js";
import { shell, type Shell } from "../os/shell.js";
import { say } from "../output.js";
import { routedNodes } from "../preflight/choose.js";
import { bad, dim, good } from "../style.js";

const PROVIDERS = "/console/org/providers";
const MODELS = "/console/org/providers/model";
const teamsOf = (scope: Scope) => (scope.teams === "all" ? "every team" : scope.teams.join(", "));

/**
 * §11.22 (D117). The admin's first hour as a checklist, derived and never
 * stored: the same five facts the console's first-run notices read (console 04
 * §10, 05 §12). ✓ with the fact, or ✗ with the exact command that closes it and
 * the console route that does the same. Exit 0 when every line is ✓.
 */
export async function setup(composed: Composed, os: Shell = shell()): Promise<number> {
	const policy = composed.policy;
	const nodes = routedNodes(composed.chain);
	const here = nodes[nodes.length - 1] ?? "your organisation";
	const runtimes = Object.values(policy.harnessProviders);
	const models = Object.values(policy.modelProviders);
	const addKey = `harness keys add ${models[0]?.id ?? "openrouter"}`;
	const rows: Array<[boolean, string, string, string?]> = [];

	const approved = runtimes.find((one) => one.approval === "approved");
	rows.push([approved !== undefined, approved === undefined ? "No runtime is approved." : `${approved.id} is approved for ${teamsOf(approved.scope)}.`, PROVIDERS, `harness providers approve ${runtimes[0]?.id ?? "pi"}`]);

	// A key is a group entry the model provider's alias names: the credential
	// resolves through the same grants as any other alias (03 §5.4).
	const aliases = new Set(Object.values(policy.groups).flatMap((group) => group.entries.map((entry) => entry.alias)));
	const keyed = models.find((one) => one.credential !== undefined && aliases.has(one.credential.alias));
	rows.push([keyed !== undefined, keyed === undefined ? "No model provider has a key." : `${keyed.id} has a key in the bundled vault.`, MODELS, addKey]);

	// D30i: the nearest key wins, so the walk runs from this person's team upward.
	const at = [...nodes].reverse().find((node) => policy.routing.defaultFor.teams[node] !== undefined);
	rows.push([at !== undefined, at === undefined ? `No model provider is the default for ${here}.` : `${policy.routing.defaultFor.teams[at as string]} is the default for ${at}.`, MODELS, addKey]);

	// Personal has `my-keys` seeded and no team to grant it to, so this is not a
	// step it can close (§11.22: enterprise only).
	if (composed.chain.some((node) => node.kind === "team")) {
		const granted = policy.grants.find((grant) => grant.group !== undefined && covers(grant.scope, composed.chain, null));
		// Groups stay console-only until someone asks for them from the terminal
		// (D117), so this row's ✗ carries the route and no command.
		rows.push([granted !== undefined, granted === undefined ? `No security group reaches ${here}.` : `${granted.group} is granted to ${teamsOf(granted.scope)}.`, "/console/org/groups"]);
	}

	const held = composed.harnesses;
	rows.push([held.length > 0, held.length === 0 ? "You hold no harness." : `You hold ${held.map((one) => one.name).join(", ")}.`, "/console/me/harnesses", 'harness new "…"']);

	for (const [ok, fact, route, command] of rows) {
		say(ok ? `${good("✓")} ${fact}` : `${bad("✗")} ${fact}${command === undefined ? "" : `  ${dim("→")} ${command}`}  ${dim(route)}`);
	}
	// W5-D13. Not a checklist line: there is nothing for the person to do and
	// nothing to be ✗ about, so `setup` just does it and says it did. It is
	// idempotent, so running `setup` again is not a second registration.
	for (const line of await registerScheme(os)) say(`${good("✓")} ${line}`);
	return rows.every(([ok]) => ok) ? 0 : 1;
}

/** §11.22's `--unregister`: the link type off the machine, and nothing else.
    No login and no composition — a person removing it may have neither. */
export async function unregister(os: Shell = shell()): Promise<number> {
	for (const line of await unregisterScheme(os)) say(line);
	return 0;
}
