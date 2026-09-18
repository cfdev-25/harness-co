import { describe, expect, it } from "vitest";
import { headerLines } from "../src/core.js";

const drawing = Array.from({ length: 8 }, () => "█".repeat(16));
const LONG =
	"Front line customer questions: refunds inside the window, order status, " +
	"delivery chases, and anything a person can answer in one reply without " +
	"asking somebody else first.";

describe("headerLines", () => {
	it("is as tall as the drawing and says where you are", () => {
		const lines = headerLines(drawing, "Support", "acme.support", LONG, 80);
		expect(lines).toHaveLength(8);
		expect(lines[0]).toContain("Support");
		expect(lines[1]).toContain("acme.support");
		for (const line of lines) expect(line).toContain("█");
	});

	it("cuts a description the drawing has no room for", () => {
		// A narrow terminal wraps the same text into more lines than the
		// drawing is tall, so the tail is dropped and marked.
		const narrow = headerLines(drawing, "Support", "acme.support", LONG, 30);
		expect(narrow).toHaveLength(8);
		expect(narrow.at(-1)).toMatch(/…$/);
	});

	it("leaves a description that fits alone", () => {
		for (const text of ["Front line.", LONG]) {
			const lines = headerLines(drawing, "Support", "acme.support", text, 80);
			expect(lines).toHaveLength(8);
			expect(lines.join("\n")).not.toContain("…");
		}
		expect(headerLines(drawing, "Support", "acme.support", "Front line.", 80).join("\n")).toContain("Front line.");
	});

	it("measures the text column by what is visible, not by escape codes", () => {
		const coloured = drawing.map((line) => `[0;38;2;200;135;90m${line}[0m`);
		const plain = headerLines(drawing, "S", "u", LONG, 80);
		const painted = headerLines(coloured, "S", "u", LONG, 80);
		expect(painted.map((line) => line.replace(/\[[0-9;]*m/g, ""))).toEqual(plain);
	});

	it("survives a drawing that is missing", () => {
		expect(headerLines([], "Support", "acme.support", "Front line.", 80)).toHaveLength(1);
	});
});
