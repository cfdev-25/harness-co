import { type Landing, landingLines, plainLanding, startRule } from "./landing.js";
import { type ColorMode, accent, bad, bold, dim, good } from "./style.js";

/**
 * 08 §10.0 and §11.1 — the two frames a session has a face in: the **boot
 * screen** after preflight and before the provider spawns, and the **exit
 * review**. Both open with the landing (`landing.ts`), which is also what a
 * runtime whose landing is ours draws as its header (W5-D12, 07 §6).
 *
 * Nothing here reads `process`: the caller says how wide the terminal is and
 * what it can draw, so a test renders the same frame deterministically and a
 * capture under `script` renders it in colour.
 */
export interface Frame extends Landing {
	width: number;
	/** What the terminal can draw. `mono` also means "no colour" (`style.ts`). */
	mode: ColorMode;
	/** A pipe gets the same facts as plain lines and no drawing (08 §12). */
	tty: boolean;
}

/** One row of the exit table: the key, and what happened to it. */
export interface ExitRow {
	key: string;
	/** `+12 −3`, *made this session*, *removed this session*. */
	note: string;
}

const GUTTER = "  ";

const header = (frame: Frame): string[] => (frame.tty ? landingLines(frame, frame.width, frame.mode) : plainLanding(frame));

/**
 * 08 §11.1. Shown once preflight has passed and before the child is spawned,
 * for a runtime that draws its own start-up (Claude Code). The last line is a
 * rule across the terminal naming the provider: ours ends there, and
 * everything below it is the provider's, which we do not cut into. A runtime
 * whose landing is ours (Pi) gets only the rule — the landing is its header.
 */
export function bootScreen(frame: Frame, starting: string, landing: "ours" | "theirs" = "theirs"): string[] {
	if (!frame.tty) return [...(landing === "theirs" ? header(frame) : []), `Starting ${starting}…`];
	const rule = startRule(starting, frame.width, frame.mode);
	return landing === "theirs" ? [...header(frame), "", rule] : [rule];
}

/**
 * 08 §10.0. `<harness> changes`, then every change on its own line, by kind:
 * the kind in grey, the name, and what happened — `+n` in green, `−m` in
 * red, *new* in green, *removed* in red. No landing here: the person has
 * just left the session and knows where they were. The choice beneath is
 * the menu's (`prompt.ts`), not a line.
 */
export function exitScreen(harness: string, rows: { changed: ExitRow[]; made: ExitRow[]; removed: ExitRow[] }): string[] {
	const all = [
		...rows.changed.map((row) => ({ key: row.key, what: counts(row.note) })),
		...rows.made.map((row) => ({ key: row.key, what: good("new") })),
		...rows.removed.map((row) => ({ key: row.key, what: bad("removed") })),
	]
		.map((row) => {
			const slash = row.key.indexOf("/");
			return { kind: slash === -1 ? "" : row.key.slice(0, slash), name: slash === -1 ? row.key : row.key.slice(slash + 1), what: row.what };
		})
		.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
	const kindWidth = Math.max(0, ...all.map((row) => row.kind.length));
	const nameWidth = Math.max(0, ...all.map((row) => row.name.length));
	return [
		`${GUTTER}${bold(accent(`${harness} changes`))}`,
		"",
		...all.map((row) => `${GUTTER}${dim(row.kind.padEnd(kindWidth))}  ${row.name.padEnd(nameWidth)}  ${row.what}`.trimEnd()),
		"",
	];
}

/** `+12 −3` with the additions green and the removals red; anything else as it came. */
function counts(note: string): string {
	const match = /^\+(\d+) −(\d+)$/.exec(note);
	return match ? `${good(`+${match[1]}`)} ${bad(`−${match[2]}`)}` : note;
}

export { modelBrief, reachBrief } from "./landing.js";
