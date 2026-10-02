import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { api } from "../api.js";
import type { Me } from "../boot.js";
import { writeCredentials } from "../credentials.js";
import { refuse, say } from "../output.js";
import { readSelection } from "../selection.js";

/** §11.14. Validates the PAT against `GET /v1/me`, then writes it 0600. */
export async function login(apiUrl: string | undefined, token: string | undefined): Promise<number> {
	let value = token;
	if (value === undefined) {
		const rl = createInterface({ input: stdin, output: stdout });
		value = await rl.question("Paste your access token from the web console: ").finally(() => rl.close());
	}
	const credentials = { api_url: apiUrl ?? "http://localhost:8400", token: value.trim() };
	// The remedy names one place, and that place prints this whole line —
	// origin, flags and a freshly minted token (console D105). Telling someone
	// the flag they already typed is not a remedy.
	if (credentials.token === "") refuse("cli.not_logged_in", "An access token is required.", "The console's How this works page prints this whole line under Set up.");
	try {
		await api<Me>(credentials, "/v1/me");
	} catch (thrown) {
		refuse("cli.not_logged_in", `That token was not accepted by ${credentials.api_url}: ${(thrown as Error).message}`, "Generate another under How this works → Set up in the console; a token is shown once, so a copied one can be the wrong half of a line.");
	}
	await writeCredentials(credentials);
	say("Logged in. `harness run` to start a session, or `harness commands` to see everything.");
	return 0;
}

/** §11.16. One `GET /v1/me`. */
export async function whoami(me: Me, apiUrl: string): Promise<number> {
	const chain = me.chain.map((node) => node.path.split(".").pop() ?? node.path);
	say([...chain.slice(0, -1), me.user.email ?? chain[chain.length - 1]].join(" › "));
	const selection = await readSelection();
	say(`role         ${me.role.level}${me.role.at === null ? "" : ` at ${me.role.at}`}`);
	say(`harness      ${selection?.name ?? "none — everything you have is loaded"}${selection?.version === "team" ? " (team version)" : ""}`);
	say(`api          ${apiUrl}`);
	return 0;
}
