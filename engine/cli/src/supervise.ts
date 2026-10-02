import type { ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { PreflightReport } from "@harness/compose/contracts";
import { forwardSpool } from "./spool.js";

/** D104: 15 minutes from the last successful validity check. */
export const TTL_MS = 15 * 60 * 1000;
const KILL_AFTER_MS = 10_000;

/** What `GET /v1/sessions/{id}` answers (00 §4.10). */
export interface Validity {
	status: "active" | "revoked" | "closed";
	retired?: string[];
	revoked_reason?: string | null;
}

/** The control plane, injected so the network edge is the caller's (10 rule 17). */
export interface SuperviseApi {
	audit(events: unknown[]): Promise<void>;
	endpoints(events: unknown[]): Promise<void>;
	/** §9 step 3. Answers with the session's validity (D145); a server that answers nothing is read with `validity()`. */
	heartbeat(patch: Record<string, unknown>): Promise<Validity | void>;
	/** §9 step 3's fallback: the read the heartbeat could not make. */
	validity(): Promise<Validity>;
}

export interface SuperviseInput {
	child: ChildProcess;
	sessionDir: string;
	api: SuperviseApi;
	/** Only `retire` and `close` are reached from here; the table stays the proxy's. */
	proxy: { retire(alias: string): void; close(): Promise<void> };
	/** Posted once, on the first tick (console D7). */
	report?: PreflightReport;
	notify(line: string): void;
	intervalMs?: number;
	ttlMs?: number;
	/** §9 step 4's grace before `SIGKILL`. One constant, injected so a test need not wait it out. */
	killAfterMs?: number;
	now?: () => number;
}

/** Set when the session was ended for the person rather than by them. */
export interface Ended {
	code: string;
	message: string;
	remedy: string;
}

export interface Supervisor {
	stop(): Promise<void>;
	ended: () => Ended | undefined;
}

/**
 * §9. One timer, one `tick`, never two in flight. Nothing here re-reads refs or
 * `preflight.json`: a policy change reaches a running session as `revoked` or
 * `retired`, set by `api` when `definitions` reports the push (S4).
 */
export function supervise(input: SuperviseInput): Supervisor {
	const { child, sessionDir, api, proxy, notify } = input;
	const intervalMs = input.intervalMs ?? 15_000;
	const ttlMs = input.ttlMs ?? TTL_MS;
	const now = input.now ?? Date.now;
	const killAfterMs = input.killAfterMs ?? KILL_AFTER_MS;

	const audit = join(sessionDir, "audit.jsonl");
	const endpoints = join(sessionDir, "endpoints.jsonl");
	let auditAt = 0;
	let endpointsAt = 0;
	let running = false;
	let reported = input.report === undefined;
	let lastOk = now();
	let warned = false;
	let ended: Ended | undefined;
	const retired = new Set<string>();

	/** §9 step 4's two terminal cases, and §9 step 5's third. */
	async function terminate(code: string, message: string, remedy: string): Promise<void> {
		if (ended !== undefined) return;
		ended = { code, message, remedy };
		notify(message);
		await proxy.close();
		child.kill("SIGTERM");
		const killer = setTimeout(() => child.kill("SIGKILL"), killAfterMs);
		killer.unref?.();
		child.once("exit", () => clearTimeout(killer));
	}

	/** Steps 1 and 2: both spools, one helper, the same offset rule (D105). */
	async function flush(): Promise<void> {
		auditAt = await forwardSpool(audit, auditAt, (events) => api.audit(events)).catch(() => auditAt);
		endpointsAt = await forwardSpool(endpoints, endpointsAt, (events) => api.endpoints(events)).catch(() => endpointsAt);
	}

	async function tick(): Promise<void> {
		if (running || ended !== undefined) return;
		running = true;
		try {
			await flush();
			// 3 and 4: the heartbeat, then validity. Silence is only silence when
			// both fail (§9 step 5), so their outcomes are tracked together.
			let reached = false;
			const patch: Record<string, unknown> = { last_active_at: new Date(now()).toISOString() };
			if (!reported) patch.preflight = input.report;
			// D145: the heartbeat's answer is the validity, so a tick is one request;
			// `GET` is for a heartbeat that failed or a server that answered nothing.
			let answered: Validity | void = undefined;
			try {
				answered = await api.heartbeat(patch);
				reported = true;
				reached = true;
			} catch {
				// The report is retried on the next tick; `coalesce` makes it once.
			}
			try {
				const validity = answered && typeof answered.status === "string" ? answered : await api.validity();
				reached = true;
				for (const alias of validity.retired ?? []) {
					if (retired.has(alias)) continue;
					retired.add(alias);
					proxy.retire(alias);
					notify(`The \`${alias}\` credential was retired by your organization; requests using it will be refused from now.`);
				}
				if (validity.status === "revoked") {
					await terminate("supervise.revoked", `This session was ended by your organization: ${validity.revoked_reason ?? "no reason was recorded"}.`, "`harness run` starts a new one under the current policy.");
				} else if (validity.status === "closed") {
					await terminate("supervise.revoked", "This session was closed from the console.", "`harness run` starts a new one under the current policy.");
				}
			} catch {
				// Handled by the silence rule below.
			}

			// 5: fail closed on silence (S5, I5).
			if (reached) {
				lastOk = now();
				warned = false;
			} else {
				if (!warned) {
					warned = true;
					notify("Cannot reach the Harness API; this session will end in 15 minutes unless it comes back.");
				}
				if (now() - lastOk > ttlMs) {
					await terminate("supervise.unreachable", "The Harness API was unreachable for 15 minutes, so this session has ended.", "`harness run` when it is back.");
				}
			}
		} finally {
			running = false;
		}
	}

	const timer = setInterval(() => void tick(), intervalMs);
	timer.unref?.();
	const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

	return {
		ended: () => ended,
		async stop() {
			clearInterval(timer);
			await exited;
			running = false;
			// One final pass over both spools, so nothing is left behind (§9) —
			// unconditional, because a revoked session still has lines to forward.
			await flush();
			// A session shorter than one tick has never sent a heartbeat, so the
			// report would never be posted at all; console D7 wants it once, and
			// the server coalesces, so sending it here is the once (§9 step 3).
			if (!reported) {
				await api.heartbeat({ last_active_at: new Date(now()).toISOString(), preflight: input.report }).then(
					() => {
						reported = true;
					},
					() => undefined,
				);
			}
		},
	};
}
