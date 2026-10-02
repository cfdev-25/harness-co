import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Principal } from "../src/auth.js";

/**
 * A local stand-in for `api`'s four internal endpoints. 10 rule 17 allows a
 * mock only at the network edge to `api`, and rule 17 also says its shape is
 * checked against 00 §4.10 — every path, header and body below is that table.
 */
export interface FakeApi {
	url: string;
	token: string;
	/** token -> what `GET /v1/internal/principal` answers. */
	principals: Map<string, Principal>;
	/** tokens the fake answers 401 for; anything unknown is also 401. */
	index: Array<{ org: string; ref: string; commit: string; rows?: unknown; stale?: { error: string } }>;
	audit: Array<{ org: string; events: Array<Record<string, unknown>> }>;
	policyChanged: Array<{ org: string; refs: Array<{ ref: string; commit: string; paths: string[] }> }>;
	principalCalls: number;
	/** When set, `POST /v1/internal/index` answers 500 for a non-stale write. */
	failIndex: boolean;
	/** When set, `GET /v1/internal/principal` answers 500 (02 §5.2 step 3). */
	failPrincipal: boolean;
	server: Server;
	close(): Promise<void>;
}

export async function fakeApi(): Promise<FakeApi> {
	const fake: FakeApi = {
		url: "",
		token: "service-token",
		principals: new Map(),
		index: [],
		audit: [],
		policyChanged: [],
		principalCalls: 0,
		failIndex: false,
		failPrincipal: false,
		server: undefined as unknown as Server,
		close: async () => undefined,
	};

	const server = createServer((request, response) => {
		void (async () => {
			const url = new URL(request.url ?? "/", "http://api");
			const reply = (status: number, value: unknown = {}) =>
				response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));

			if (url.pathname === "/health") return reply(200, { ok: true });
			if (request.headers.authorization !== `Bearer ${fake.token}`) return reply(401, {});

			if (url.pathname === "/v1/internal/principal") {
				fake.principalCalls += 1;
				if (fake.failPrincipal) return reply(500, {});
				const person = fake.principals.get(String(request.headers["x-harness-token"]));
				return person ? reply(200, person) : reply(401, {});
			}

			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(chunk as Buffer);
			const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

			if (url.pathname === "/v1/internal/index") {
				// A rejected write records nothing: `api` performs it in one
				// transaction (02 §8.3 step 5), so a failure left no rows behind.
				if (fake.failIndex && !body.stale) return reply(500, {});
				fake.index.push(body);
				return reply(204);
			}
			if (url.pathname === "/v1/internal/audit") {
				fake.audit.push(body);
				return reply(204);
			}
			if (url.pathname === "/v1/internal/policy-changed") {
				fake.policyChanged.push(body);
				return reply(204);
			}
			return reply(404, {});
		})();
	});

	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	fake.server = server;
	fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	fake.close = () => new Promise<void>((done) => server.close(() => done()));
	return fake;
}
