import { EventEmitter } from "node:events";
import { appendFile, mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSpool, supervise } from "../src/supervise.js";

interface Call {
	path: string;
	body: Record<string, unknown>;
}

async function controlPlane(calls: Call[]): Promise<{ url: string; server: Server }> {
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
		});
		req.on("end", () => {
			calls.push({ path: req.url ?? "", body: JSON.parse(raw || "{}") });
			res.writeHead(200, { "content-type": "application/json" });
			res.end("{}");
		});
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

let close: (() => void) | undefined;
afterEach(() => close?.());

const event = (tool: string) =>
	`${JSON.stringify({ action: "tool.call", payload: { tool }, occurred_at: new Date().toISOString() })}\n`;

describe("supervise", () => {
	it("forwards the spool once, heartbeats, and closes the session on exit", async () => {
		const calls: Call[] = [];
		const { url, server } = await controlPlane(calls);
		close = () => server.close();
		const dir = await mkdtemp(join(tmpdir(), "harness-sup-"));
		await createSpool(dir);

		const child = new EventEmitter();
		const watcher = supervise({
			child: child as any,
			sessionId: "sess-1",
			sessionDir: dir,
			credentials: { api_url: url, token: "t" },
			intervalMs: 20,
		});

		await appendFile(join(dir, "audit.jsonl"), event("read") + event("bash"));
		await new Promise((r) => setTimeout(r, 80));
		child.emit("exit", 0, null);
		await watcher.stop();

		const batches = calls.filter((c) => c.path === "/v1/audit/batch");
		const events = batches.flatMap((c) => c.body.events as unknown[]);
		expect(events).toHaveLength(2); // forwarded exactly once despite several ticks
		expect(calls.some((c) => c.path === "/v1/sessions/sess-1" && "last_active_at" in c.body)).toBe(true);
		expect(calls.at(-1)).toMatchObject({ path: "/v1/sessions/sess-1", body: { status: "closed" } });
	});

	it("ignores a partial trailing line", async () => {
		const calls: Call[] = [];
		const { url, server } = await controlPlane(calls);
		close = () => server.close();
		const dir = await mkdtemp(join(tmpdir(), "harness-sup-"));
		await createSpool(dir);
		await appendFile(join(dir, "audit.jsonl"), `${event("read")}{"action":"partial"`);

		const child = new EventEmitter();
		const watcher = supervise({
			child: child as any,
			sessionId: "sess-2",
			sessionDir: dir,
			credentials: { api_url: url, token: "t" },
			intervalMs: 20,
		});
		await new Promise((r) => setTimeout(r, 60));
		child.emit("exit", 0, null);
		await watcher.stop();

		const events = calls.filter((c) => c.path === "/v1/audit/batch").flatMap((c) => c.body.events as unknown[]);
		expect(events).toHaveLength(1);
	});
});
