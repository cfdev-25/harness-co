import type { Credentials } from "./core.js";

interface ApiErrorBody {
	code?: string;
	message?: string;
	detail?: unknown;
}

export async function api<T>(credentials: Credentials, path: string, init: RequestInit = {}): Promise<T> {
	const base = credentials.api_url.replace(/\/$/, "");
	let response: Response;
	try {
		response = await fetch(`${base}${path}`, {
			...init,
			headers: {
				authorization: `Bearer ${credentials.token}`,
				"content-type": "application/json",
				...init.headers,
			},
		});
	} catch (cause) {
		// Node's fetch says only "fetch failed", which tells nobody anything.
		throw new Error(`Could not reach the Harness API at ${base}. Is it running?`, { cause });
	}
	if (!response.ok) {
		let body: ApiErrorBody = {};
		try {
			body = (await response.json()) as ApiErrorBody;
		} catch {
			// Keep the status fallback below.
		}
		const error = new Error(body.message ?? `Harness API request failed (${response.status}).`);
		Object.assign(error, { status: response.status, code: body.code, detail: body.detail });
		throw error;
	}
	return (await response.json()) as T;
}
