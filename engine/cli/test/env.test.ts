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
		const allowed = ["HOME", "PATH", "TMPDIR", "TERM", "LANG", "TZ", "HARNESS_SESSION_ID", "HARNESS_SESSION_DIR"];
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
		expect(env.NO_PROXY).toBe("127.0.0.1"); // the proxy's own host, nothing else
	});

	it("lets an adapter add keys but not override core ones", () => {
		expect(childEnvironment({ ...base, adapterEnv: { PI_TELEMETRY: "0" } }).PI_TELEMETRY).toBe("0");
		expect(() => childEnvironment({ ...base, adapterEnv: { HOME: "/evil" } })).toThrow(
			"adapter may not override core env: HOME",
		);
	});

	it("no_parent_env_leaks", () => {
		// §7's canary list, set in the parent and asserted absent from the child.
		const canaries = ["HARNESS_API_TOKEN", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "NPM_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "SSH_AUTH_SOCK"];
		for (const key of canaries) process.env[key] = `leak-${key}`;
		const env = childEnvironment({ ...base, proxyUrl: "http://:secret@127.0.0.1:1" });
		for (const key of canaries) expect(env[key]).toBeUndefined();
		expect(Object.values(env)).not.toContain("leak-GITHUB_TOKEN");
	});

	it("adapter_env_override_throws", () => {
		// A collision is a bug in the adapter, so it throws rather than blocking.
		for (const key of ["HOME", "HTTP_PROXY", "TMPDIR", "HARNESS_SESSION_SECRET"]) {
			expect(() => childEnvironment({ ...base, proxyUrl: "http://:s@127.0.0.1:1", adapterEnv: { [key]: "x" } })).toThrow(
				`adapter may not override core env: ${key}`,
			);
		}
	});

	it("carries TMPDIR and the session secret from the proxy URL (§7)", () => {
		const env = childEnvironment({ ...base, proxyUrl: "http://:sekrit@127.0.0.1:4321" });
		expect(env.TMPDIR).toBe("/tmp/s1/tmp");
		// The same secret the proxy authenticates with, read off the one URL so
		// the two cannot disagree (07 §7).
		expect(env.HARNESS_SESSION_SECRET).toBe("sekrit");
	});
});

describe("the harness environment (D30l)", () => {
	it("puts every language home inside envDir and its bins first on PATH", () => {
		const env = childEnvironment({ ...base, envDir: "/h/envs/h1" });
		expect(env.VIRTUAL_ENV).toBe("/h/envs/h1/python");
		expect(env.npm_config_prefix).toBe("/h/envs/h1/node");
		expect(env.PIP_REQUIRE_VIRTUALENV).toBe("1");
		expect(env.GOPATH).toBe("/h/envs/h1/go");
		expect(env.PATH.split(":").slice(0, 2)).toEqual(["/h/envs/h1/python/bin", "/h/envs/h1/node/bin"]);
	});
});
