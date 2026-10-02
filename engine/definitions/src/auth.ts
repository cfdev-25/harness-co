import { createHash } from "node:crypto";
import type { ChainNode } from "@harness/compose/contracts";
import { Refusal } from "./codes.js";
import type { Config } from "./config.js";

/** 00 §4.10 `GET /v1/internal/principal`. `chain`'s commit fields are empty:
    `definitions` resolves them from the repo (02 §5.2). */
export interface Principal {
	user_id: string;
	org_id: string;
	chain: ChainNode[];
	readable: string[];
}

/** Keyed by sha256 of the token, never by the token (02 §12: it appears in no
    log line and in no in-memory key a dump would reveal). */
const cache = new Map<string, { at: number; principal: Principal }>();

/** 02 §5.2 step 1. HTTP Basic is `harness` / token, for a person running git by hand. */
export function tokenOf(header: string | undefined): string | null {
	if (!header) return null;
	const bearer = /^Bearer (.+)$/i.exec(header);
	if (bearer) return bearer[1];
	const basic = /^Basic (.+)$/i.exec(header);
	if (!basic) return null;
	const decoded = Buffer.from(basic[1], "base64").toString("utf8");
	return decoded.slice(decoded.indexOf(":") + 1) || null;
}

/** 02 §5.2 steps 2–4. */
export async function principal(config: Config, token: string): Promise<Principal> {
	const key = createHash("sha256").update(token).digest("hex");
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at <= 30_000) return hit.principal;
	// Step 3: a stale entry is never used. 5xx or a timeout is 503, not the
	// last answer — an identity that could not be checked is not an identity.
	cache.delete(key);
	let response: Response;
	try {
		response = await fetch(`${config.apiUrl}/v1/internal/principal`, {
			headers: { authorization: `Bearer ${config.serviceToken}`, "x-harness-token": token },
		});
	} catch {
		throw new Refusal("definitions.api_unreachable", 503);
	}
	if (response.status === 401) throw new Refusal("definitions.unauthenticated", 401);
	if (!response.ok) throw new Refusal("definitions.api_unreachable", 503);
	const answer = (await response.json()) as Principal;
	cache.set(key, { at: Date.now(), principal: answer });
	return answer;
}

/** The other three calls of 00 §4.10's service table — index, audit and
    policy-changed — are one shape, so they are one function (10 rule 2). */
export async function post(config: Config, path: string, body: unknown): Promise<void> {
	const response = await fetch(`${config.apiUrl}${path}`, {
		method: "POST",
		headers: { authorization: `Bearer ${config.serviceToken}`, "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) throw new Error(`${path}: ${response.status}`);
}
