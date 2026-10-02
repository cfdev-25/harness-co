import { type IncomingMessage, request, type ServerResponse } from "node:http";
import { connect } from "node:tls";
import type { EndpointEvent, Reach, WireFormat } from "@harness/compose/contracts";
import type { Ctx } from "./proxy.js";
import { denied } from "./tunnel.js";

/** Hop-by-hop, plus the two C23 strips and the three §4.3 carriers. */
const HOP = new Set(["connection", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade"]);
const NEVER = new Set(["cookie", "x-http-method-override", "host", "proxy-authorization", "authorization", "x-api-key"]);

/** 05 §6 — `METHOD /connectors/<alias>/<path>`. Numbered as the document is. */
export async function inject(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
	const event: EndpointEvent = { at: new Date().toISOString(), mode: "inject", host: "", port: 443, method: req.method, status: "no-route", bytesOut: 0, bytesIn: 0 };
	const target = req.url ?? "";
	const mark = target.indexOf("?");
	event.path = mark === -1 ? target : target.slice(0, mark); // D74: no query
	// Step 1 — `proxy.inject.absolute_form`.
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return refuse(ctx, res, event, 400, "Use the connector path, not a full URL.");
	const parts = /^\/connectors\/([a-z0-9][a-z0-9-]{0,63})(?:\/(.*))?$/.exec(event.path);
	if (!parts) return refuse(ctx, res, event, 404, "");
	// Step 2 — `proxy.inject.unknown_alias`.
	const alias = parts[1];
	event.alias = alias;
	const connector = ctx.plan.connectors[alias];
	if (!connector) {
		return refuse(ctx, res, event, 404, `No connector named "${alias}" in this session.`, `Something asked for a connector "${alias}" this session does not have.`);
	}
	// Step 3: any of the three carriers (D70).
	if (!ctx.authenticate(req, true)) {
		event.status = "bad-secret";
		return refuse(ctx, res, event, 407, "", "Something on this machine tried the proxy without the session secret.");
	}
	// Step 4 — `proxy.inject.retired` (§7).
	event.status = "retired";
	if (ctx.isClosed()) return refuse(ctx, res, event, 503, "");
	const credential = ctx.credentials.get(alias);
	if (!credential || credential.retired || expired(credential.expiresAt)) {
		const notice = `The credential for "${alias}" was rotated; requests to it are refused until your next session.`;
		return refuse(ctx, res, event, 403, `The credential for "${alias}" was rotated; start a new session to use it.`, notice);
	}
	event.status = "no-route";
	// Step 5. `upstream` is an origin for an entry alias and may carry a path
	// for `model`; both are https:// by construction (03 refuses otherwise).
	const upstream = new URL(`${connector.upstream.replace(/\/$/, "")}/${parts[2] ?? ""}${mark === -1 ? "" : target.slice(mark)}`);
	event.host = upstream.hostname;
	// §6.10 logs 443, which is what every plan-time `upstream` carries (03
	// refuses anything but an https origin). The URL's own port is honoured so
	// that the conformance suite can stand a real TLS upstream in front of the
	// proxy without binding a privileged port.
	event.port = Number(upstream.port) || 443;
	// `proxy.inject.denied`: deny wins here too (P3).
	const boundary = denied(upstream.hostname, ctx.plan.deny);
	if (boundary) {
		event.status = "denied";
		return refuse(ctx, res, event, 403, `${upstream.hostname} is blocked by a boundary.`, `${upstream.hostname} refused by boundary "${boundary}".`);
	}
	// Step 6 — `proxy.inject.upgrade`: WebSockets are out of scope (§12).
	if (req.headers.upgrade) return refuse(ctx, res, event, 426, "WebSockets are not available through connectors.");
	const named = new Set(String(req.headers.connection ?? "").toLowerCase().split(",").map((n) => n.trim()));
	const headers: Record<string, string | string[]> = {};
	for (const [name, value] of Object.entries(req.headers)) {
		if (value === undefined || HOP.has(name) || NEVER.has(name) || named.has(name) || name.startsWith("proxy-")) continue;
		headers[name] = value;
	}
	headers.host = upstream.host;
	// C23's replace: the secret came in on this header, the real credential
	// goes out on it, and the inbound value is gone.
	headers[connector.attach.header.toLowerCase()] = connector.attach.prefix + credential.value;
	// Step 7. `rejectUnauthorized` is not exposed as an option and the default
	// CA store is the only one (P7, 10 rule 3).
	// No agent: `request` uses `createConnection` only when one is not set, and
	// a TLS socket is how the proxy originates the upstream leg (P9) without
	// `node:https` (§4's module list).
	const out = request({
		method: req.method,
		path: upstream.pathname + upstream.search,
		headers,
		createConnection: () => {
			const socket = connect({ host: upstream.hostname, port: event.port, servername: upstream.hostname, ALPNProtocols: ["http/1.1"] });
			socket.setTimeout(10_000, () => socket.destroy());
			socket.once("secureConnect", () => socket.setTimeout(300_000, () => socket.destroy())); // D79
			return socket;
		},
	});
	// `proxy.inject.upstream`.
	out.on("error", (error: NodeJS.ErrnoException) => {
		// The response already went, so its event is written (P6).
		if (res.headersSent) {
			res.destroy();
			return;
		}
		const unverified = /CERT|SIGNED|ALTNAME|UNABLE_TO_VERIFY/.test(error.code ?? "");
		event.status = 502;
		refuse(ctx, res, event, 502, unverified ? `Could not verify ${upstream.hostname}.` : `Could not reach ${upstream.hostname}.`, `${alias} is unreachable: ${unverified ? "its certificate could not be verified" : "the connection failed"}.`);
	});
	// Step 8: nothing is buffered, so `text/event-stream` flows chunk by chunk.
	req.on("data", (chunk: Buffer) => {
		event.bytesOut += chunk.length;
	});
	// 05 §6a (D134). A model request can ask the provider to browse or execute
	// on its own side — reach the fence never sees. Unless reach is `on`, those
	// capabilities are taken out of the body before it leaves, so the model is
	// never offered them whatever the client's settings said.
	if (alias === "model" && ctx.plan.reach.mode !== "on" && req.method === "POST") {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of req) {
			size += (chunk as Buffer).length;
			// `proxy.inject.body_too_large`: a body the shaper cannot hold is not
			// a body it can be sure it shaped, so it fails closed (I5).
			if (size > BODY_CAP) return refuse(ctx, res, event, 413, "A model request must be under 16 MiB to be inspected.");
			chunks.push(chunk as Buffer);
		}
		const body = shapeModelRequest(connector.wireFormat, Buffer.concat(chunks), ctx.plan.reach);
		if (body.stripped.length > 0) {
			// P6 as amended by D134: a shaped request writes its own event before
			// the request goes, and the request's own event follows. One row per
			// *thing that happened*, and a strip is one of them.
			ctx.log.write({ ...event, status: "stripped", reason: `stripped:${body.stripped.join(",")}`, setBy: ctx.plan.reach.setBy, bytesOut: 0, bytesIn: 0 });
			ctx.notify(`${body.stripped.join(", ")} not sent: reach is \`${ctx.plan.reach.mode}\` for this harness (set by ${ctx.plan.reach.setBy}), so the provider may not browse on its own side either.`);
		}
		delete headers["transfer-encoding"];
		headers["content-length"] = String(body.bytes.length);
		out.setHeader("content-length", body.bytes.length);
		out.removeHeader("transfer-encoding");
		out.end(body.bytes);
	} else {
		req.pipe(out);
	}
	out.on("response", (upstreamRes) => {
		event.status = upstreamRes.statusCode ?? 502; // returned as-is, 4xx and 5xx included
		const back: Record<string, string | string[]> = {};
		for (const [name, value] of Object.entries(upstreamRes.headers)) {
			if (value !== undefined && !HOP.has(name)) back[name] = value;
		}
		res.writeHead(event.status as number, back);
		res.flushHeaders();
		const tee: Buffer[] = [];
		let teed = 0;
		upstreamRes.on("data", (chunk: Buffer) => {
			event.bytesIn += chunk.length;
			// Step 9: a tee of the body, capped at 1 MiB, read after the end.
			if (alias === "model" && teed < 1_048_576) {
				tee.push(chunk);
				teed += chunk.length;
			}
		});
		upstreamRes.on("end", () => {
			if (alias === "model") event.usage = usage(Buffer.concat(tee).toString("utf8"));
			ctx.log.write(event); // Step 10
		});
		upstreamRes.pipe(res);
	});
}

/** §7.1: a lease that outlived the session is treated as retired. */
function expired(expiresAt: string | null): boolean {
	return expiresAt !== null && Date.parse(expiresAt) <= Date.now();
}

/** §8 writes the refusal before the response is sent. */
function refuse(ctx: Ctx, res: ServerResponse, event: EndpointEvent, code: number, body: string, notice?: string): void {
	ctx.log.write(event);
	if (notice) ctx.notify(notice);
	if (res.headersSent) {
		res.destroy();
		return;
	}
	const challenge = code === 407 ? { "Proxy-Authenticate": 'Basic realm="harness"' } : {};
	res.writeHead(code, { ...challenge, "Content-Type": "text/plain", "Content-Length": Buffer.byteLength(body) });
	res.end(body);
}

/**
 * D73 — step 9. Both field shapes are accepted so the plan needs no wire-format
 * field: a JSON body carries one object, an SSE body carries one per `data:`
 * line and the last one holding a `usage` object wins. A body that does not
 * parse is simply not usage; the sniff never fails a request.
 */
function usage(body: string): { input: number; output: number } | null {
	const frames: string[] = body.trimStart().startsWith("{") ? [body] : body.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5));
	for (let i = frames.length - 1; i >= 0; i--) {
		let found: Record<string, number> | undefined;
		try {
			found = JSON.parse(frames[i])?.usage;
		} catch {
			continue;
		}
		if (!found || typeof found !== "object") continue;
		return { input: found.input_tokens ?? found.prompt_tokens ?? 0, output: found.output_tokens ?? found.completion_tokens ?? 0 };
	}
	return null;
}

