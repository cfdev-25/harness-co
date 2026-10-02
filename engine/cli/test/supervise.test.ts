import { EventEmitter } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supervise, type Validity } from "../src/supervise.js";

/** A child that records its signals and exits when told, as `spawn` would. */
function fakeChild() {
	const child = new EventEmitter() as EventEmitter & { kill: (signal: string) => void; signals: string[] };
	child.signals = [];
	child.kill = (signal: string) => {
		child.signals.push(signal);
		if (signal === "SIGKILL") child.emit("exit", null, "SIGKILL");
	};
	return child;
}

let dir: string;
let notes: string[];
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "harness-sup-"));
	notes = [];
	for (const spool of ["audit.jsonl", "endpoints.jsonl"]) await writeFile(join(dir, spool), "");
});

function harness(validity: () => Promise<Validity>, options: { now?: () => number; heartbeat?: () => Promise<Validity | void>; killAfterMs?: number } = {}) {
	const child = fakeChild();
	const proxy = { retire: vi.fn(), close: vi.fn(async () => undefined) };
	const watcher = supervise({
		child: child as never,
		sessionDir: dir,
		proxy,
		notify: (line) => notes.push(line),
		intervalMs: 1,
		now: options.now,
		killAfterMs: options.killAfterMs,
		api: {
			audit: async () => undefined,
			endpoints: async () => undefined,
			heartbeat: options.heartbeat ?? (async () => undefined),
			validity,
		},
	});
	return { child, proxy, watcher };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("supervise (§9)", () => {
	it("heartbeat_answer_is_the_validity", async () => {
		// D145: one request per tick. The heartbeat answered, so `GET` is never made,
		// and its answer is acted on like `GET`'s would have been.
		const validity = vi.fn(async (): Promise<Validity> => ({ status: "active" }));
		const { child, watcher } = harness(validity, { heartbeat: async () => ({ status: "revoked", revoked_reason: "policy changed" }) });
		await settle();
		expect(validity).not.toHaveBeenCalled();
		expect(child.signals).toContain("SIGTERM");
		expect(watcher.ended()?.code).toBe("supervise.revoked");
		expect(notes[0]).toContain("policy changed");
	});

	it("heartbeat_without_an_answer_falls_back_to_get", async () => {
		const validity = vi.fn(async (): Promise<Validity> => ({ status: "active" }));
		harness(validity, { heartbeat: async () => undefined });
		await settle();
		expect(validity).toHaveBeenCalled();
	});

	it("retired_alias_stops_injection", async () => {
		const { proxy, watcher } = harness(async () => ({ status: "active", retired: ["crm"] }));
		await settle();
		void watcher;
		// Called once per alias, and the notice printed once, however many ticks ran.
		expect(proxy.retire.mock.calls).toEqual([["crm"]]);
		expect(notes.filter((line) => line.includes("`crm` credential was retired"))).toHaveLength(1);
		expect(notes[0]).toBe("The `crm` credential was retired by your organization; requests using it will be refused from now.");
	});

	it("revoked_session_terminates_child", async () => {
		const { child, proxy, watcher } = harness(async () => ({ status: "revoked", revoked_reason: "a boundary tightened" }), { killAfterMs: 10 });
		await settle();
		expect(proxy.close).toHaveBeenCalled();
		expect(notes).toContain("This session was ended by your organization: a boundary tightened.");
		// SIGTERM first; still alive when the grace runs out, so SIGKILL follows.
		expect(child.signals[0]).toBe("SIGTERM");
		await settle();
		expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
		expect(watcher.ended()?.code).toBe("supervise.revoked");
	});

	it("unreachable_control_plane_ends_after_ttl", async () => {
		let clock = 0;
		const down = async () => {
			throw new Error("ECONNREFUSED");
		};
		const { child, watcher } = harness(down as never, { now: () => clock, heartbeat: down });
		await settle();
		// The first failure warns once and the session keeps running.
		expect(notes).toEqual(["Cannot reach the Harness API; this session will end in 15 minutes unless it comes back."]);
		expect(child.signals).toEqual([]);

		clock = 15 * 60 * 1000 + 1;
		await settle();
		expect(watcher.ended()).toEqual({
			code: "supervise.unreachable",
			message: "The Harness API was unreachable for 15 minutes, so this session has ended.",
			remedy: "`harness run` when it is back.",
		});
		expect(child.signals).toContain("SIGTERM");
	});

	it("child_exit_before_first_tick_still_closes", async () => {
		// A session shorter than the tick interval has never sent a heartbeat, so
		// without the final pass the report would never be posted at all (D7).
		const patches: Record<string, unknown>[] = [];
		const child = fakeChild();
		const watcher = supervise({
			child: child as never,
			sessionDir: dir,
			proxy: { retire: () => undefined, close: async () => undefined },
			notify: (line) => notes.push(line),
			intervalMs: 60_000,
			report: { sessionId: "s1" } as never,
			api: {
				audit: async () => undefined,
				endpoints: async () => undefined,
				heartbeat: async (patch) => void patches.push(patch),
				validity: async () => ({ status: "active" }),
			},
		});
		child.emit("exit", 0, null);
		await watcher.stop();
		expect(patches).toHaveLength(1);
		expect(patches[0].preflight).toEqual({ sessionId: "s1" });
	});

	it("forwards both spools under their own class, and posts the report once", async () => {
		const audit: unknown[][] = [];
		const endpoints: unknown[][] = [];
		const patches: Record<string, unknown>[] = [];
		await writeFile(join(dir, "audit.jsonl"), '{"a":1}\n');
		await writeFile(join(dir, "endpoints.jsonl"), '{"host":"x"}\n');
		const child = fakeChild();
		const watcher = supervise({
			child: child as never,
			sessionDir: dir,
			proxy: { retire: () => undefined, close: async () => undefined },
			notify: (line) => notes.push(line),
			intervalMs: 1,
			report: { sessionId: "s1" } as never,
			api: {
				audit: async (events) => void audit.push(events),
				endpoints: async (events) => void endpoints.push(events),
				heartbeat: async (patch) => void patches.push(patch),
				validity: async () => ({ status: "active" }),
			},
		});
		await settle();
		child.emit("exit", 0, null);
		await watcher.stop();
		expect(audit[0]).toEqual([{ a: 1 }]);
		expect(endpoints[0]).toEqual([{ host: "x" }]);
		// console D7: the report rides the first heartbeat and never again.
		expect(patches.filter((patch) => patch.preflight !== undefined)).toHaveLength(1);
		expect(patches.length).toBeGreaterThan(1);
	});
});
