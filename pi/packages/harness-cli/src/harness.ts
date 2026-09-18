import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { api } from "./api.js";
import { type Credentials, harnessHome, type Manifest, readCredentials } from "./core.js";
import { type Icon, renderIcon } from "./pixels.js";
import { accent, bold, colorMode, dim } from "./style.js";

export interface HarnessRow {
	id: string;
	name: string;
	description: string;
	icon: Icon;
	org_unit_path: string;
	assigned_assets?: number;
}

export interface Selection {
	harness_id: string;
	name: string;
}

/**
 * The selection lives beside the git directory, not inside `assets/`, which
 * is the part of HARNESS_HOME the agent can write. Which harness you are in
 * is the user's choice, so the agent must not be able to change it.
 */
export function selectionPath(): string {
	return join(harnessHome(), "harness.json");
}

export async function readSelection(): Promise<Selection | undefined> {
	try {
		const selection = JSON.parse(await readFile(selectionPath(), "utf8")) as Selection;
		return selection.harness_id ? selection : undefined;
	} catch {
		return undefined;
	}
}

export async function writeSelection(selection: Selection | undefined): Promise<void> {
	if (!selection) {
		await rm(selectionPath(), { force: true });
		return;
	}
	await mkdir(harnessHome(), { recursive: true, mode: 0o700 });
	await writeFile(selectionPath(), `${JSON.stringify(selection, null, 2)}\n`, { mode: 0o600 });
}

/**
 * The manifest for the selected harness.
 *
 * A selection the server no longer recognises is cleared and reported, never
 * quietly downgraded to the shared set: the caller asked for one working
 * context and would otherwise get a different one without being told.
 */
export async function resolveForSession(credentials: Credentials): Promise<Manifest> {
	const selection = await readSelection();
	if (!selection) return api<Manifest>(credentials, "/v1/resolve");
	try {
		return await api<Manifest>(credentials, `/v1/resolve?harness_id=${encodeURIComponent(selection.harness_id)}`);
	} catch (error) {
		if ((error as { code?: string }).code !== "harness_not_found") throw error;
		await writeSelection(undefined);
		throw new Error(
			`Your harness "${selection.name}" no longer exists, or is no longer shared with you. ` +
				"Run `harness switch` to pick another.",
		);
	}
}

function wrap(text: string, width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (line && line.length + 1 + word.length > width) {
			lines.push(line);
			line = "";
		}
		line = line ? `${line} ${word}` : word;
	}
	if (line) lines.push(line);
	return lines;
}

/** The drawing on the left, what it is on the right. */
export function harnessCard(harness: HarnessRow): string[] {
	const drawing = renderIcon(harness.icon, colorMode());
	const width = Math.max(40, (stdout.columns ?? 80) - 26);
	const text = [bold(accent(harness.name)), dim(harness.org_unit_path), "", ...wrap(harness.description, width)];
	const height = Math.max(drawing.length, text.length);
	const blank = " ".repeat(harness.icon.rows[0]?.length ?? 16);
	const lines: string[] = [];
	for (let index = 0; index < height; index++) {
		lines.push(`  ${drawing[index] ?? blank}  ${text[index] ?? ""}`.trimEnd());
	}
	return lines;
}

async function ask(question: string): Promise<string> {
	const rl = createInterface({ input: stdin, output: stdout });
	try {
		return await rl.question(question);
	} finally {
		rl.close();
	}
}

const label = (harness: HarnessRow) => `${harness.org_unit_path}/${harness.name}`;

/**
 * Pick the harness the next session runs in.
 *
 * Names do not shadow between org units, so two teams may both have a
 * "Support". When a name is ambiguous the choice is handed back rather than
 * guessed at — the same rule `push` follows on a conflict.
 */
export async function switchHarness(args: string[]): Promise<number> {
	if (args.includes("--none")) {
		await writeSelection(undefined);
		console.log("Cleared. Sessions will load everything you have.");
		return 0;
	}
	const credentials = await readCredentials();
	const me = await api<{ org_unit_id?: string }>(credentials, "/v1/me");
	if (!me.org_unit_id) throw new Error("Your account does not have a user workspace.");
	const harnesses = await api<HarnessRow[]>(
		credentials,
		`/v1/org-units/${encodeURIComponent(me.org_unit_id)}/harnesses`,
	);
	if (harnesses.length === 0) {
		console.error("You have no harnesses yet. Create one in the web console.");
		return 1;
	}

	const wanted = args.find((arg) => !arg.startsWith("-"));
	let chosen: HarnessRow | undefined;
	if (wanted) {
		const needle = wanted.toLowerCase();
		const matches = harnesses.filter(
			(harness) => harness.name.toLowerCase() === needle || label(harness).toLowerCase() === needle,
		);
		if (matches.length === 0) {
			console.error(`No harness called "${wanted}". You have:`);
			for (const harness of harnesses) console.error(`  ${label(harness)}`);
			return 1;
		}
		if (matches.length > 1) {
			console.error(`"${wanted}" is the name of more than one harness. Pick one:`);
			for (const harness of matches) console.error(`  harness switch ${label(harness)}`);
			return 1;
		}
		chosen = matches[0];
	} else if (stdin.isTTY) {
		harnesses.forEach((harness, index) => {
			console.log(`  ${String(index + 1).padStart(2)}. ${harness.name}  ${dim(harness.org_unit_path)}`);
		});
		const answer = await ask("Which harness? ");
		chosen = harnesses[Number.parseInt(answer.trim(), 10) - 1];
		if (!chosen) {
			console.error("That is not one of the numbers listed.");
			return 1;
		}
	} else {
		console.error("Name a harness. You have:");
		for (const harness of harnesses) console.error(`  ${label(harness)}`);
		return 1;
	}

	await writeSelection({ harness_id: chosen.id, name: chosen.name });
	console.log(harnessCard(chosen).join("\n"));
	console.log(`\n  ${dim("`harness run` to start.")}`);
	return 0;
}
