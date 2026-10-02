import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:https";
import { tmpdir } from "node:os";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import type { EndpointEvent, MintedCredential } from "@harness/compose/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Proxy, type ProxyOptions, startProxy } from "../../src/proxy/proxy.js";
import { bodyOf, drain, makePki, open, type Pki, speak, statusOf, until } from "./helpers.js";
import { buildHello, sniExtension } from "./hellos.js";

const SECRET = "3Yy2mkrGm-test-session-secret-0000000000";
const VALUE = "sk-live-the-real-credential-value";
const BASIC = `Basic ${Buffer.from(`:${SECRET}`).toString("base64")}`;

let trusted: Pki;
let untrusted: Pki;
let upstreamPort = 0;
let untrustedPort = 0;
let seen: Array<{ method: string; url: string; headers: IncomingMessage["headers"] }> = [];
let reply: (req: IncomingMessage, res: ServerResponse) => void;
const running: Proxy[] = [];
const notices: string[] = [];

beforeAll(async () => {
	const dir = mkdtempSync(`${tmpdir()}/harness-pki-`);
	trusted = makePki(`${dir}/a`, 1);
	untrusted = makePki(`${dir}/b`, 2);
	// The proxy exposes no CA option and never will (10 rule 3). This is the
	// test process trusting one CA, exactly as `NODE_EXTRA_CA_CERTS` would —
	// that variable is only read at bootstrap, and the suite needs an
	// untrusted upstream in the same process for `inject_refuses_unverified_upstream`.
	setDefaultCACertificates([...getCACertificates("default"), trusted.ca]);
	const upstream = createServer({ key: trusted.key, cert: trusted.cert }, (req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
			reply(req, res);
		});
	});
	const rogue = createServer({ key: untrusted.key, cert: untrusted.cert }, (_req, res) => res.end("no"));
	await Promise.all([
		new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done)),
		new Promise<void>((done) => rogue.listen(0, "127.0.0.1", done)),
	]);
	upstreamPort = (upstream.address() as { port: number }).port;
	untrustedPort = (rogue.address() as { port: number }).port;
});

afterEach(async () => {
	for (const proxy of running.splice(0)) await proxy.close();
	seen = [];
	notices.length = 0;
});

/** D131: the two reaches these tests need. `off` is the default plan's. */
const OFF = { mode: "off" as const, hosts: [], setBy: "acme" };
const ON = { mode: "on" as const, hosts: [], setBy: "acme" };

function credential(alias: string, expiresAt: string | null = null): MintedCredential {
	return { alias, value: VALUE, kind: "minted", expiresAt, resolvedFrom: { source: "vault", vault: "v", group: "g", grant: "gr" }, evidence: "verified" };
}

async function start(overrides: Partial<ProxyOptions> = {}): Promise<{ proxy: Proxy; port: number; dir: string; events: () => EndpointEvent[] }> {
	const dir = mkdtempSync(`${tmpdir()}/hp-`);
	reply ??= (_req, res) => res.end("ok");
	const proxy = await startProxy({
		plan: { hosts: ["localhost"], deny: [], reach: OFF, connectors: { api: { upstream: `https://localhost:${upstreamPort}`, attach: { header: "Authorization", prefix: "Bearer " } } } },
		credentials: [credential("api")],
		secret: SECRET,
		sessionDir: dir,
		listen: { kind: "tcp" },
		notify: (message) => notices.push(message),
		...overrides,
	});
	running.push(proxy);
	return {
		proxy,
		port: Number(new URL(proxy.url).port),
		dir,
		events: () =>
			readFileSync(`${dir}/endpoints.jsonl`, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as EndpointEvent),
	};
}

