import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { refuse } from "./output.js";

export interface Credentials {
	api_url: string;
	token: string;
}

/**
 * Outside `HARNESS_HOME`: `HARNESS_HOME/assets` is writable from inside the
 * jail, and the whole point of the deny-read set is that the agent cannot
 * reach this file (C27; 06 names it explicitly because `HOME` is real).
 */
export function credentialsPath(): string {
	return process.env.HARNESS_CREDENTIALS ?? join(homedir(), ".config", "harness", "credentials.json");
}

export async function writeCredentials(credentials: Credentials): Promise<void> {
	const path = credentialsPath();
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
	await chmod(path, 0o600);
}

/** D110: the pre-assets-layout migration is deleted. No file is a `Blocker`. */
export async function readCredentials(): Promise<Credentials> {
	try {
		return JSON.parse(await readFile(credentialsPath(), "utf8")) as Credentials;
	} catch {
		refuse("cli.not_logged_in", "You are not logged in.", "`harness login`");
	}
}
