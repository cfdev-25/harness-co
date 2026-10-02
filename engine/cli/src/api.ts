import type { Blocker } from "@harness/compose/contracts";
import type { PreflightApi } from "./preflight/preflight.js";
import type { Credentials } from "./credentials.js";

/** The one envelope `api` answers with (console 03 §7.4): `{ code, message, remedy?, detail }`. */
interface ErrorBody {
	code?: string;
	message?: string;
	remedy?: string;
	detail?: { blockers?: Blocker[] } & Record<string, unknown>;
}

export interface ApiError extends Error {
	status?: number;
	code?: string;
	remedy?: string;
	detail?: unknown;
	unreachable?: boolean;
}

/** Bearer fetch. Attaches `status`, `code`, `remedy`, `detail`; nothing here
    renders. A refusal that carries all three words is a `Blocker` by 10 rule 12,
    so §12 rule 2 prints the server's own sentence and remedy unchanged. */
export async function api<T>(credentials: Credentials, path: string, init: RequestInit = {}): Promise<T> {
	const base = credentials.api_url.replace(/\/$/, "");
	let response: Response;
	try {
		response = await fetch(`${base}${path}`, {
			...init,
			headers: { authorization: `Bearer ${credentials.token}`, "content-type": "application/json", ...init.headers },
		});
	} catch (cause) {
		// Node's fetch says only "fetch failed", which tells nobody anything.
		const error: ApiError = new Error(`Could not reach the Harness API at ${base}.`, { cause });
		error.unreachable = true;
		throw error;
	}
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as ErrorBody;
		const error: ApiError = new Error(body.message ?? `Harness API request failed (${response.status}).`);
		Object.assign(error, { status: response.status, code: body.code, remedy: body.remedy, detail: body.detail });
		throw error;
	}
	// 204 has no body; every caller of one ignores the value.
	return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/**
 * 03's edge (10 rule 17). `POST /v1/sessions` refusing is an **answer**, not a
 * failure: the broker returns its `Blocker`s under `detail.blockers`, and
 * preflight folds them into the report rather than throwing a stack.
 */
export function preflightApi(credentials: Credentials): PreflightApi {
	return {
		url: credentials.api_url,
		async post<T>(path: string, body: unknown): Promise<T> {
			try {
				return await api<T>(credentials, path, { method: "POST", body: JSON.stringify(body) });
			} catch (thrown) {
				const blockers = (thrown as ApiError).detail as { blockers?: Blocker[] } | undefined;
				if (blockers?.blockers === undefined) throw thrown;
				return { credentials: [], slots: [], blockers: blockers.blockers } as T;
			}
		},
	};
}
