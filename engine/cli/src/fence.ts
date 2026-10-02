import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { platform } from "node:process";
import type { MintedCredential, SpawnPlan } from "@harness/compose/contracts";
import { type Proxy, startProxy } from "./proxy/proxy.js";

export interface Fence {
	url: string;
	port: number;
	start(plan: SpawnPlan, credentials: MintedCredential[]): Promise<Proxy>;
}

/** A free loopback port, released immediately so the proxy can take it. */
function allocatePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address() as { port: number };
			probe.close(() => resolve(port));
		});
	});
}

/**
 * Boot row 8, prepared at row 0. The port and the secret exist **before** the
 * plan is built, because `render` writes the URL into the provider's config and
 * the plan names it (03 `PlanContext.proxyUrl`); the listener itself is not
 * bound until row 8, after render and before the probes.
 */
export async function prepareFence(sessionDir: string, notify: (line: string) => void): Promise<Fence> {
	const port = await allocatePort();
	const secret = randomBytes(32).toString("base64url");
	return {
		url: `http://harness:${secret}@127.0.0.1:${port}`,
		port,
		start: (plan, credentials) =>
			startProxy({
				plan,
				credentials,
				secret,
				sessionDir,
				// 06: macOS reaches the listener on loopback; Linux's jail has no
				// network namespace of its own but a bound-in socket, and the
				// forwarder inside it answers on the same port number.
				listen: platform === "linux" ? { kind: "unix", path: join(sessionDir, "proxy.sock"), port } : { kind: "tcp", port },
				notify,
			}),
	};
}
