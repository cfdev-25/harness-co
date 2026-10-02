import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Principal } from "./auth.js";
import type { Config } from "./config.js";

/**
 * 02 §6.1 — D1's mechanism, and the only place per-ref authorisation is
 * decided. `transfer.hideRefs=refs` hides every ref; one `!` entry per ref the
 * person may read un-hides it, and the three `allow*SHA1InWant` are false, so
 * a hidden tip is not advertised, therefore not wantable, therefore not sent.
 */
export function serveGit(
	request: IncomingMessage,
	response: ServerResponse,
	config: Config,
	principal: Principal,
	pathInfo: string,
	query: string,
): void {
	const settings: Array<[string, string]> = [["transfer.hideRefs", "refs"]];
	// The chain plus `readable`: a team admin fetches their members' user refs
	// (prd-v2 §18), and nobody else's.
	for (const node of principal.chain) settings.push(["transfer.hideRefs", `!${node.ref}`]);
	for (const ref of principal.readable) settings.push(["transfer.hideRefs", `!${ref}`]);
	// receive.hideRefs is applied after transfer.hideRefs and the last match
	// wins, so this re-hides `readable`: a member's ref is readable, never
	// writable. §7 step 1 refuses the rest.
	settings.push(["receive.hideRefs", "refs"]);
	for (const node of principal.chain) settings.push(["receive.hideRefs", `!${node.ref}`]);
	settings.push(
		["uploadpack.allowAnySHA1InWant", "false"],
		["uploadpack.allowTipSHA1InWant", "false"],
		["uploadpack.allowReachableSHA1InWant", "false"],
		["core.hooksPath", config.hooks],
		["receive.denyNonFastForwards", "true"],
		["receive.fsckObjects", "true"],
		["receive.maxInputSize", String(config.quota)],
	);

	const env: Record<string, string> = {
		...(process.env as Record<string, string>),
		GIT_PROJECT_ROOT: config.root,
		GIT_HTTP_EXPORT_ALL: "1",
		PATH_INFO: pathInfo,
		REQUEST_METHOD: request.method ?? "GET",
		QUERY_STRING: query,
		REMOTE_USER: principal.user_id,
		HARNESS_ACTOR: principal.user_id,
		HARNESS_CHAIN: JSON.stringify(principal.chain),
		DEFINITIONS_SOCK: config.sock,
		GIT_CONFIG_COUNT: String(settings.length),
	};
	settings.forEach(([key, value], at) => {
		env[`GIT_CONFIG_KEY_${at}`] = key;
		env[`GIT_CONFIG_VALUE_${at}`] = value;
	});
	if (request.headers["content-type"]) env.CONTENT_TYPE = request.headers["content-type"];
	if (request.headers["content-length"]) env.CONTENT_LENGTH = request.headers["content-length"];
	// git gzips a large request body; without this http-backend reads it raw.
	if (request.headers["content-encoding"]) env.HTTP_CONTENT_ENCODING = request.headers["content-encoding"] as string;
	// `Git-Protocol` is deliberately not forwarded. Protocol v2's `fetch` accepts
	// a `want` for any object that exists, advertised or not, which would defeat
	// hideRefs; v0 refuses it (`not our ref`). This is the whole argument of §6.1.
	delete env.GIT_PROTOCOL;
	delete env.HTTP_GIT_PROTOCOL;

	const child = spawn("git", ["http-backend"], { env });
	request.pipe(child.stdin);
	child.stderr.resume();

	let head = Buffer.alloc(0);
	let started = false;
	child.stdout.on("data", (chunk: Buffer) => {
		if (started) {
			response.write(chunk);
			return;
		}
		head = Buffer.concat([head, chunk]);
		const end = head.indexOf("\r\n\r\n");
		if (end < 0) return;
		let status = 200;
		for (const line of head.subarray(0, end).toString("utf8").split("\r\n")) {
			const colon = line.indexOf(":");
			if (colon < 0) continue;
			const name = line.slice(0, colon);
			const value = line.slice(colon + 1).trim();
			if (name.toLowerCase() === "status") status = Number(value.split(" ")[0]);
			else response.setHeader(name, value);
		}
		response.writeHead(status);
		started = true;
		response.write(head.subarray(end + 4));
	});
	child.on("close", () => {
		if (!started) response.writeHead(500);
		response.end();
	});
}
