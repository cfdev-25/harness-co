import { describe, expect, it, vi } from "vitest";
import { loading, strip } from "../src/loading.js";

const plain = (text: string) => text.replace(/\[[0-9;?]*[A-Za-z]/g, "");

describe("the loading pixels", () => {
	it("sweeps a lit run across the strip and wraps", () => {
		expect(strip(0, "#", ".")).toBe("......");
		expect(strip(2, "#", ".")).toBe("##....");
		expect(strip(5, "#", ".")).toBe("...##.");
		expect(strip(7, "#", ".")).toBe(".....#");
		expect(strip(8, "#", ".")).toBe("......"); // back to the start
	});

	it("draws one line in place while waiting and clears it when stopped", () => {
		vi.useFakeTimers();
		const writes: string[] = [];
		const stream = { write: (chunk: string) => (writes.push(chunk), true), isTTY: true } as unknown as NodeJS.WriteStream;
		const wait = loading("starting", stream, { intervalMs: 10 });
		vi.advanceTimersByTime(35);
		expect(writes.length).toBe(4); // the first frame and three ticks
		for (const write of writes) expect(write.startsWith("\r")).toBe(true); // every frame redraws the same line
		expect(plain(writes[0])).toBe("\r  ░░░░░░  starting");
		wait.stop();
		wait.stop(); // idempotent
		expect(writes.length).toBe(5);
		expect(plain(writes[4])).toBe("\r");
		vi.advanceTimersByTime(50);
		expect(writes.length).toBe(5); // nothing after stop
		vi.useRealTimers();
	});

	it("draws nothing for a pipe", () => {
		const writes: string[] = [];
		const stream = { write: (chunk: string) => (writes.push(chunk), true), isTTY: false } as unknown as NodeJS.WriteStream;
		loading("starting", stream).stop();
		expect(writes).toEqual([]);
	});
});
