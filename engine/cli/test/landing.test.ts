import { describe, expect, it } from "vitest";
import { type Landing, landingLines, plainLanding, startRule } from "../src/landing.js";

const ICON = { palette: ["#c8875a"], rows: Array.from({ length: 16 }, () => "0".repeat(16)) };

const landing = (over: Partial<Landing> = {}): Landing => ({
	icon: ICON,
	name: "support",
	description: "The support desk's harness.",
	delivered: "3 skills · 1 prompt",
	model: "anthropic · claude-sonnet-5",
	reach: "allow-list, 6 hosts",
	workspace: "/tmp/marketing-deck",
	...over,
});

const PET = `  ${"█".repeat(16)}`;
const isPixelText = (line: string) => /[▀▄█]/.test(line.slice(PET.length));

describe("landingLines lays the text out against the room beside the drawing", () => {
	it("wide: the name in pixels on one line beside the drawing, then the description and the facts", () => {
		const lines = landingLines(landing(), 80, "mono");
		expect(lines.slice(0, 8).every((line) => line.startsWith(PET))).toBe(true); // eight rows of drawing
		expect(lines.slice(0, 4).every(isPixelText)).toBe(true); // four rows of pixel name
		expect(lines[4]).toBe(PET);
		expect(lines.slice(8)).toEqual([
			"",
			"  The support desk's harness.",
			"  delivers  3 skills · 1 prompt",
			"  model     anthropic · claude-sonnet-5",
			"  reach     allow-list, 6 hosts",
			"  in        /tmp/marketing-deck",
		]);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
	});

	it("narrower: the name wraps to two pixel lines", () => {
		// room = 50 − 21 = 29 columns: four glyphs a line, so `support` is `supp` / `ort`.
		const lines = landingLines(landing(), 50, "mono");
		expect(lines.slice(0, 8).every(isPixelText)).toBe(true);
		expect(lines[8]).toBe("");
		expect(lines[9]).toBe("  The support desk's harness.");
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(50);
	});

	it("narrow: the name is plain text when the pixel font would need more than two lines", () => {
		const lines = landingLines(landing(), 30, "mono");
		expect(lines[0]).toBe(`${PET}   support`);
		expect(lines[9]).toBe("  The support desk's harness.");
		expect(lines.some(isPixelText)).toBe(false);
	});

	it("draws a grey square for a harness with no drawing, and skips facts it does not have", () => {
		const lines = landingLines(landing({ icon: null, description: "", model: "", reach: "" }), 80, "mono");
		expect(lines.slice(0, 8).every((line) => line.startsWith(PET))).toBe(true);
		expect(lines.slice(-2)).toEqual(["  delivers  3 skills · 1 prompt", "  in        /tmp/marketing-deck"]);
	});

	it("prints the same facts as plain lines for a pipe", () => {
		expect(plainLanding(landing())).toEqual([
			"support — The support desk's harness.",
			"delivers  3 skills · 1 prompt",
			"model     anthropic · claude-sonnet-5",
			"reach     allow-list, 6 hosts",
			"in        /tmp/marketing-deck",
		]);
	});

	it("rules the full width where ours ends", () => {
		const rule = startRule("Pi", 80, "mono");
		expect(rule).toMatch(/^  ── Starting Pi ─+$/);
		expect(rule).toHaveLength(80);
	});
});
