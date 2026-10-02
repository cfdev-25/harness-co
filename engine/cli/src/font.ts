import type { ColorMode } from "./style.js";

/**
 * A 5×7 pixel font for the harness's name on the boot screen (08 §11.1): the
 * name drawn as big as the drawing beside it, in the same idiom. Capitals
 * only — a pixel font reads best in one case, and a harness name is a slug.
 * Each glyph is seven rows of five columns, `#` lit.
 */
const GLYPHS: Record<string, string[]> = {
	A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
	B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
	C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
	D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
	E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
	F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
	G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".####"],
	H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
	I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
	J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
	K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
	L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
	M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
	N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
	O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
	P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
	Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
	R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
	S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
	T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
	U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
	V: ["#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
	W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
	X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
	Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
	Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
	"0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
	"1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
	"2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
	"3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
	"4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
	"5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
	"6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
	"7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
	"8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
	"9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
	"-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
	_: [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
	".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
	" ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
	"?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
};
const UNKNOWN = GLYPHS["?"] as string[];
const ROWS = 7;
const COLUMNS = 5;
/** One blank column between glyphs. */
const ADVANCE = COLUMNS + 1;
const ESC = "";

/** Pixel columns a word takes, including the gap after each glyph. */
export const textWidth = (text: string): number => text.length * ADVANCE;

/**
 * `text` as bitmap rows, each a string of `#`/`.`, `textWidth` wide.
 * Lowercase is drawn as capitals; anything the font lacks is `?`.
 */
export function rasterize(text: string): string[] {
	const rows = Array.from({ length: ROWS }, () => "");
	for (const char of text.toUpperCase()) {
		const glyph = GLYPHS[char] ?? UNKNOWN;
		for (let y = 0; y < ROWS; y++) rows[y] += `${glyph[y]}.`;
	}
	return rows;
}

/**
 * Break the name into lines no wider than `columns` pixels, at `-`, `_` and
 * spaces (the separator stays with the line it ends), or mid-word when one
 * word is wider than the room. Never more than `maxLines`: a name longer than
 * that is cut, because the frame is a fixed height and the console has the
 * full name.
 */
export function wrapName(name: string, columns: number, maxLines: number): string[] {
	const perLine = Math.max(1, Math.floor(columns / ADVANCE));
	const pieces = name.match(/[^-_ ]+[-_ ]?|[-_ ]/g) ?? [name];
	const lines: string[] = [];
	let line = "";
	for (const piece of pieces) {
		if (line.length + piece.length <= perLine) {
			line += piece;
			continue;
		}
		if (line !== "") lines.push(line);
		line = piece;
		while (line.length > perLine) {
			lines.push(line.slice(0, perLine));
			line = line.slice(perLine);
		}
	}
	if (line !== "") lines.push(line);
	return lines.slice(0, maxLines).map((one) => one.trimEnd());
}

/**
 * The name as terminal lines, two pixel rows per cell (`▀` `▄` `█`), so a
 * seven-row glyph is four lines tall. Half-blocks are right for text where
 * they were wrong for the drawing: gaps between glyph rows read as letter
 * shapes, not as a broken picture. `paint` colours a whole line; `mono`
 * leaves the glyphs bare.
 */
export function pixelText(lines: string[], mode: ColorMode, paint: (text: string) => string): string[] {
	const out: string[] = [];
	for (const line of lines) {
		const rows = rasterize(line);
		rows.push(".".repeat(rows[0]?.length ?? 0)); // eighth row, so the pairs divide evenly
		for (let y = 0; y < rows.length; y += 2) {
			const top = rows[y] as string;
			const bottom = rows[y + 1] as string;
			let drawn = "";
			for (let x = 0; x < top.length; x++) {
				const above = top[x] === "#";
				const below = bottom[x] === "#";
				drawn += above && below ? "█" : above ? "▀" : below ? "▄" : " ";
			}
			drawn = drawn.trimEnd();
			out.push(mode === "mono" || drawn === "" ? drawn : `${paint(drawn)}${ESC}[0m`);
		}
	}
	return out;
}