/** A `CONNECT` with the secret, returning the socket and the proxy's answer. */
async function connectTo(port: number, authority: string, secret = SECRET) {
	const socket = await open(port);
	socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Authorization: Basic ${Buffer.from(`:${secret}`).toString("base64")}\r\n\r\n`);
	const head = await until(socket, "\r\n\r\n");
	return { socket, head };
}

// -- Tunnel mode (05 §5) ----------------------------------------------------

describe("tunnel", () => {
	it("tunnel_refuses_non_443", async () => {
		const { port, events } = await start();
		const { head } = await connectTo(port, "localhost:8080");
		expect(statusOf(head)).toBe(403);
		expect(bodyOf(head)).toBe("Only port 443 is reachable through the harness.");
		expect(events()[0]).toMatchObject({ mode: "tunnel", host: "localhost", port: 8080, status: "no-route" });
		expect(notices).toContain("localhost:8080 refused — only 443 is open.");
	});

	it("tunnel_refuses_ip_literal", async () => {
		const { port, events } = await start({ plan: { hosts: [], deny: [], reach: ON, connectors: {} } });
		const { head } = await connectTo(port, "93.184.216.34:443");
		expect(statusOf(head)).toBe(403);
		expect(bodyOf(head)).toBe("Connect by name, not by address.");
		expect(events()[0].status).toBe("ip-literal");
	});

	it("tunnel_refuses_sni_mismatch", async () => {
		const { port, events } = await start();
		const { socket, head } = await connectTo(port, "localhost:443");
		expect(statusOf(head)).toBe(200);
		socket.write(buildHello(sniExtension("api.stripe.com")));
		await new Promise<void>((done) => socket.once("close", done));
		expect(events()[0].status).toBe("sni-mismatch");
		expect(notices).toContain("localhost refused — the connection was for api.stripe.com, not localhost.");
	});

	it("tunnel_refuses_no_sni", async () => {
		const { port, events } = await start();
		const { socket, head } = await connectTo(port, "localhost:443");
		expect(statusOf(head)).toBe(200);
		socket.write(buildHello(null));
		await new Promise<void>((done) => socket.once("close", done));
		expect(events()[0].status).toBe("no-sni");
		expect(notices).toContain("localhost refused — the connection did not name a server.");
	});

	it("tunnel_allows_listed_host", async () => {
		// The splice itself cannot be exercised locally: §5.10 connects to port
		// 443, which no unprivileged process may bind on either CI runner. What
		// is asserted is every decision up to it — the 200, a matching hello
		// accepted by the SNI gate — and that step 10 was reached and found
		// nothing listening on 127.0.0.1:443.
		const { port, events } = await start();
		const { socket, head } = await connectTo(port, "localhost:443");
		expect(head).toContain("HTTP/1.1 200 Connection Established");
		socket.write(buildHello(sniExtension("localhost")));
		await new Promise<void>((done) => socket.once("close", done));
		expect(events()[0]).toMatchObject({ mode: "tunnel", host: "localhost", port: 443, status: "no-route" });
		expect(notices).toEqual([]);
	});

	it("tunnel_refuses_unlisted_host_when_reach_is_off", async () => {
		const { port, events } = await start();
		const { head } = await connectTo(port, "nowhere.invalid:443");
		expect(statusOf(head)).toBe(403);
		// D133: the refusal says which rule refused it, and who owns that rule.
		expect(bodyOf(head)).toBe("nowhere.invalid is not reachable from this harness: reach is off for this harness.");
		expect(events()[0]).toMatchObject({ status: "no-route", reason: "reach.off", setBy: "acme" });
	});

	it("tunnel_allows_unlisted_host_when_reach_is_on", async () => {
		// The allow decision is what is under test; the same host that reach
		// `off` refuses with a 403 gets past step 6 under `on` and fails later,
		// at DNS.
		const { port } = await start({ plan: { hosts: [], deny: [], reach: ON, connectors: {} } });
		const { head } = await connectTo(port, "nowhere.invalid:443");
		expect(statusOf(head)).not.toBe(403);
	});

	it("tunnel_refuses_a_host_on_the_deny_list_under_reach_on", async () => {
		const reach = { mode: "on" as const, hosts: ["*.nowhere.invalid"], setBy: "acme.marketing" };
		const { port, events } = await start({ plan: { hosts: [], deny: [], reach, connectors: {} } });
		const { head } = await connectTo(port, "sub.nowhere.invalid:443");
		expect(statusOf(head)).toBe(403);
		expect(events()[0]).toMatchObject({ reason: "reach.denied", setBy: "acme.marketing" });
	});

	it("tunnel_refuses_a_host_off_the_allow_list", async () => {
		const reach = { mode: "allow" as const, hosts: ["pypi.org"], setBy: "acme.marketing" };
		const { port, events } = await start({ plan: { hosts: [], deny: [], reach, connectors: {} } });
		expect(statusOf((await connectTo(port, "nowhere.invalid:443")).head)).toBe(403);
		expect(events()[0]).toMatchObject({ reason: "reach.not-listed", setBy: "acme.marketing" });
	});

	it("deny_beats_reach", async () => {
		const { port, events } = await start({ plan: { hosts: [], deny: ["localhost"], reach: ON, connectors: {} } });
		const { head } = await connectTo(port, "localhost:443");
		expect(statusOf(head)).toBe(403);
		expect(bodyOf(head)).toBe("localhost is blocked by a boundary.");
		expect(events()[0].status).toBe("denied");
	});

	it("deny_wildcard_matches_subdomain_not_apex", async () => {
		const { port, events } = await start({ plan: { hosts: [], deny: ["*.nowhere.invalid"], reach: ON, connectors: {} } });
		expect(bodyOf((await connectTo(port, "sub.nowhere.invalid:443")).head)).toBe("sub.nowhere.invalid is blocked by a boundary.");
		expect(statusOf((await connectTo(port, "nowhere.invalid:443")).head)).not.toBe(403);
		expect(events().map((e) => e.status)).toEqual(["denied", "no-route"]);
	});

	it("private_address_refused_under_reach", async () => {
		const { port, events } = await start({ plan: { hosts: [], deny: [], reach: ON, connectors: {} } });
		const { head } = await connectTo(port, "localhost:443");
		expect(statusOf(head)).toBe(403);
		expect(bodyOf(head)).toBe("localhost resolves to a private address.");
		expect(events()[0].status).toBe("denied");
		expect(notices).toContain("localhost refused — it points inside your network.");
	});

	it("listed_private_address_allowed", async () => {
		// D71's exemption: an admin listed it.
		const { port } = await start();
		const { head } = await connectTo(port, "localhost:443");
		expect(head).toContain("200 Connection Established");
	});
});

// -- Inject mode (05 §6) ----------------------------------------------------

describe("inject", () => {
	const get = (port: number, path: string, headers: string[] = [`Authorization: Bearer ${SECRET}`]) =>
		speak(port, [`GET ${path} HTTP/1.1`, "Host: proxy", "Connection: close", ...headers]);

	it("inject_replaces_authorization", async () => {
		const { port } = await start();
		const response = await get(port, "/connectors/api/v1/charges");
		expect(statusOf(response)).toBe(200);
		expect(seen[0].headers.authorization).toBe(`Bearer ${VALUE}`);
		expect(seen[0].url).toBe("/v1/charges");
		expect(seen[0].headers.host).toBe(`localhost:${upstreamPort}`);
	});

	it("inject_accepts_x_api_key_carrier", async () => {
		const { port } = await start({
			plan: { hosts: [], deny: [], reach: OFF, connectors: { api: { upstream: `https://localhost:${upstreamPort}`, attach: { header: "x-api-key", prefix: "" } } } },
		});
		const response = await get(port, "/connectors/api/v1/ping", [`x-api-key: ${SECRET}`]);
		expect(statusOf(response)).toBe(200);
		expect(seen[0].headers["x-api-key"]).toBe(VALUE);
	});

	const modelPlan = (reach: typeof OFF) => ({
		hosts: [] as string[],
		deny: [],
		reach,
		connectors: { model: { upstream: `https://localhost:${upstreamPort}`, attach: { header: "x-api-key", prefix: "" }, wireFormat: "anthropic-messages" as const } },
	});

	it("inject_shapes_the_model_request_unless_reach_is_on", async () => {
		// 05 §6a (D134): the provider's own browsing happens on its side of the
		// model call, so the capability never leaves the machine — and an
		// allow-list cannot hold a fetch the fence never sees, so `allow` strips
		// too. Three routes to the same thing, and one event naming all three.
		const { port, dir } = await start({ plan: modelPlan({ mode: "allow", hosts: ["pypi.org"], setBy: "acme.marketing" }), credentials: [credential("model")] });
		const body = JSON.stringify({
			model: "m",
			tools: [{ type: "web_search_20250305", name: "web_search" }, { name: "calc", input_schema: {} }],
			mcp_servers: [{ url: "https://mcp.example" }],
			container: { id: "c1" },
		});
		const response = await fetch(`http://127.0.0.1:${port}/connectors/model/v1/messages`, { method: "POST", headers: { "x-api-key": SECRET, "content-type": "application/json" }, body });
		expect(response.status).toBe(200);
		const forwarded = JSON.parse(seen[0].body ?? "{}") as { tools: Array<{ name: string }>; mcp_servers?: unknown; container?: unknown };
		expect(forwarded.tools.map((tool) => tool.name)).toEqual(["calc"]);
		expect(forwarded.mcp_servers).toBeUndefined();
		expect(forwarded.container).toBeUndefined();
		expect(seen[0].headers["content-length"]).toBe(String(Buffer.byteLength(seen[0].body ?? "")));
		expect(notices.join(" ")).toContain("web_search_20250305, mcp_servers, container not sent");
		const stripped = readFileSync(`${dir}/endpoints.jsonl`, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as EndpointEvent).find((event) => event.status === "stripped");
		expect(stripped).toMatchObject({ mode: "inject", host: "localhost", reason: "stripped:web_search_20250305,mcp_servers,container", setBy: "acme.marketing" });
	});

	it("inject_leaves_the_model_request_alone_when_reach_is_on", async () => {
		const { port } = await start({ plan: modelPlan(ON), credentials: [credential("model")] });
		const body = JSON.stringify({ tools: [{ type: "web_search_20250305", name: "web_search" }], mcp_servers: [{ url: "https://mcp.example" }] });
		await fetch(`http://127.0.0.1:${port}/connectors/model/v1/messages`, { method: "POST", headers: { "x-api-key": SECRET, "content-type": "application/json" }, body });
		const forwarded = JSON.parse(seen[0].body ?? "{}") as { tools: unknown[]; mcp_servers: unknown[] };
		expect(forwarded.tools).toHaveLength(1);
		expect(forwarded.mcp_servers).toHaveLength(1);
	});

	it("inject_strips_cookie", async () => {
		const { port } = await start();
		await get(port, "/connectors/api/x", [`Authorization: Bearer ${SECRET}`, "Cookie: session=abc"]);
		expect(seen[0].headers.cookie).toBeUndefined();
	});

	it("inject_strips_method_override", async () => {
		const { port } = await start();
		await get(port, "/connectors/api/x", [`Authorization: Bearer ${SECRET}`, "X-HTTP-Method-Override: DELETE"]);
		expect(seen[0].headers["x-http-method-override"]).toBeUndefined();
	});

	it("inject_refuses_unknown_alias", async () => {
		const { port, events } = await start();
		const response = await get(port, "/connectors/crm/x");
		expect(statusOf(response)).toBe(404);
		expect(bodyOf(response)).toBe('No connector named "crm" in this session.');
		expect(events()[0].status).toBe("no-route");
		expect(notices).toContain('Something asked for a connector "crm" this session does not have.');
	});

	it("inject_refuses_retired_alias", async () => {
		const { proxy, port, events } = await start();
		expect(statusOf(await get(port, "/connectors/api/x"))).toBe(200);
		proxy.retire("api");
		const response = await get(port, "/connectors/api/x");
		expect(statusOf(response)).toBe(403);
		expect(bodyOf(response)).toBe('The credential for "api" was rotated; start a new session to use it.');
		expect(events()[1].status).toBe("retired");
	});

	it("inject_refuses_expired_credential", async () => {
		const { port } = await start({ credentials: [credential("api", new Date(Date.now() - 1000).toISOString())] });
		expect(statusOf(await get(port, "/connectors/api/x"))).toBe(403);
	});

	it("inject_refuses_absolute_form", async () => {
		const { port, events } = await start();
		const response = await get(port, "http://localhost/connectors/api/x");
		expect(statusOf(response)).toBe(400);
		expect(bodyOf(response)).toBe("Use the connector path, not a full URL.");
		expect(events()[0].status).toBe("no-route");
	});

	it("inject_refuses_upgrade", async () => {
		const { port } = await start();
		const response = await speak(port, ["GET /connectors/api/x HTTP/1.1", "Host: proxy", `Authorization: Bearer ${SECRET}`, "Connection: close, Upgrade", "Upgrade: websocket"]);
		expect(statusOf(response)).toBe(426);
		expect(bodyOf(response)).toBe("WebSockets are not available through connectors.");
	});

	it("inject_refuses_unverified_upstream", async () => {
		const { port } = await start({
			plan: { hosts: [], deny: [], reach: OFF, connectors: { api: { upstream: `https://localhost:${untrustedPort}`, attach: { header: "Authorization", prefix: "Bearer " } } } },
		});
		const response = await get(port, "/connectors/api/x");
		expect(statusOf(response)).toBe(502);
		expect(bodyOf(response)).toBe("Could not verify localhost.");
		expect(seen).toEqual([]);
	});

	it("inject_returns_upstream_status_unchanged", async () => {
		reply = (_req, res) => {
			res.writeHead(429, { "Content-Type": "application/json" });
			res.end('{"error":"slow down"}');
		};
		const { port, events } = await start();
		const response = await get(port, "/connectors/api/x");
		reply = (_req, res) => res.end("ok");
		expect(statusOf(response)).toBe(429);
		expect(bodyOf(response)).toBe('{"error":"slow down"}');
		expect(events()[0].status).toBe(429);
	});

	it("sse_streams_without_buffering", async () => {
		let release = () => {};
		const closed = new Promise<void>((done) => {
			release = done;
		});
		reply = (_req, res) => {
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			res.write('data: {"type":"message_start"}\n\n');
			closed.then(() => {
				res.write('data: {"usage":{"input_tokens":11,"output_tokens":22}}\n\n');
				res.end();
			});
		};
		const { port, events } = await start({
			plan: { hosts: [], deny: [], reach: OFF, connectors: { model: { upstream: `https://localhost:${upstreamPort}/api/v1`, attach: { header: "Authorization", prefix: "Bearer " } } } },
			credentials: [credential("model")],
		});
		const socket = await open(port);
		const whole = drain(socket);
		socket.write(`GET /connectors/model/messages HTTP/1.1\r\nHost: proxy\r\nConnection: close\r\nAuthorization: Bearer ${SECRET}\r\n\r\n`);
		// The first event must arrive while the upstream response is still open.
		await until(socket, "message_start");
		release();
		await whole;
		reply = (_req, res) => res.end("ok");
		expect(seen[0].url).toBe("/api/v1/messages");
		// D73: usage sniffed from the last SSE frame that carries one.
		expect(events()[0].usage).toEqual({ input: 11, output: 22 });
	});
});

