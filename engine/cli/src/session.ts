import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EndpointTally, PreflightReport } from "@harness/compose/contracts";
import { api } from "./api.js";
import type { Credentials } from "./credentials.js";
import { sessionsDir } from "./selection.js";

export interface Session {
	id: string;
	dir: string;
	agentDir: string;
}

export const sessionDir = (id: string): string => join(sessionsDir(), id);

/**
 * §5's table, created before anything else touches disk. The spools are
 * pre-created 0600 because once the sandbox lands the session directory is not
 * writable from inside the jail: the extension may append but never create (C28).
 */
export async function createSession(id: string = randomUUID()): Promise<Session> {
	const dir = sessionDir(id);
	const agentDir = join(dir, "agent");
	await mkdir(agentDir, { recursive: true, mode: 0o700 });
	await mkdir(join(dir, "tmp"), { recursive: true, mode: 0o700 });
	for (const spool of ["audit.jsonl", "endpoints.jsonl"]) {
		await writeFile(join(dir, spool), "", { flag: "a", mode: 0o600 });
	}
	return { id, dir, agentDir };
}

/** S9: the whole report, written before any spawn. */
export async function writeReport(dir: string, report: PreflightReport): Promise<void> {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "preflight.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

interface PendingClose {
	sessionId: string;
	endpoints: EndpointTally[];
}

export const closePath = (dir: string): string => join(dir, "close.json");

/** §10.1: a close that failed is recorded, never lost. */
export async function deferClose(dir: string, pending: PendingClose): Promise<void> {
	await writeFile(closePath(dir), `${JSON.stringify(pending, null, 2)}\n`, { mode: 0o600 });
}

/**
 * §10.1's last paragraph: the next `harness` invocation of any kind retries a
 * deferred close before doing its own work. A session is never silently unclosed.
 */
export async function flushPendingClose(credentials: Credentials): Promise<void> {
	let ids: string[];
	try {
		ids = await readdir(sessionsDir());
	} catch {
		return;
	}
	for (const id of ids) {
		const path = closePath(sessionDir(id));
		let pending: PendingClose;
		try {
			pending = JSON.parse(await readFile(path, "utf8")) as PendingClose;
		} catch {
			continue;
		}
		try {
			await api(credentials, `/v1/sessions/${pending.sessionId}`, {
				method: "PATCH",
				body: JSON.stringify({ status: "closed", endpoints: pending.endpoints }),
			});
			await rm(path, { force: true });
		} catch (thrown) {
			// A session the server already holds closed or revoked (409) has
			// nothing left to close: the record is done, not retried on every
			// invocation for ever. Anything else is the API still unreachable,
			// and the next invocation tries again.
			if ((thrown as { status?: number }).status === 409) await rm(path, { force: true });
		}
	}
}
