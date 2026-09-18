import type { ColorMode } from "./style.js";

export interface Icon {
	/** Up to 16 `#rrggbb` colours. A row's characters index this. */
	palette: string[];
	/** One character per pixel: a hex digit into the palette, or `.` for clear. */
	rows: string[];
}

// Two pixels per cell, stacked. A 16x16 drawing is then 8 lines of 16
// columns, which reads as roughly square in a terminal.
const UPPER = "▀";
const LOWER = "▄";
const FULL = "█";
const RESET = "[0m";

function channels(hex: string): [number, number, number] {
	return [
		Number.parseInt(hex.slice(1, 3), 16),
		Number.parseInt(hex.slice(3, 5), 16),
		Number.parseInt(hex.slice(5, 7), 16),
	];
}

/** The nearest colour in the 6x6x6 cube of the 256-colour palette. */
function cube([red, green, blue]: [number, number, number]): number {
	const step = (value: number) => Math.round((value / 255) * 5);
	return 16 + 36 * step(red) + 6 * step(green) + step(blue);
}

function paint(hex: string, mode: ColorMode, background: boolean): string {
	const layer = background ? 48 : 38;
	const parts = channels(hex);
	return mode === "truecolor" ? `${layer};2;${parts.join(";")}` : `${layer};5;${cube(parts)}`;
}

function colorAt(icon: Icon, row: string, column: number): string | undefined {
	const index = Number.parseInt(row[column] ?? ".", 16);
	return Number.isNaN(index) ? undefined : icon.palette[index];
}

/**
 * A drawing as terminal lines: half as many lines as rows, full width.
 *
 * Every cell restates its own colours and every line ends reset, so a line
 * can sit beside other text in a header without a neighbouring cell's
 * background bleeding across it.
 */
export function renderIcon(icon: Icon, mode: ColorMode): string[] {
	const lines: string[] = [];
	for (let y = 0; y < icon.rows.length; y += 2) {
		const top = icon.rows[y] ?? "";
		const bottom = icon.rows[y + 1] ?? "";
		let line = "";
		for (let x = 0; x < top.length; x++) {
			const above = colorAt(icon, top, x);
			const below = colorAt(icon, bottom, x);
			if (mode === "mono") {
				line += above && below ? FULL : above ? UPPER : below ? LOWER : " ";
			} else if (!above && !below) {
				line += `${RESET} `;
			} else if (above && below && above !== below) {
				line += `[0;${paint(above, mode, false)};${paint(below, mode, true)}m${UPPER}`;
			} else {
				const only = above ?? (below as string);
				const glyph = above && below ? FULL : above ? UPPER : LOWER;
				line += `[0;${paint(only, mode, false)}m${glyph}`;
			}
		}
		lines.push(mode === "mono" ? line : line + RESET);
	}
	return lines;
}
