import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { type Streams, terminalUi } from "../src/prompt.js";

const ESC = "";
const strip = (text: string) => text.replace(/\[[0-9;?]*[A-Za-z]/g, "");

/** A terminal that types the given keys, one per tick, and remembers what was drawn. */
function terminal(keys: string[]) {
	const stdin = Object.assign(new EventEmitter(), {
		raw: null as boolean | null,
		setRawMode(raw: boolean) {
			this.raw = raw;
			return this;
		},
		resume() {
			queueMicrotask(() => {
				for (const key of keys) this.emit("data", key);
			});
			return this;
		},
		pause() {
			return this;
		},
		setEncoding() {
			return this;
		},
		isTTY: true,
	});
	const out: string[] = [];
	const stdout = { write: (chunk: string) => (out.push(chunk), true), isTTY: true, columns: 80 };
	return { streams: { stdin, stdout } as unknown as Streams, out, stdin };
}

describe("select", () => {
	it("moves with arrows and j/k, wraps, and answers the index on enter", async () => {
		const { streams, out, stdin } = terminal([`${ESC}[B`, "j", "k", `${ESC}[B`, `${ESC}[B`, "\r"]);
		const answer = await terminalUi(streams).select("Keep these as yours?", ["All", "None", "Pick"]);
		expect(answer).toBe(0); // down, down, up, down, down → wraps to the top
		expect(stdin.raw).toBe(false); // raw mode is off again
		const drawn = strip(out.join(""));
		expect(drawn).toContain("  Keep these as yours?");
		expect(drawn).toContain("  ▶ All");
		expect(drawn).toContain("  ▶ Pick");
	});

	it("answers null on escape or q", async () => {
		expect(await terminalUi(terminal([ESC]).streams).select("?", ["a", "b"])).toBeNull();
		expect(await terminalUi(terminal(["q"]).streams).select("?", ["a", "b"])).toBeNull();
	});
});

describe("checklist", () => {
	it("ticks with space, untick again, and answers the ticked indexes in order", async () => {
		const { streams, out } = terminal([" ", "j", " ", "j", " ", " ", "j", " ", "\r"]);
		const answer = await terminalUi(streams).checklist("Which?", ["one", "two", "three"]);
		expect(answer).toEqual([1]); // three was ticked and unticked; the wrap lands on one and unticks it
		const drawn = strip(out.join(""));
		expect(drawn).toContain("■ one");
		expect(drawn).toContain("□ three");
	});

	it("answers null on escape", async () => {
		expect(await terminalUi(terminal([ESC]).streams).checklist("?", ["a"])).toBeNull();
	});
});
