import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forwardSpool } from "../src/spool.js";

async function spool(lines: unknown[]): Promise<string> {
	const path = join(await mkdtemp(join(tmpdir(), "harness-spool-")), "audit.jsonl");
	await writeFile(path, lines.map((line) => JSON.stringify(line)).join("\n") + (lines.length > 0 ? "\n" : ""));
	return path;
}

describe("forwardSpool (D105)", () => {
	it("spool_forward_keeps_offset_on_failure", async () => {
		const path = await spool([{ n: 1 }, { n: 2 }]);
		const seen: unknown[][] = [];
		let fail = true;
		const send = async (batch: unknown[]) => {
			seen.push(batch);
			if (fail) throw new Error("network");
		};
		// The offset is the caller's, so a throw leaves it exactly where it was.
		const after = await forwardSpool(path, 0, send).catch(() => 0);
		expect(after).toBe(0);

		fail = false;
		expect(await forwardSpool(path, 0, send)).toBe(2);
		// The next tick resends the *same* batch rather than dropping it.
		expect(seen[0]).toEqual(seen[1]);
	});

	it("batches at 100 lines and ignores a trailing partial line", async () => {
		const path = await spool(Array.from({ length: 250 }, (_one, n) => ({ n })));
		// A half-written line at the end is not forwarded: the writer appends whole lines.
		await writeFile(path, '{"n":250', { flag: "a" });
		const sizes: number[] = [];
		const sent = await forwardSpool(path, 0, async (batch) => void sizes.push(batch.length));
		expect(sizes).toEqual([100, 100, 50]);
		expect(sent).toBe(250);
	});

	it("an empty spool forwards nothing", async () => {
		expect(await forwardSpool(await spool([]), 0, async () => expect.unreachable())).toBe(0);
	});
});