const BODY_CAP = 16 * 1024 * 1024;

/** 05 §6a's table, as two predicates. Anthropic names its server-side tools
    `web_search_<date>` / `web_fetch_<date>` / `code_execution_<date>`; the OpenAI
    shape names `web_search`, `web_search_preview`, `mcp` and `code_interpreter`. */
const PROVIDER_SIDE: Record<"anthropic" | "openai", RegExp> = {
	anthropic: /^(web_search|web_fetch|code_execution)/,
	openai: /^(web_search|web_search_preview|mcp|code_interpreter)$/,
};

/**
 * 05 §6a (D134) — a model request is shaped, not just routed.
 *
 * `on` is the only mode that permits provider-side browsing: an allow-list is
 * a list of hosts, and the provider's own fetch does not pass the fence, so it
 * cannot be held to one. Everything below is removed by name and the names are
 * returned, because a capability that vanished without a word is a mystery.
 *
 * A body that is not JSON is passed as it came — the provider refuses it, and
 * there is nothing in it to shape. The wire format is `connectors.model`'s,
 * which 03 sets from `Choices.model.wireFormat` (D73 is reversed for shaping,
 * kept for the usage sniff).
 */
export function shapeModelRequest(wireFormat: WireFormat | undefined, bytes: Buffer, reach: Reach): { bytes: Buffer; stripped: string[] } {
	if (reach.mode === "on") return { bytes, stripped: [] };
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString("utf8"));
	} catch {
		return { bytes, stripped: [] };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { bytes, stripped: [] };
	const body = parsed as Record<string, unknown>;
	const anthropic = wireFormat === undefined || wireFormat === "anthropic-messages" || wireFormat === "bedrock-converse";
	const shape = anthropic ? PROVIDER_SIDE.anthropic : PROVIDER_SIDE.openai;
	const stripped: string[] = [];
	if (Array.isArray(body.tools)) {
		body.tools = body.tools.filter((tool) => {
			const type = (tool as { type?: unknown })?.type;
			const provider = typeof type === "string" && shape.test(type);
			if (provider) stripped.push(type as string);
			return !provider;
		});
	}
	// The top-level keys, each the same capability by another route.
	for (const key of anthropic ? ["mcp_servers", "container"] : ["web_search_options"]) {
		if (body[key] === undefined || body[key] === null) continue;
		delete body[key];
		stripped.push(key);
	}
	if (!anthropic) {
		// OpenRouter speaks the OpenAI shape and adds two of its own: a `:online`
		// model suffix and a `web` plugin, both meaning *search before you answer*.
		if (typeof body.model === "string" && body.model.endsWith(":online")) {
			body.model = body.model.slice(0, -":online".length);
			stripped.push(":online");
		}
		if (Array.isArray(body.plugins)) {
			const kept = body.plugins.filter((plugin) => (plugin as { id?: unknown })?.id !== "web");
			if (kept.length !== body.plugins.length) stripped.push("plugins:web");
			body.plugins = kept;
		}
	}
	return stripped.length === 0 ? { bytes, stripped } : { bytes: Buffer.from(JSON.stringify(body)), stripped };
}
