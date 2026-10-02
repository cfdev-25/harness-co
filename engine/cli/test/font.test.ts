import { describe, expect, it } from "vitest";
import { pixelText, rasterize, textWidth, wrapName } from "../src/font.js";

const ESC = "";

describe("the pixel font", () => {
	it("draws every character seven rows tall and five wide, plus the gap", () => {
		for (const text of ["ABCDEFGHIJKLM", "NOPQRSTUVWXYZ", "0123456789-_. ?"]) {
			const rows = rasterize(text);
			expect(rows).toHaveLength(7);
			for (const row of rows) expect(row).toHaveLength(textWidth(text));
		}
	});

	it("draws lowercase as capitals and the unknown as a question mark", () => {
		expect(rasterize("a")).toEqual(rasterize("A"));
		expect(rasterize("é")).toEqual(rasterize("?"));
	});

	it("wraps a slug at its hyphens, keeps the hyphen, and cuts past the last line", () => {
		expect(wrapName("test-harness-1", 10 * 6, 3)).toEqual(["test-", "harness-1"]);
		expect(wrapName("test-harness-1", 20 * 6, 3)).toEqual(["test-harness-1"]);
		expect(wrapName("abcdefghij", 4 * 6, 3)).toEqual(["abcd", "efgh", "ij"]);
		expect(wrapName("one-two-three-four", 4 * 6, 2)).toEqual(["one-", "two-"]);
	});

	it("renders two pixel rows per line, four lines per name line, bare in mono", () => {
		const lines = pixelText(["I"], "mono", (text) => `<${text}>`);
		expect(lines).toHaveLength(4);
		expect(lines[0]).toBe("▀▀█▀▀"); // rows 0 and 1: the bar, then the stem
		expect(lines[1]).toBe("  █"); // rows 2 and 3: stem over stem
		for (const line of lines) expect(line).not.toContain("<");
		expect(pixelText(["I"], "truecolor", (text) => `<${text}>`)[0]).toBe(`<▀▀█▀▀>${ESC}[0m`);
	});
});
