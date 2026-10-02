import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EndpointEvent, EndpointTally } from "@harness/compose/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeSession, tally } from "../src/exit.js";
import { flushPendingClose } from "../src/session.js";

let dir: string;
beforeEach(async () => {
	process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-exit-"));
	dir = join(process.env.HARNESS_HOME, "sessions", "s1");
	await (await import("node:fs/promises")).mkdir(dir, { recursive: true });
});

const event = (over: Partial<EndpointEvent>): EndpointEvent =>
	({ at: "2026-01-01T00:00:00Z", mode: "inject", host: "api.stripe.com", port: 443, status: 200, bytesOut: 1, bytesIn: 1, ...over }) as EndpointEvent;

async function spool(events: EndpointEvent[]): Promise<void> {
	await writeFile(join(dir, "endpoints.jsonl"), events.map((one) => JSON.stringify(one)).join("\n") + "\n");
}

describe("exit (§10.1)", () => {
	it("exit_posts_tally", async () => {
		await spool([
			event({ alias: "crm" }),
			event({ alias: "crm", at: "2026-01-01T00:05:00Z" }),
			event({ alias: "crm", status: "denied", at: "2026-01-01T00:06:00Z" }),
			event({ host: "api.other.com", alias: "x" }),
		]);
		let posted: EndpointTally[] | undefined;
		await closeSession({
			session: { id: "4f2a0000-0000-0000-0000-000000000000", dir },
			proxy: { close: vi.fn(async () => undefined) },
			close: async (endpoints) => void (posted = endpoints),
			minutes: 41,
			filesChanged: 12,
		});
		// Grouped by (host, port, alias); `refused` counts the string statuses.
		expect(posted).toEqual([
			{ host: "api.stripe.com", port: 443, alias: "crm", count: 3, refused: 1, stripped: 0, reasons: {}, firstAt: "2026-01-01T00:00:00Z", lastAt: "2026-01-01T00:06:00Z" },
			{ host: "api.other.com", port: 443, alias: "x", count: 1, refused: 0, stripped: 0, reasons: {}, firstAt: "2026-01-01T00:00:00Z", lastAt: "2026-01-01T00:00:00Z" },
		]);
	});

	it("zeroes the connector table even when the close fails", async () => {
		await spool([event({ alias: "crm" })]);
		const close = vi.fn(async () => undefined);
		await closeSession({
			session: { id: "s1", dir },
			proxy: { close },
			close: async () => {
				throw new Error("offline");
			},
			minutes: 1,
			filesChanged: 0,
		});
		expect(close).toHaveBeenCalled();
		// A session is never silently unclosed: the tally is kept for the retry.
		expect(JSON.parse(await readFile(join(dir, "close.json"), "utf8"))).toMatchObject({ sessionId: "s1" });
	});

	it("close_deferred_is_retried", async () => {
		await spool([event({ alias: "crm" })]);
		await closeSession({
			session: { id: "s1", dir },
			proxy: { close: async () => undefined },
			close: async () => {
				throw new Error("offline");
			},
			minutes: 1,
			filesChanged: 0,
		});
		const seen: unknown[] = [];
		vi.resetModules();
		const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
			seen.push(JSON.parse(init.body as string));
			return new Response(null, { status: 204 });
		});
		vi.stubGlobal("fetch", fetchMock);
		await flushPendingClose({ api_url: "http://api", token: "t" });
		expect(seen).toEqual([{ status: "closed", endpoints: [expect.objectContaining({ alias: "crm" })] }]);
		// …and the record is deleted, so it is retried once and not forever.
		await expect(readFile(join(dir, "close.json"), "utf8")).rejects.toThrow();
		vi.unstubAllGlobals();
	});

	it("close_already_final_is_dropped", async () => {
		// The server holds the session closed or revoked already (409): there is
		// nothing left to close, so the record goes; a 503 keeps it for next time.
		await closeSession({ session: { id: "s1", dir }, proxy: { close: async () => undefined }, close: async () => { throw new Error("offline"); }, minutes: 1, filesChanged: 0 });
		for (const [status, kept] of [[503, true], [409, false]] as const) {
			vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "x", message: "x" }), { status })));
			await flushPendingClose({ api_url: "http://api", token: "t" });
			await (kept ? expect(readFile(join(dir, "close.json"), "utf8")).resolves.toBeTruthy() : expect(readFile(join(dir, "close.json"), "utf8")).rejects.toThrow());
			vi.unstubAllGlobals();
		}
	});

	it("an empty spool tallies to nothing", async () => {
		await writeFile(join(dir, "endpoints.jsonl"), "");
		expect(await tally(join(dir, "endpoints.jsonl"))).toEqual([]);
	});
});
