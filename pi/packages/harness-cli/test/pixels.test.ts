import { describe, expect, it } from "vitest";
import { type Icon, renderIcon } from "../src/pixels.js";

const SIZE = 16;
const strip = (line: string) => line.replace(/\[[0-9;]*m/g, "");

function icon(palette: string[], rows: string[]): Icon {
	return { palette, rows: rows.map((row) => row.padEnd(SIZE, ".")) };
}

const blank = icon([], Array<string>(SIZE).fill(""));

describe("renderIcon", () => {
	it("packs two pixel rows into one terminal line", () => {
		for (const mode of ["truecolor", "256", "mono"] as const) {
			const lines = renderIcon(icon(["#c8875a"], Array<string>(SIZE).fill("0".repeat(SIZE))), mode);
			expect(lines).toHaveLength(SIZE / 2);
			for (const line of lines) expect(strip(line)).toHaveLength(SIZE);
		}
	});

	it("draws nothing where a drawing is transparent", () => {
		const lines = renderIcon(blank, "mono");
		expect(lines).toEqual(Array<string>(SIZE / 2).fill(" ".repeat(SIZE)));
	});

	it("uses one glyph per stacked pair", () => {
		// Row 0 painted, row 1 clear, rows 2 and 3 both painted.
		const drawing = icon(["#c8875a"], ["0", "", "0", "0"]);
		const [first, second] = renderIcon(drawing, "mono");
		expect(first[0]).toBe("▀"); // upper half only
		expect(second[0]).toBe("█"); // a full cell, one colour
		const lower = renderIcon(icon(["#c8875a"], ["", "0"]), "mono");
		expect(lower[0][0]).toBe("▄"); // lower half only
	});

	it("puts two different colours in one cell as foreground and background", () => {
		const line = renderIcon(icon(["#ff0000", "#00ff00"], ["0", "1"]), "truecolor")[0];
		expect(line).toContain("38;2;255;0;0");
		expect(line).toContain("48;2;0;255;0");
		expect(strip(line)[0]).toBe("▀");
	});

	it("speaks the colour dialect the terminal understands", () => {
		const drawing = icon(["#c8875a"], ["0"]);
		const [truecolor] = renderIcon(drawing, "truecolor");
		const [indexed] = renderIcon(drawing, "256");
		expect(truecolor).toContain("38;2;200;135;90");
		expect(indexed).toContain("38;5;");
		expect(indexed).not.toContain("38;2;");
	});

	it("keeps the shape and drops every escape when colour is off", () => {
		for (const line of renderIcon(icon(["#c8875a"], ["0.0"]), "mono")) {
			expect(line).not.toContain("");
		}
	});

	it("closes every coloured line, so it can sit beside other text", () => {
		for (const line of renderIcon(icon(["#c8875a"], ["0"]), "truecolor")) {
			expect(line.endsWith("[0m")).toBe(true);
		}
	});
});
