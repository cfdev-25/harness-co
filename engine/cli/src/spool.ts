import { readFile } from "node:fs/promises";

/**
 * D105 — one helper for both spools. The offset is kept on failure, so the next
 * tick resends the same batch rather than dropping it (D18,
 * `spool_forward_keeps_offset_on_failure`). A trailing partial line is ignored:
 * both writers append whole lines.
 */
export async function forwardSpool(
	path: string,
	offset: number,
	send: (batch: unknown[]) => Promise<void>,
	batchSize = 100,
): Promise<number> {
	const text = await readFile(path, "utf8").catch(() => "");
	const end = text.lastIndexOf("\n");
	if (end < 0) return offset;
	const lines = text.slice(0, end).split("\n");
	let sent = offset;
	while (sent < lines.length) {
		const batch = lines.slice(sent, sent + batchSize).map((line) => JSON.parse(line) as unknown);
		// A throw here leaves `sent` where it was, which is the whole point.
		await send(batch);
		sent += batch.length;
	}
	return sent;
}
