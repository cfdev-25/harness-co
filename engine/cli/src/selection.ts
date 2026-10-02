import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** `$HARNESS_HOME/harness.json` (00 D28, D111 — the only file with this name). */
export interface Selection {
	harness_id?: string;
	name?: string;
	version?: "mine" | "team";
}

export function harnessHome(): string {
	return process.env.HARNESS_HOME ?? join(homedir(), ".harness");
}

/**
 * S7: outside the agent-writable tree. Which harness you are in is the
 * person's choice, so the agent must not be able to change it.
 */
export function selectionPath(): string {
	return join(harnessHome(), "harness.json");
}

export async function readSelection(): Promise<Selection | undefined> {
	try {
		const selection = JSON.parse(await readFile(selectionPath(), "utf8")) as Selection;
		return selection.harness_id === undefined ? undefined : selection;
	} catch {
		return undefined;
	}
}

export async function writeSelection(selection: Selection | undefined): Promise<void> {
	if (selection === undefined) {
		await rm(selectionPath(), { force: true });
		return;
	}
	await mkdir(harnessHome(), { recursive: true, mode: 0o700 });
	await writeFile(selectionPath(), `${JSON.stringify(selection, null, 2)}\n`, { mode: 0o600 });
}

export const assetsRoot = (): string => join(harnessHome(), "assets");
export const assetsGitDir = (): string => join(harnessHome(), "assets.git");
export const sessionsDir = (): string => join(harnessHome(), "sessions");
