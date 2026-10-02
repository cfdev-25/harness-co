import { closeSync, openSync, writeSync } from "node:fs";
import type { EndpointEvent, EndpointTally } from "@harness/compose/contracts";

export interface EndpointLog {
	/** One line per attempt, refusals included (P6). */
	write(event: EndpointEvent): void;
	/** §8: grouped by `(host, port, alias)` for the closing `PATCH`, with the
	    reasons each group carried so the console can group by them too (D133). */
	tally(): EndpointTally[];
	close(): void;
}

/**
 * 05 §8 — the authoritative log. `<sessionDir>/endpoints.jsonl`, outside the
 * jail, appended synchronously so a crash cannot lose a refusal. Bodies,
 * headers, query strings and DNS answers are not written: the table in §8 is
 * the whole of it.
 */
export function openLog(path: string): EndpointLog {
	const fd = openSync(path, "a", 0o600);
	const events: EndpointEvent[] = [];
	let open = true;
	return {
		write(event) {
			events.push(event);
			if (open) writeSync(fd, `${JSON.stringify(event)}\n`);
		},
		tally() {
			const rows = new Map<string, EndpointTally>();
			for (const event of events) {
				const key = JSON.stringify([event.host, event.port, event.alias]);
				// A string status is one of §4.7's refusals; a number is an answer.
				// `stripped` is neither: the request went, one capability lighter (D134).
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
		},
		close() {
			if (!open) return; // 10 rule 19
			open = false;
			closeSync(fd);
		},
	};
}
