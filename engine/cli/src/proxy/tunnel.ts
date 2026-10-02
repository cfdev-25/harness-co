import { promises as dns } from "node:dns";
import type { IncomingMessage } from "node:http";
import { connect, isIP, type Socket } from "node:net";
import { reachAllows } from "@harness/compose";
import type { EndpointEvent, SpawnPlan } from "@harness/compose/contracts";
import { serverName } from "./hello.js";
import type { Ctx } from "./proxy.js";

const REASON: Record<number, string> = { 400: "Bad Request", 403: "Forbidden", 407: "Proxy Authentication Required", 502: "Bad Gateway", 503: "Service Unavailable" };

/** D71: loopback, link-local, RFC 1918, CGNAT and the IPv4 "this network" block. */
const PRIVATE_V4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/** 05 §5 — `CONNECT host:port`. The steps are numbered as the document is. */
export async function tunnel(req: IncomingMessage, socket: Socket, head: Buffer, ctx: Ctx): Promise<void> {
	socket.on("error", () => socket.destroy());
	// Tracked from the first byte, not from the splice: a socket parked in the
	// SNI gate is one `close()` (§7.3) would otherwise wait on.
	ctx.tunnels.add(socket);
	socket.once("close", () => ctx.tunnels.delete(socket));
	const event: EndpointEvent = { at: new Date().toISOString(), mode: "tunnel", host: "", port: 0, status: "no-route", bytesOut: 0, bytesIn: 0 };
	// Step 1: the authority must be `host:port` with a numeric port.
	const authority = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(req.url ?? "");
	if (!authority) return refuse(ctx, socket, event, 400, "");
	// Step 4: normalise once, before anything compares against it.
	const host = authority[1].toLowerCase().replace(/\.$/, "");
	event.host = host;
	event.port = Number(authority[2]);
	// Step 2.
	if (!ctx.authenticate(req, false)) {
		return refuse(ctx, socket, { ...event, status: "bad-secret" }, 407, "", "Something on this machine tried the proxy without the session secret.");
	}
	if (ctx.isClosed()) return refuse(ctx, socket, { ...event, status: "retired" }, 503, "");
	// Step 3 — `proxy.tunnel.port` (G4). `routable` says the same thing; it is
	// checked here as well because a non-443 port never earns a DNS lookup.
	if (event.port !== 443) {
		event.reason = "port";
		return refuse(ctx, socket, event, 403, "Only port 443 is reachable through the harness.", `${host}:${event.port} refused — only 443 is open.`);
	}
	// Step 4, continued — `proxy.tunnel.ip_literal`: an address is not a name.
	const literal = host.startsWith("[") ? host.slice(1, -1) : host;
	if (isIP(literal) !== 0) {
		return refuse(ctx, socket, { ...event, status: "ip-literal" }, 403, "Connect by name, not by address.", `A connection to ${literal} was refused — addresses are not allowed.`);
	}
	// Step 5 — `proxy.tunnel.denied` (P3): a boundary is evaluated before reach
	// and before the host list, and beats both.
	const boundary = denied(host, ctx.plan.deny);
	if (boundary) {
		// D133: every refusal says why and who. A composed boundary id is
		// `<node path>/<id>` (01 §6 step 7), so the node is the part before it.
		const event_ = { ...event, status: "denied" as const, reason: "boundary", setBy: boundary.includes("/") ? boundary.slice(0, boundary.indexOf("/")) : boundary };
		return refuse(ctx, socket, event_, 403, `${host} is blocked by a boundary.`, `${host} refused by boundary "${boundary}".`);
	}
	// Step 6 — `proxy.tunnel.not_routable` (D133). One rule, and it names itself.
	const listed = ctx.plan.hosts.includes(host);
	const verdict = routable(ctx.plan, host, event.port);
	if (!verdict.ok) {
		event.reason = verdict.reason;
		event.setBy = ctx.plan.reach.setBy;
		return refuse(ctx, socket, event, 403, `${host} is not reachable from this harness: ${WHY[verdict.reason]}.`, `${host} refused — ${WHY[verdict.reason]} (set by ${ctx.plan.reach.setBy}).`);
	}
	// Step 7 — `proxy.tunnel.dns`: proxy-side, so the jail never needs a
	// resolver (06 gives it none).
	let addresses: Array<{ address: string; family: number }>;
	try {
		addresses = await dns.lookup(host, { all: true });
	} catch {
		return refuse(ctx, socket, event, 502, `Could not resolve ${host}.`);
	}
	// `proxy.tunnel.private_address` (D71): reach is not a route into the
	// customer's LAN. A host in `plan.hosts` is exempt — an admin chose it.
	if (!listed && addresses.every((a) => isPrivate(a.address, a.family))) {
		return refuse(ctx, socket, { ...event, status: "denied" }, 403, `${host} resolves to a private address.`, `${host} refused — it points inside your network.`);
	}
	// Step 8: accept without connecting upstream yet.
	socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
	// Step 9 — `proxy.tunnel.no_sni` and `proxy.tunnel.sni_mismatch` (G5). After
	// a 200 the only refusal left is closing (D72).
	const hello = await clientHello(socket, head);
	if (hello.name !== host) {
		const mismatch = typeof hello.name === "string";
		event.status = mismatch ? "sni-mismatch" : "no-sni";
		ctx.log.write(event);
		ctx.notify(mismatch ? `${host} refused — the connection was for ${hello.name}, not ${host}.` : `${host} refused — the connection did not name a server.`);
		socket.destroy();
		return;
	}
	// Step 10.
	await splice(ctx, socket, hello.buffered, addresses, event);
}

