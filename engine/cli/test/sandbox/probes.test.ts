import { type Server, createServer } from "node:net";
import { platform } from "node:process";
import { describe, expect, it } from "vitest";
import { probeSandbox } from "../../src/sandbox/probes.js";
import { type Fixture, blockerOf, fixture, insideAsync } from "./support.js";

const SECRET = "session-secret-4f2a";

/** A stub of 05's proxy: a loopback listener that answers only a request
    carrying the session secret. On macOS this is exactly what the real proxy
    is — a port on 127.0.0.1 — so the probe reaches it the same way. */
async function stubProxy(): Promise<{ server: Server; port: number }> {
	const server = createServer((socket) => {
		socket.on("data", (chunk) => {
			const answer = chunk.includes(SECRET) ? "HTTP/1.1 200 OK\r\n\r\nproxied" : "HTTP/1.1 407 \r\n\r\n";
			socket.end(answer);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (typeof address === "string" || address === null) throw new Error("stub proxy has no port");
	return { server, port: address.port };
}

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

describe.skipIf(platform !== "darwin")("the probes", () => {
	it("proxy_reachable_from_inside", async () => {
		const { server, port } = await stubProxy();
		const f: Fixture = fixture({ proxyPort: port });
		try {
			const request = `const s=require("node:net").connect(${port},"127.0.0.1");s.on("connect",()=>s.write("GET http://example.test/ HTTP/1.1\\r\\nProxy-Authorization: ${SECRET}\\r\\n\\r\\n"));s.on("data",(d)=>{console.log(d.includes("proxied")?"OPEN":"REFUSED");process.exit(0)});s.on("error",(e)=>{console.log("SHUT",e.code);process.exit(0)})`;
			expect(await insideAsync(f, request)).toContain("OPEN");
			// And it is the *only* loopback port reachable: another one is not.
			const other = await stubProxy();
			try {
				const elsewhere = `const s=require("node:net").connect(${other.port},"127.0.0.1");s.on("connect",()=>{console.log("OPEN");process.exit(0)});s.on("error",(e)=>{console.log("SHUT",e.code);process.exit(0)})`;
				expect(await insideAsync(f, elsewhere)).toContain("SHUT");
			} finally {
				await close(other.server);
			}
		} finally {
			await close(server);
		}
	}, 30_000);

	it("six probes pass under the real profile", async () => {
		const { server, port } = await stubProxy();
		const f = fixture({ proxyPort: port });
		try {
			await expect(probeSandbox(f.plan, f.session)).resolves.toBeUndefined();
		} finally {
			await close(server);
		}
	}, 60_000);

	it("unexpected_success_aborts_boot", async () => {
		const { server, port } = await stubProxy();
		const f = fixture({ proxyPort: port });
		f.plan.filesystem.denyRead = []; // the deny set deliberately emptied
		let thrown: unknown;
		let resolved = true;
		try {
			await probeSandbox(f.plan, f.session);
		} catch (error) {
			thrown = error;
			resolved = false;
		} finally {
			await close(server);
		}
		// The boot ends here: `08` never reaches its spawn, so no provider pid
		// exists to assert against — `probeSandbox` did not return.
		expect(resolved).toBe(false);
		expect(blockerOf(thrown).code).toBe("sandbox.probe_unexpected_success");
		expect(blockerOf(thrown).message).toBe(
			"The sandbox self-test for read succeeded when it should have been refused. The jail does not hold on this machine, so no session will start.",
		);
		expect(blockerOf(thrown).remedy).toBe(
			"Run `harness preflight sandbox` and send its output to your administrator. Nothing you can change will make this session safe.",
		);
	}, 60_000);
});
