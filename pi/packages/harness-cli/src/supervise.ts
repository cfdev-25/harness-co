import type { ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { api } from "./api.js";
import type { Credentials } from "./core.js";

const BATCH = 100;

export interface SuperviseInput {
	child: ChildProcess;
	sessionId: string;
	sessionDir: string;
	credentials: Credentials;
	intervalMs?: number;
}

/**
 * Creates the audit spool the extension appends to. Must run before the child
 * is spawned: once the sandbox lands the session directory is not writable
 * from inside the jail, so the extension can append but never create.
 */
export async function createSpool(sessionDir: string): Promise<void> {
	await writeFile(join(sessionDir, "audit.jsonl"), "", { flag: "a", mode: 0o600 });
}

/**
 * Owns everything that must talk to the control plane during a session, so the
 * agent needs no credential of its own: forwards the audit spool and sends the
 * heartbeat, because as the parent process it knows the child is alive.
 */
export function supervise(input: SuperviseInput): { stop(): Promise<void> } {
	const { child, sessionId, sessionDir, credentials, intervalMs = 15_000 } = input;
	const spool = join(sessionDir, "audit.jsonl");
	let sent = 0;
	let running = false;

	async function forward(): Promise<void> {
		const text = await readFile(spool, "utf8").catch(() => "");
		// Ignore a trailing partial line: the writer appends whole lines.
		const end = text.lastIndexOf("\n");
		if (end < 0) return;
		const lines = text.slice(0, end).split("\n");
		while (sent < lines.length) {
			const batch = lines.slice(sent, sent + BATCH).map((line) => JSON.parse(line) as unknown);
			await api(credentials, "/v1/audit/batch", { method: "POST", body: JSON.stringify({ events: batch }) });
			sent += batch.length;
		}
	}

	async function tick(patch: Record<string, unknown>): Promise<void> {
		if (running) return;
		running = true;
		try {
			await forward();
		} catch {
			// Best effort: keep the offset and retry on the next tick.
		}
		await api(credentials, `/v1/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(
			() => undefined,
		);
		running = false;
	}

	const timer = setInterval(() => void tick({ last_active_at: new Date().toISOString() }), intervalMs);
	timer.unref();

	const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));

	return {
		async stop() {
			clearInterval(timer);
			await exited;
			running = false;
			await tick({ status: "closed" });
		},
	};
}
