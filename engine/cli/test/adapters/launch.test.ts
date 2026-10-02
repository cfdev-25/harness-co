import { describe, expect, it } from "vitest";
import type { MintedCredential } from "@harness/compose/contracts";
import { claudeAdapter } from "../../src/adapters/claude/index.js";
import { pi } from "../../src/adapters/pi/index.js";
import { childEnvironment } from "../../src/env.js";
import { PROXY_URL, fixture } from "./fixture.js";

describe("launch", () => {
	it("adapter_cannot_override_core_env", async () => {
		const f = await fixture();
		const { env } = claudeAdapter.launch(f.ctx, f.ctx.choices.located);
		// What the adapter actually returns passes.
		expect(() =>
			childEnvironment({ sessionId: "s", sessionDir: f.sessionDir, proxyUrl: f.ctx.proxyUrl, adapterEnv: env }),
		).not.toThrow();
		for (const key of ["HOME", "HTTP_PROXY", "PATH"]) {
			expect(() =>
				childEnvironment({
					sessionId: "s",
					sessionDir: f.sessionDir,
					proxyUrl: f.ctx.proxyUrl,
					adapterEnv: { ...env, [key]: "/tmp/evil" },
				}),
			).toThrow(/may not override core env/);
		}
	});

	it("no_key_in_child_env", async () => {
		const f = await fixture();
		const minted: MintedCredential[] = [
			{
				alias: "model",
				value: "sk-live-a-real-provider-key",
				kind: "stored",
				expiresAt: null,
				resolvedFrom: { source: "vault", vault: "v", group: "g", grant: "gr" },
				evidence: "verified",
			},
		];
		for (const adapter of [pi, claudeAdapter]) {
			const { env } = adapter.launch(f.ctx, f.ctx.choices.located);
			for (const value of Object.values(env)) {
				for (const credential of minted) expect(value).not.toContain(credential.value);
			}
		}
		// What Claude Code is handed instead is the proxy's own session secret.
		const { env } = claudeAdapter.launch(f.ctx, f.ctx.choices.located);
		expect(env.ANTHROPIC_AUTH_TOKEN).toBe("s3cr3t-session");
		expect(env.ANTHROPIC_BASE_URL).toBe(`${new URL(PROXY_URL).origin}/connectors/model`);
		// Pi reads the secret from the child environment by name, so its argv
		// and env carry no credential at all.
		expect(JSON.stringify(pi.launch(f.ctx, f.ctx.choices.located))).not.toContain("s3cr3t");
	});

	it("names the one setting source; the generated settings.json is that tier", async () => {
		const f = await fixture();
		const { argv, env } = claudeAdapter.launch(f.ctx, f.ctx.choices.located);
		// D137: the brief is a file on disk, named in argv and hashed in
		// `rendered.json`, which is what D91 said argv could not be.
		expect(argv.slice(1)).toEqual([
			"--setting-sources", "user",
			"--append-system-prompt-file", `${f.agentDir}/system-prompt.md`,
		]);
		// Its Bash tool and hooks scratch here; the default `/tmp/claude-<uid>` is outside the geometry.
		expect(env.CLAUDE_CODE_TMPDIR).toBe(`${f.ctx.sessionDir}/tmp`);
		const piLaunch = pi.launch(f.ctx, { path: "/bundle/cli.js", version: "0.85.1" });
		expect(piLaunch.argv[0]).toBe(process.execPath);
		expect(piLaunch.argv).toContain("--no-extensions");
		expect(piLaunch.argv).toContain("--no-prompt-templates");
		expect(piLaunch.env.PI_CODING_AGENT_DIR).toBe(f.agentDir);
	});
});
