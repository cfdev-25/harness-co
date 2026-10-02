import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import type { Composed } from "@harness/compose/contracts";
import { api } from "../api.js";
import type { Credentials } from "../credentials.js";
import { refuse, say } from "../output.js";

/**
 * The key is prompted, never a flag or an argument: a key on the command line
 * lands in shell history and in `ps`. On a terminal `readline` does the echoing,
 * so a `Writable` that swallows its input is the whole of "echo off"; a pipe
 * echoes nothing to begin with and one line of it is the key.
 */
function promptForKey(): Promise<string> {
	const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
	const terminal = stdin.isTTY === true;
	if (terminal) stdout.write("Paste the key (it is not echoed): ");
	const rl = createInterface({ input: stdin, output: muted, terminal });
	return rl.question("").finally(() => {
		rl.close();
		if (terminal) stdout.write("\n");
	});
}

/**
 * §11.21 (D117). The model tab's *Set up* verb: one call, one commit, and the
 * words it prints are true on a personal account and an enterprise one alike.
 * Nothing here ever puts the key in a line of output, a URL or an error.
 *
 * The providers it accepts are `policy/model-providers.json` on the composed
 * chain — the presets seeded at sign-up and anything added since; the CLI holds
 * no list of its own.
 */
export async function keysAdd(credentials: Credentials, composed: Composed, provider: string, model?: string, ask: () => Promise<string> = promptForKey): Promise<number> {
	const rows = Object.keys(composed.policy.modelProviders);
	if (!rows.includes(provider)) {
		refuse("cli.provider_unknown", `"${provider}" is not a model provider your organisation has listed. You have: ${rows.join(", ") || "none"}.`, `harness keys add ${rows[0] ?? "<provider>"}`);
	}
	const key = (await ask()).trim();
	if (key === "") refuse("cli.key_required", "No key was given, so nothing was stored.", `harness keys add ${provider}`);
	const result = await api<{ commit: string; default?: boolean }>(credentials, `/v1/providers/model/${encodeURIComponent(provider)}/setup`, {
		method: "POST",
		body: JSON.stringify({ key, model }),
	});
	const isDefault = result.default !== false;
	say(`${provider} · key stored in the bundled vault${isDefault ? " · default for the organisation" : ""} · commit ${result.commit.slice(0, 7)}`);
	return 0;
}
