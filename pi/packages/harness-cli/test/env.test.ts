import { afterEach, describe, expect, it } from "vitest";
import { childEnvironment } from "../src/env.js";

const saved = { ...process.env };
afterEach(() => {
	process.env = { ...saved };
});

const base = { sessionId: "s1", sessionDir: "/tmp/s1", adapterEnv: {} };

describe("childEnvironment", () => {
	it("passes nothing through that was not asked for", () => {
		process.env.AWS_SECRET_ACCESS_KEY = "leak";
		process.env.GITHUB_TOKEN = "leak";
		process.env.HARNESS_API_TOKEN = "leak";
		const env = childEnvironment(base);
		expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
		expect(env.GITHUB_TOKEN).toBeUndefined();
		expect(env.HARNESS_API_TOKEN).toBeUndefined();
		// Nothing beyond the fixed allowlist may appear.
		const allowed = ["HOME", "PATH", "TERM", "LANG", "TZ", "HARNESS_SESSION_ID", "HARNESS_SESSION_DIR"];
		expect(Object.keys(env).filter((key) => !allowed.includes(key))).toEqual([]);
	});

	it("keeps HOME verbatim and filters PATH to system directories", () => {
		process.env.HOME = "/Users/me";
		process.env.PATH = ["/usr/bin", "/Users/me/.local/bin", "/opt/homebrew/bin", "/tmp/evil"].join(":");
		const env = childEnvironment(base);
		expect(env.HOME).toBe("/Users/me");
		expect(env.PATH.split(":")).toEqual(["/usr/bin", "/opt/homebrew/bin"]);
	});

	it("adds proxy variables only when a proxy is given", () => {
		expect(childEnvironment(base).HTTP_PROXY).toBeUndefined();
		const env = childEnvironment({ ...base, proxyUrl: "http://:s@127.0.0.1:1/" });
		expect(env.HTTP_PROXY).toBe("http://:s@127.0.0.1:1/");
		expect(env.HTTPS_PROXY).toBe("http://:s@127.0.0.1:1/");
		expect(env.NO_PROXY).toBe("");
	});

	it("lets an adapter add keys but not override core ones", () => {
		expect(childEnvironment({ ...base, adapterEnv: { PI_TELEMETRY: "0" } }).PI_TELEMETRY).toBe("0");
		expect(() => childEnvironment({ ...base, adapterEnv: { HOME: "/evil" } })).toThrow(
			"adapter may not override core env: HOME",
		);
	});
});