// -- Authentication, the log, and the two verbs ------------------------------

describe("the fence", () => {
	it("bad_secret_407_no_body", async () => {
		const { port, events } = await start();
		const tunnelled = await connectTo(port, "localhost:443", "wrong");
		expect(statusOf(tunnelled.head)).toBe(407);
		expect(tunnelled.head).toContain('Proxy-Authenticate: Basic realm="harness"');
		expect(bodyOf(tunnelled.head)).toBe("");
		const injected = await speak(port, ["GET /connectors/api/x HTTP/1.1", "Host: proxy", "Connection: close", "Authorization: Bearer wrong"]);
		expect(statusOf(injected)).toBe(407);
		expect(bodyOf(injected)).toBe("");
		expect(events().map((e) => e.status)).toEqual(["bad-secret", "bad-secret"]);
		// §4.3: the person is told once per session, not once per probe.
		expect(notices).toEqual(["Something on this machine tried the proxy without the session secret."]);
	});

	it("every_request_logged_including_refusals", async () => {
		const { port, events } = await start();
		await speak(port, ["GET /connectors/api/ok HTTP/1.1", "Host: proxy", "Connection: close", `Authorization: Bearer ${SECRET}`]);
		await speak(port, ["GET /connectors/nope/x HTTP/1.1", "Host: proxy", "Connection: close", `Authorization: Bearer ${SECRET}`]);
		await connectTo(port, "localhost:25");
		expect(events()).toHaveLength(3);
		expect(events().map((e) => e.mode)).toEqual(["inject", "inject", "tunnel"]);
	});

	it("log_has_no_query_string", async () => {
		const { port, dir, events } = await start();
		await speak(port, ["GET /connectors/api/v1/x?token=supersecret&q=1 HTTP/1.1", "Host: proxy", "Connection: close", `Authorization: Bearer ${SECRET}`]);
		expect(events()[0].path).toBe("/connectors/api/v1/x");
		expect(readFileSync(`${dir}/endpoints.jsonl`, "utf8")).not.toContain("supersecret");
		// The query still reaches the upstream — it is the log that drops it (D74).
		expect(seen[0].url).toBe("/v1/x?token=supersecret&q=1");
	});

	it("values_never_in_log_or_body", async () => {
		const { port, dir } = await start();
		const response = await speak(port, ["GET /connectors/api/x HTTP/1.1", "Host: proxy", "Connection: close", `Authorization: Bearer ${SECRET}`]);
		const refusal = await speak(port, ["GET /connectors/api/x HTTP/1.1", "Host: proxy", "Connection: close", "Authorization: Bearer wrong"]);
		expect(readFileSync(`${dir}/endpoints.jsonl`, "utf8")).not.toContain(VALUE);
		expect(response).not.toContain(VALUE);
		expect(refusal).not.toContain(VALUE);
		expect(notices.join("\n")).not.toContain(VALUE);
	});

	it("retire_takes_effect_on_next_request", async () => {
		const { proxy, port } = await start();
		proxy.retire("api");
		expect(statusOf(await speak(port, ["GET /connectors/api/x HTTP/1.1", "Host: proxy", "Connection: close", `Authorization: Bearer ${SECRET}`]))).toBe(403);
	});

	it("closed_proxy_refuses_all", async () => {
		const { proxy, port } = await start();
		// A tunnel parked in the SNI gate must not hold the close open (§7.3).
		await connectTo(port, "localhost:443");
		const began = Date.now();
		await proxy.close();
		expect(Date.now() - began).toBeLessThan(2_000);
		// §7.3 closes the listener, so the refusal a caller meets is the absence
		// of one; the 503 branch is the race with a connection already accepted.
		await expect(open(port)).rejects.toMatchObject({ code: "ECONNREFUSED" });
	});

	it("close_twice_is_harmless", async () => {
		const { proxy } = await start();
		await proxy.close();
		await expect(proxy.close()).resolves.toBeUndefined();
	});

	it("tally_groups_by_host_port_alias", async () => {
		const { proxy, port } = await start();
		await speak(port, ["GET /connectors/api/a HTTP/1.1", "Host: proxy", "Connection: close", `Authorization: Bearer ${SECRET}`]);
		await speak(port, ["GET /connectors/api/b HTTP/1.1", "Host: proxy", "Connection: close", `Authorization: Bearer ${SECRET}`]);
		await connectTo(port, "localhost:25");
		const tally = proxy.tally();
		expect(tally).toHaveLength(2);
		expect(tally).toContainEqual(expect.objectContaining({ host: "localhost", port: upstreamPort, alias: "api", count: 2, refused: 0 }));
		expect(tally).toContainEqual(expect.objectContaining({ host: "localhost", port: 25, alias: undefined, count: 1, refused: 1 }));
	});

	it("unix_socket_listener_requires_secret", async () => {
		// §4.1 / D75. The socket is a file, so `0600` narrows it to the user and
		// the secret narrows it to this session (G6, belt and braces).
		const dir = mkdtempSync(`${tmpdir()}/hp-`);
		const path = `${dir}/proxy.sock`;
		const { port } = await start({ sessionDir: dir, listen: { kind: "unix", path, port: 45678 } });
		expect(port).toBe(45678);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		const refused = await speak(path, ["GET /connectors/api/x HTTP/1.1", "Host: proxy", "Connection: close"]);
		expect(statusOf(refused)).toBe(407);
		const allowed = await speak(path, ["GET /connectors/api/x HTTP/1.1", "Host: proxy", "Connection: close", `Proxy-Authorization: ${BASIC}`]);
		expect(statusOf(allowed)).toBe(200);
	});
});
