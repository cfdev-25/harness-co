import { describe, expect, it } from "vitest";
import { type Icon, iconCells, renderIcon } from "../src/pixels.js";

const SIZE = 16;
const ESC = "";
const strip = (line: string) => line.replace(/\[[0-9;]*m/g, "");

function icon(palette: string[], rows: string[]): Icon {
	return { palette, rows: rows.map((row) => row.padEnd(SIZE, ".")) };
}

describe("renderIcon", () => {
	it("packs two pixel rows into one line, one cell per column", () => {
		for (const mode of ["truecolor", "256", "mono"] as const) {
			const lines = renderIcon(icon(["#c8875a"], Array<string>(SIZE).fill("0".repeat(SIZE))), mode);
			expect(lines).toHaveLength(SIZE / 2);
			for (const line of lines) expect(strip(line)).toHaveLength(SIZE);
		}
		expect(iconCells(icon([], []))).toBe(0);
		expect(iconCells(icon(["#000"], ["0"]))).toBe(SIZE);
	});

	it("draws nothing where a drawing is transparent", () => {
		const blank = icon([], Array<string>(SIZE).fill(""));
		expect(renderIcon(blank, "mono")).toEqual(Array<string>(SIZE / 2).fill(""));
		expect(renderIcon(blank, "truecolor")).toEqual(Array<string>(SIZE / 2).fill(""));
	});

	it("uses one glyph per stacked pair", () => {
		// Row 0 painted, row 1 clear, rows 2 and 3 both painted.
		const [first, second] = renderIcon(icon(["#c8875a"], ["0", "", "0", "0"]), "mono");
		expect(first[0]).toBe("▀"); // upper half only
		expect(second[0]).toBe("█"); // both, one colour
		expect(renderIcon(icon(["#c8875a"], ["", "0"]), "mono")[0][0]).toBe("▄"); // lower half only
	});

	it("draws a same-colour pair as a full block in the foreground alone, and two colours as glyph over background", () => {
		const same = renderIcon(icon(["#ff0000"], ["0", "0"]), "truecolor")[0];
		expect(same).toContain("38;2;255;0;0");
		expect(same).not.toContain("48;");
		expect(strip(same)[0]).toBe("█");
		const two = renderIcon(icon(["#ff0000", "#00ff00"], ["0", "1"]), "truecolor")[0];
		expect(two).toContain("38;2;255;0;0");
		expect(two).toContain("48;2;0;255;0");
	});

	it("speaks the colour dialect the terminal understands", () => {
		const drawing = icon(["#c8875a"], ["0"]);
		expect(renderIcon(drawing, "truecolor")[0]).toContain("38;2;200;135;90");
		expect(renderIcon(drawing, "256")[0]).toContain("38;5;");
		expect(renderIcon(drawing, "256")[0]).not.toContain("38;2;");
	});

	it("keeps the shape and drops every escape when colour is off", () => {
		const [line] = renderIcon(icon(["#c8875a"], ["0.0"]), "mono");
		expect(line).not.toContain(ESC);
		expect(line).toBe("▀ ▀");
	});

	it("closes every painted cell, so a line can sit beside other text", () => {
		const [line] = renderIcon(icon(["#c8875a"], ["00"]), "truecolor");
		expect(line.endsWith(`${ESC}[0m`)).toBe(true);
		expect(line.split(`${ESC}[0m`)).toHaveLength(3);
	});
});
