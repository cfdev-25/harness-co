import type { Blocker } from "@harness/compose/contracts";
import { bad, dim } from "./style.js";

/** A thrown value is a `Blocker` when it carries all three words (10 rule 12). */
export function isBlocker(thrown: unknown): thrown is Blocker {
	const one = thrown as Blocker | null;
	return typeof one === "object" && one !== null && typeof one.code === "string" && typeof one.message === "string" && typeof one.remedy === "string";
}

/** An `api` error envelope with a code and a sentence but no remedy (03 §7.4 makes `remedy` optional). */
export function isRefusal(thrown: unknown): thrown is { code: string; message: string } {
	const one = thrown as { code?: unknown; message?: unknown } | null;
	return typeof one === "object" && one !== null && typeof one.code === "string" && typeof one.message === "string";
}

/** §13's rows, thrown. One code, one sentence, one remedy. */
export function refuse(code: string, message: string, remedy: string, link?: string): never {
	throw (link === undefined ? { code, message, remedy } : { code, message, remedy, link }) satisfies Blocker;
}

/** §12 rule 1: plain words, one line per event, present tense. */
export function say(line: string): void {
	console.log(line);
}

/** §12 rule 2: the message, the remedy, the link. Colour only on a TTY. */
export function blocker(one: Blocker): void {
	console.error(bad(one.message));
	console.error(`${dim("→")} ${one.remedy}`);
	if (one.link !== undefined) console.error(dim(one.link));
}

/** Left-aligned columns, sized to the widest cell. Used by `status` and the sheet. */
export function table(rows: string[][]): string[] {
	const widths: number[] = [];
	for (const row of rows) row.forEach((cell, at) => (widths[at] = Math.max(widths[at] ?? 0, cell.length)));
	// The last column is never padded, so a line has no trailing run of spaces.
	return rows.map((row) => row.map((cell, at) => (at === row.length - 1 ? cell : cell.padEnd(widths[at]))).join("  ").trimEnd());
}

/** §12 rule 6: a notice that repeats is said once. */
export function once(): (line: string) => void {
	const said = new Set<string>();
	return (line) => {
		if (said.has(line)) return;
		said.add(line);
		say(line);
	};
}
