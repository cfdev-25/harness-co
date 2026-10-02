import { describe, expect, it } from "vitest";
import { type Frame, bootScreen, exitScreen, modelBrief, reachBrief } from "../src/screens.js";

/**
 * 08 §10.0 / §11.1, W5-D12. The frames are snapshotted with colours stripped,
 * because what is being checked is the *layout* — where the drawing stops,
 * where the labels line up, and that eighty columns is enough.
 */
const ANSI = /\[[0-9;]*m/g;
const plain = (lines: string[]) => lines.map((line) => line.replace(ANSI, "").trimEnd()).join("\n");

const ICON = {
	palette: ["#7aa7c7", "#3c6547", "#c8875a"],
	rows: [
		"................",
		"................",
		".....000000.....",
		".....022200.....",
		"..000022200...0.",
		"..022212220...0.",
		"..022222220...0.",
		"..000002220..00.",
		"......022200000.",
		"....00022220200.",
		"......02222200..",
		"......0002200...",
		"........0020....",
		".........000....",
		"......00000.....",
		"................",
	],
};

const frame = (over: Partial<Frame> = {}): Frame => ({
	icon: ICON,
	name: "Support",
	description: "The support desk's harness.",
	delivered: "3 skills · 1 prompt · 2 memories",
	model: "anthropic · claude-sonnet-5",
	reach: "allow-list, 6 hosts",
	workspace: "/tmp/marketing-deck",
	width: 80,
	mode: "mono",
	tty: true,
	...over,
});

describe("the boot screen", () => {
	it("draws the harness, what it delivered, the model, the reach and the workspace", () => {
		expect(plain(bootScreen(frame(), "Claude Code"))).toMatchInlineSnapshot(`
			"                     ▄▀▀▀▀ █   █ █▀▀▀▄ █▀▀▀▄ ▄▀▀▀▄ █▀▀▀▄ ▀▀█▀▀
			       ██████        ▀▄▄▄  █   █ █▄▄▄▀ █▄▄▄▀ █   █ █▄▄▄▀   █
			    █████████   █        █ █   █ █     █     █   █ █ ▀▄    █
			    █████████  ▄█    ▀▀▀▀   ▀▀▀  ▀     ▀      ▀▀▀  ▀   ▀   ▀
			      ▄▄█████████
			        ███████▀
			          ▀███
			        ▀▀▀▀▀

			  The support desk's harness.
			  delivers  3 skills · 1 prompt · 2 memories
			  model     anthropic · claude-sonnet-5
			  reach     allow-list, 6 hosts
			  in        /tmp/marketing-deck

			  ── Starting Claude Code ──────────────────────────────────────────────────────"
		`);
	});

	it("draws a grey square for a harness nobody has given a drawing yet", () => {
		const lines = plain(bootScreen(frame({ icon: null }), "Pi")).split("\n");
		// Eight full rows of the placeholder, the same width as a real drawing.
		// The grey square on the left, the name in pixels beside it.
		expect(lines[0].startsWith(`  ${"█".repeat(16)}   `)).toBe(true);
		expect(lines.filter((line) => line.startsWith(`  ${"█".repeat(16)}`))).toHaveLength(8);
		expect(lines[lines.length - 1]).toMatch(/^  ── Starting Pi ─+$/);
		expect(lines[lines.length - 1]).toHaveLength(80);
	});

	it("prints the same facts as plain lines when it is not a terminal", () => {
		expect(plain(bootScreen(frame({ tty: false }), "Claude Code"))).toMatchInlineSnapshot(`
			"Support — The support desk's harness.
			delivers  3 skills · 1 prompt · 2 memories
			model     anthropic · claude-sonnet-5
			reach     allow-list, 6 hosts
			in        /tmp/marketing-deck
			Starting Claude Code…"
		`);
	});

	it("never runs past eighty columns, whatever the workspace is called", () => {
		const long = frame({ workspace: `/tmp/${"deck-".repeat(40)}`, delivered: "x ".repeat(60) });
		for (const line of plain(bootScreen(long, "Claude Code")).split("\n")) expect(line.length).toBeLessThanOrEqual(80);
	});
});

describe("the exit review's frame", () => {
	const rows = {
		changed: [{ key: "skill/quokka", note: "+12 −3" }, { key: "memory/release-notes", note: "+1 −0" }],
		made: [{ key: "prompt/standup", note: "made this session" }],
		removed: [{ key: "tool/deploy", note: "removed this session" }],
	};

	it("names the harness, then every change by kind with its counts coloured, and no landing", () => {
		expect(plain(exitScreen("Support", rows))).toMatchInlineSnapshot(`
			"  Support changes

			  memory  release-notes  +1 −0
			  prompt  standup        new
			  skill   quokka         +12 −3
			  tool    deploy         removed
			"
		`);
		const coloured = exitScreen("Support", rows).join("\n");
		expect(coloured).toContain("+12");
		expect(coloured).toContain("−3");
	});
});

describe("the words the header uses", () => {

	it("says the model, and never a metered zero for a native session (C22)", () => {
		const model = { provider: { id: "anthropic" }, model: "claude-sonnet-5" };
		expect(modelBrief({ native: false, model })).toBe("anthropic · claude-sonnet-5");
		expect(modelBrief({ native: true, model })).toBe("your own sign-in · not metered");
		expect(modelBrief(null)).toBe("");
	});

	it("says the reach in the fewest words that are still true", () => {
		expect(reachBrief(undefined)).toBe("not decided yet");
		expect(reachBrief({ mode: "off", hosts: [], setBy: "acme" })).toBe("off");
		expect(reachBrief({ mode: "allow", hosts: ["pypi.org"], setBy: "acme" })).toBe("allow-list, 1 host");
		expect(reachBrief({ mode: "on", hosts: [], setBy: "acme" })).toBe("on");
		expect(reachBrief({ mode: "on", hosts: ["a", "b"], setBy: "acme" })).toBe("on, 2 hosts denied");
	});
});
