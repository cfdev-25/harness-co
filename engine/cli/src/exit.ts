import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EndpointEvent, EndpointTally } from "@harness/compose/contracts";
import { deferClose } from "./session.js";
import { say } from "./output.js";

/**
 * §10.1 step 2, from the authoritative spool rather than the proxy's memory, so
 * a close after a crash tallies the same rows. Grouped by `(host, port, alias)`;
 * `refused` counts a row whose status is one of 05 §4.7's refusals (a string).
 */
export async function tally(path: string): Promise<EndpointTally[]> {
	const text = await readFile(path, "utf8").catch(() => "");
	const rows = new Map<string, EndpointTally>();
	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;
		let event: EndpointEvent;
		try {
			event = JSON.parse(line) as EndpointEvent;
		} catch {
			continue;
		}
		const key = JSON.stringify([event.host, event.port, event.alias]);
		// The same arithmetic `log.tally()` does, over the file rather than over
		// memory: a session whose supervisor died still closes with its counts.
		const stripped = event.status === "stripped" ? 1 : 0;
		const refused = typeof event.status === "string" && stripped === 0 ? 1 : 0;
		const row = rows.get(key) ?? { host: event.host, port: event.port, alias: event.alias, count: 0, refused: 0, stripped: 0, reasons: {}, firstAt: event.at, lastAt: event.at };
		row.count += 1;
		row.refused += refused;
		row.stripped += stripped;
		if (event.reason) row.reasons[event.reason] = (row.reasons[event.reason] ?? 0) + 1;
		row.lastAt = event.at;
		rows.set(key, row);
	}
	return [...rows.values()];
}

export interface CloseInput {
	session: { id: string; dir: string };
	proxy: { close(): Promise<void> };
	close(endpoints: EndpointTally[]): Promise<void>;
	/** §10.1 step 5: the OAuth refresh may have rotated the file (07 §11). */
	harvest?: () => Promise<void>;
	/** §10.1 step 6's counts. */
	minutes: number;
	filesChanged: number;
}

/**
 * §10.1. The tally is posted, the connector table is zeroed, and one line says
 * what happened. A close that fails is written to `close.json` and retried by
 * the next `harness` invocation — a session is never silently unclosed.
 */
export async function closeSession(input: CloseInput): Promise<void> {
	const endpoints = await tally(join(input.session.dir, "endpoints.jsonl"));
	try {
		await input.close(endpoints);
	} catch {
		await deferClose(input.session.dir, { sessionId: input.session.id, endpoints });
		say("This session could not be closed; it will be closed the next time you run `harness`.");
	}
	await input.proxy.close();
	if (input.harvest !== undefined) await input.harvest();
	const reached = endpoints.length;
	const refused = endpoints.reduce((total, row) => total + row.refused, 0);
}
