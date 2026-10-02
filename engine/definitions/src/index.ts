import { accessSync, constants, existsSync, mkdirSync, rmSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { type Server as SocketServer, createServer as createSocketServer } from "node:net";
import { basename, resolve } from "node:path";
import { principal, tokenOf } from "./auth.js";
import { Refusal } from "./codes.js";
import { type Config, configFromEnv } from "./config.js";
import { indexRef, reconcile } from "./indexer.js";
import { audit, internal } from "./internal.js";
import { ZERO, changedPaths, createRepo, withLock } from "./repos.js";
import { serveGit } from "./transport.js";
import { type Update, validate } from "./validate.js";

export { configFromEnv };

export interface Servers {
	http: Server;
	hooks: SocketServer;
	close(): Promise<void>;
}

/** What the hook shims send over `DEFINITIONS_SOCK` (02 §6.3, D45). */
interface HookCall {
	phase: string;
	cwd: string;
	stdin: string;
	env: Record<string, string | undefined>;
}

const send = (response: ServerResponse, status: number, value: unknown): void => {
	response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
};

/**
 * The service (02 §4): smart-HTTP, `/internal`, and the unix socket the two
 * hook shims call back on. Nothing else answers — a route that has not been
 * written cannot be mistaken for one that does.
 */
export async function start(config: Config): Promise<Servers> {
	mkdirSync(config.root, { recursive: true });
	// D30g: the platform repository exists from M2, empty, never advertised.
	if (!existsSync(resolve(config.root, "platform.git"))) await createRepo(config.root, "platform");

	// allowHalfOpen: the shim sends its request and half-closes; without it node
	// would close our side before the answer, which is computed asynchronously.
	const hooks = createSocketServer({ allowHalfOpen: true }, (socket) => {
		const chunks: Buffer[] = [];
		socket.on("data", (chunk) => chunks.push(chunk));
		socket.on("end", () => {
			void answerHook(config, JSON.parse(Buffer.concat(chunks).toString("utf8")) as HookCall)
				// A hook that cannot answer fails the push (I5): git reads a
				// non-zero exit, and nothing lands unvalidated or unindexed.
				.catch((error: unknown) => ({ code: 1, message: String(error) }))
				.then((answer) => socket.end(JSON.stringify(answer)));
		});
	});
	rmSync(config.sock, { force: true });
	await new Promise<void>((done) => hooks.listen(config.sock, done));

	const http = createServer((request, response) => {
		void route(config, request, response).catch((error: unknown) => {
			if (error instanceof Refusal) send(response, error.status, { code: error.code, message: error.message });
			else send(response, 500, { code: "definitions.index_failed", message: String(error) });
		});
	});
	const [host, port] = config.listen.split(":");
	await new Promise<void>((done) => http.listen(Number(port), host, done));
	const reconciler = reconcile(config);

	return {
		http,
		hooks,
		close: () =>
			new Promise<void>((done) => {
				clearInterval(reconciler);
				http.close();
				hooks.close(() => done());
			}),
	};
}

async function route(config: Config, request: IncomingMessage, response: ServerResponse): Promise<void> {
	const url = new URL(request.url ?? "/", "http://definitions");

	if (request.method === "GET" && url.pathname === "/health") {
		// 02 §12: the socket, a writable root, and `api` answering.
		let api = false;
		try {
			api = (await fetch(`${config.apiUrl}/health`)).ok;
		} catch {
			api = false;
		}
		let root = true;
		try {
			accessSync(config.root, constants.W_OK);
		} catch {
			root = false;
		}
		const socket = existsSync(config.sock);
		const ok = api && root && socket;
		send(response, ok ? 200 : 503, { ok, api, root, socket });
		return;
	}

	if (url.pathname.startsWith("/internal/")) {
		// D42: a shared bearer on a private network, the same token `definitions`
		// sends outbound. A person's token never opens these.
		if (tokenOf(request.headers.authorization) !== config.serviceToken) throw new Refusal("definitions.unauthenticated", 401);
		const answer = await internal(config, request, url);
		send(response, answer.status, answer.value);
		return;
	}

	const repo = /^\/([^/]+)\.git(\/.*)$/.exec(url.pathname);
	if (!repo) {
		send(response, 404, {});
		return;
	}
	// 02 §5.2 step 1.
	const token = tokenOf(request.headers.authorization);
	if (!token) {
		const refusal = new Refusal("definitions.unauthenticated", 401);
		response
			.writeHead(401, {
				"www-authenticate": 'Bearer realm="harness", Basic realm="harness"',
				"content-type": "application/json",
			})
			.end(JSON.stringify({ code: refusal.code, message: refusal.message }));
		return;
	}
	const person = await principal(config, token);
	// Step 5: 404, not 403 — the repo's existence is not confirmed to outsiders.
	if (person.org_id !== repo[1]) {
		send(response, 404, {});
		return;
	}
	const pathInfo = `/${repo[1]}.git${repo[2]}`;
	const query = url.search.slice(1);
	// D48: one push at a time per repo, taken before receive-pack starts and
	// released when the response closes, so a refused or abandoned push holds
	// nothing — pre-receive may never reach post-receive.
	if (url.pathname.endsWith("/git-receive-pack"))
		await withLock(resolve(config.root, `${repo[1]}.git`), () => {
			serveGit(request, response, config, person, pathInfo, query);
			return new Promise<void>((done) => response.on("close", done));
		});
	else serveGit(request, response, config, person, pathInfo, query);
}

/**
 * The service half of the two shims (D45): pre-receive is §7, post-receive is
 * §8.3. Any refusal refuses the whole push, and its message is what the CLI
 * prints verbatim.
 */
async function answerHook(config: Config, call: HookCall): Promise<{ code: number; message: string }> {
	const repo = resolve(call.cwd, call.env.GIT_DIR ?? ".");
	const org = basename(repo, ".git");
	const actor = call.env.HARNESS_ACTOR ?? "";
	const updates: Update[] = call.stdin
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [old, next, ref] = line.split(" ");
			return { old, new: next, ref };
		});
	// The new objects live in receive-pack's quarantine until post-receive, so
	// validation's git calls must be pointed at it (§7).
	const env: Record<string, string> = {};
	for (const name of ["GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_QUARANTINE_PATH"])
		if (call.env[name]) env[name] = call.env[name] as string;

	let refusal: Refusal | null = null;
	try {
		for (const update of updates) {
			if (call.phase === "pre-receive") {
				await validate({ repo, org, actor, internal: false, creating: false, env, quota: config.quota }, update);
			} else {
				const paths = await changedPaths(repo, update.old, update.new);
				await audit(config, org, { event: "definitions.push", ref: update.ref, old: update.old, new: update.new, actor, paths });
				await indexRef(config, repo, org, update.ref, update.new, paths);
			}
		}
	} catch (error) {
		refusal = error instanceof Refusal ? error : new Refusal("definitions.index_failed", 500);
	}
	if (!refusal) return { code: 0, message: "" };
	if (call.phase === "pre-receive")
		await audit(config, org, {
			event: "definitions.refused",
			code: refusal.code,
			actor,
			ref: updates[0]?.ref ?? "",
			old: updates[0]?.old ?? ZERO,
		});
	return { code: 1, message: refusal.message };
}
