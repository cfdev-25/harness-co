import type { ColorMode } from "./style.js";

export interface Icon {
	/** Up to 16 `#rrggbb` colours. A row's characters index this. */
	palette: string[];
	/** One character per pixel: a hex digit into the palette, or `.` for clear. */
	rows: string[];
}

// Two pixels per cell, stacked: a 16×16 drawing is eight lines of sixteen
// columns, which reads as square in a terminal and as small as a drawing
// should be beside a prompt. A cell whose two pixels share a colour is a full
// block in that colour; two colours are the upper as the glyph over the lower
// as background; one clear pixel is the lit half over the terminal's own
// background, which is what clear means.
const UPPER = "▀";
const LOWER = "▄";
const FULL = "█";
const ESC = "";
const RESET = `${ESC}[0m`;

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

/** Cells wide a drawing renders: one per pixel column. */
export const iconCells = (icon: Icon): number => Math.max(0, ...icon.rows.map((row) => row.length));

/**
 * A drawing as terminal lines: half as many lines as rows, one cell per
 * pixel column. Every cell restates its own colours and every line ends
 * reset, so a line can sit beside other text in a header without a
 * neighbouring cell's colour bleeding across it. `mono` keeps the shape in
 * bare glyphs.
 */
export function renderIcon(icon: Icon, mode: ColorMode): string[] {
	const lines: string[] = [];
	for (let y = 0; y < icon.rows.length; y += 2) {
		const top = icon.rows[y] ?? "";
		const bottom = icon.rows[y + 1] ?? "";
		let line = "";
		for (let x = 0; x < Math.max(top.length, bottom.length); x++) {
			const above = colorAt(icon, top, x);
			const below = colorAt(icon, bottom, x);
			if (mode === "mono") {
				line += above && below ? FULL : above ? UPPER : below ? LOWER : " ";
			} else if (!above && !below) {
				line += " ";
			} else if (above && below && above === below) {
				// One colour: a full block in the foreground alone, which every
				// terminal and TUI draws the same way.
				line += `${ESC}[0;${paint(above, mode, false)}m${FULL}${RESET}`;
			} else if (above && below) {
				// Two colours in one cell: the upper as the glyph, the lower as its background.
				line += `${ESC}[0;${paint(above, mode, false)};${paint(below, mode, true)}m${UPPER}${RESET}`;
			} else {
				const only = above ?? (below as string);
				line += `${ESC}[0;${paint(only, mode, false)}m${above ? UPPER : LOWER}${RESET}`;
			}
		}
		lines.push(line.trimEnd());
	}
	return lines;
}
