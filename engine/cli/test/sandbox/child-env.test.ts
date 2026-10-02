import { execFileSync } from "node:child_process";
import { platform } from "node:process";
import type { MintedCredential } from "@harness/compose/contracts";
import { describe, expect, it } from "vitest";
import { childEnvironment } from "../../src/env.js";
import { confine } from "../../src/sandbox/confine.js";
import { fixture } from "./support.js";

/** What the broker returned for this session — values the jail must never see. */
const minted: MintedCredential[] = [
	{ alias: "anthropic-api-key", value: "sk-ant-REAL-SECRET-0123456789", kind: "stored", expiresAt: null, resolvedFrom: { source: "vault", vault: "bundled", group: "g", grant: "gr" }, evidence: "verified" },
	{ alias: "crm", value: "crm-TOKEN-abcdefghij", kind: "minted", expiresAt: null, resolvedFrom: { source: "vault", vault: "bundled", group: "g", grant: "gr" }, evidence: "verified" },
];

describe.skipIf(platform !== "darwin" && platform !== "linux")("no_key_in_child_env (T3, §7 / 07 DoD)", () => {
	it("prints its own environment from inside the jail and holds no credential value", () => {
		const f = fixture();
		const secret = "s3cr3t-session-value";
		const proxyUrl = `http://:${secret}@127.0.0.1:${f.session.proxyPort}`;
		// The same two calls `spawnConfined` makes, in the same order, so what this
		// observes is the environment the provider is actually given (§8 steps 1–3).
		const env = childEnvironment({ sessionId: "s1", sessionDir: f.session.dir, proxyUrl, adapterEnv: { PI_TELEMETRY: "0" } });
		const plan = { ...f.plan, env };
		const { command, args } = confine(plan, ["/usr/bin/env"], f.session);

		const printed = execFileSync(command, args, { env, encoding: "utf8", timeout: 10_000 });
		const values = printed
			.split("\n")
			.filter((line) => line.includes("="))
			.map((line) => line.slice(line.indexOf("=") + 1));

		// No minted credential's value appears anywhere in the child's environment.
		for (const credential of minted) {
			expect(printed).not.toContain(credential.value);
			expect(values).not.toContain(credential.value);
		}
		// Nor does the login token, nor any control-plane URL.
		expect(printed).not.toContain("the-login-token");
		expect(printed).not.toMatch(/HARNESS_API|API_URL/);
		// The one secret that is present is the session's own, which is worth
		// nothing outside this session's proxy (05 §4.2).
		expect(printed).toContain(`HARNESS_SESSION_SECRET=${secret}`);
		expect(values.filter((value) => value === secret)).toHaveLength(1);
		// And the allowlist is exactly §7's table.
		const keys = printed.split("\n").filter((line) => line.includes("=")).map((line) => line.slice(0, line.indexOf("=")));
		const allowed = ["HOME", "PATH", "TMPDIR", "TERM", "LANG", "TZ", "HARNESS_SESSION_ID", "HARNESS_SESSION_DIR", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "HARNESS_SESSION_SECRET", "PI_TELEMETRY", "__CF_USER_TEXT_ENCODING"];
		expect(keys.filter((key) => !allowed.includes(key))).toEqual([]);
	});
});