/** Why a host is not routable, in the words the person and the console share. */
const WHY: Record<Refusal, string> = {
	port: "only port 443 is open",
	"reach.off": "reach is off for this harness",
	"reach.not-listed": "it is not on the allow-list",
	"reach.denied": "it is on the deny-list",
};

type Refusal = "port" | "reach.off" | "reach.not-listed" | "reach.denied";

/**
 * D133 — the tunnel decides by rule, and says which. The whole of *may this
 * packet leave?*, minus the boundary deny list, which is checked before it
 * because a boundary beats everything (P3) and is not a reach decision.
 *
 * A host in `plan.hosts` is always routable on 443: it is there because a
 * credential is attached to it or because it is the model endpoint, and reach
 * is about the *rest* of the internet.
 */
export function routable(plan: Pick<SpawnPlan, "hosts" | "reach">, host: string, port: number): { ok: true } | { ok: false; reason: Refusal } {
	if (port !== 443) return { ok: false, reason: "port" };
	if (plan.hosts.includes(host)) return { ok: true };
	return reachAllows(plan.reach, host);
}

/** D77: an exact host or `*.suffix` — subdomains, never the apex. `:443` is ignored. */
export function denied(host: string, deny: readonly string[]): string | null {
	for (const raw of deny) {
		const pattern = raw.toLowerCase().replace(/:443$/, "");
		if (pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern) return raw;
	}
	return null;
}

function isPrivate(address: string, family: number): boolean {
	if (family === 4) return PRIVATE_V4.test(address);
	const a = address.toLowerCase().replace(/%.*$/, "");
	if (a.startsWith("::ffff:")) return PRIVATE_V4.test(a.slice(7));
	return a === "::1" || a === "::" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a); // ULA, link-local
}

/** §8 logs the refusal before the response is sent, so a crash cannot lose it. */
function refuse(ctx: Ctx, socket: Socket, event: EndpointEvent, code: number, body: string, notice?: string): void {
	ctx.log.write(event);
	if (notice) ctx.notify(notice);
	const challenge = code === 407 ? 'Proxy-Authenticate: Basic realm="harness"\r\n' : "";
	socket.end(`HTTP/1.1 ${code} ${REASON[code]}\r\n${challenge}Content-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
}

/**
 * Step 9: buffer client bytes until the first record is whole — 16 KiB or 5 s,
 * whichever comes first. `null` covers every outcome that is not a name: no
 * `server_name`, a malformed hello, a first byte that is not `0x16`, the cap,
 * the timeout, and a client that hung up.
 */
function clientHello(socket: Socket, head: Buffer): Promise<{ name: string | null; buffered: Buffer }> {
	return new Promise((resolve) => {
		let buffered = head;
		const finish = (name: string | null): void => {
			clearTimeout(timer);
			socket.off("data", onData);
			socket.off("close", hungUp);
			resolve({ name, buffered });
		};
		const hungUp = (): void => finish(null);
		const timer = setTimeout(hungUp, 5_000);
		const onData = (chunk: Buffer): void => {
			buffered = Buffer.concat([buffered, chunk]);
			let name: string | null | "incomplete";
			try {
				name = serverName(buffered);
			} catch {
				return finish(null); // hello.malformed is a no-sni
			}
			if (name !== "incomplete") return finish(name);
			if (buffered.length >= 16_384) finish(null);
		};
		socket.on("data", onData);
		socket.on("close", hungUp);
		if (buffered.length > 0) onData(Buffer.alloc(0));
	});
}

/** Step 10: first resolved address, then the rest on a connection error. */
function splice(ctx: Ctx, socket: Socket, hello: Buffer, addresses: Array<{ address: string }>, event: EndpointEvent): Promise<void> {
	return new Promise((resolve) => {
		const attempt = (i: number): void => {
			if (i >= addresses.length) {
				// `proxy.tunnel.upstream`: the status stays "no-route" and the socket
				// just closes, because the 200 has already gone out (D72).
				ctx.log.write(event);
				socket.destroy();
				return resolve();
			}
			const upstream = connect(443, addresses[i].address);
			upstream.setTimeout(10_000, () => upstream.destroy());
			upstream.on("error", () => {
				upstream.destroy();
				if (event.status === 200) return socket.destroy();
				attempt(i + 1);
			});
			upstream.once("connect", () => {
				upstream.setTimeout(0); // D79: no idle timeout on an established tunnel
				event.status = 200;
				event.bytesOut = hello.length;
				upstream.write(hello);
				socket.on("data", (chunk: Buffer) => {
					event.bytesOut += chunk.length;
				});
				upstream.on("data", (chunk: Buffer) => {
					event.bytesIn += chunk.length;
				});
				socket.pipe(upstream);
				upstream.pipe(socket);
				upstream.once("close", () => socket.end());
				socket.once("close", () => {
					ctx.log.write(event);
					resolve();
				});
			});
		};
		attempt(0);
	});
}
