import { describe, expect, it } from "vitest";
import type { Adapter } from "../src/adapters/types.js";
import type { Manifest } from "../src/core.js";
import { describePlan, effectivePolicy, planModel } from "../src/model.js";

function adapter(id: string, wireFormats: Array<"anthropic-messages" | "openai-completions">): Adapter {
	return { id, wireFormats, render: async () => {}, launch: () => ({ argv: [], env: {} }) };
}

const pi = adapter("pi", ["openai-completions", "anthropic-messages"]);
const claude = adapter("claude", ["anthropic-messages"]);

function manifestWith(
	model: Manifest["model"],
	modelPolicy?: {
		source?: "proxied" | "gateway" | "none" | null;
		user_credentials?: "forbidden" | "allowed" | "required" | null;
	},
): Manifest {
	return {
		user: { auth_user_id: "u", org_unit_path: "acme" },
		assets: [],
		boundary: modelPolicy ? { model_policy: modelPolicy } : {},
		model,
	} as unknown as Manifest;
}

const orgModel: NonNullable<Manifest["model"]> = {
	provider: "acme-provider",
	model_id: "acme-model",
	base_url: "https://proxy.example/connectors/model-default/",
	wire_format: "anthropic-messages",
	key_ref: "secret://acme/model-default",
	env_var: "PROVIDER_API_KEY",
};

describe("effectivePolicy defaults", () => {
	it("defaults to proxied+forbidden when a model exists and nobody set a policy", () => {
		expect(effectivePolicy(manifestWith(orgModel))).toEqual({ source: "proxied", userCredentials: "forbidden" });
	});

	it("defaults to none+forbidden when no model exists and nobody set a policy — G13's fix", () => {
		expect(effectivePolicy(manifestWith(null))).toEqual({ source: "none", userCredentials: "forbidden" });
	});
});

describe("agents.md §5.1's table", () => {
	it("refuses, naming the policy, when the org provides nothing and forbids personal credentials", () => {
		const manifest = manifestWith(null, { source: "none", user_credentials: "forbidden" });
		expect(() => planModel(manifest, pi)).toThrow(/model_policy\.source: none/);
		expect(() => planModel(manifest, pi)).toThrow(/model_policy\.user_credentials: forbidden/);
		// Both adapters reach the same decision — that is the whole point.
		expect(() => planModel(manifest, claude)).toThrow(/model_policy\.user_credentials: forbidden/);
	});

	it("an absent model with no policy anywhere also refuses — not an accidental credential", () => {
		const manifest = manifestWith(null);
		expect(() => planModel(manifest, pi)).toThrow(/model_policy\.user_credentials: forbidden/);
		expect(() => planModel(manifest, claude)).toThrow(/model_policy\.user_credentials: forbidden/);
	});

	it("source: none, user_credentials: required starts a session on the user's own credentials, no key involved", () => {
		const manifest = manifestWith(null, { source: "none", user_credentials: "required" });
		expect(planModel(manifest, pi)).toEqual({ kind: "native" });
		expect(planModel(manifest, claude)).toEqual({ kind: "native" });
	});

	it("required bypasses the org's model even when one exists", () => {
		const manifest = manifestWith(orgModel, { source: "proxied", user_credentials: "required" });
		expect(planModel(manifest, claude)).toEqual({ kind: "native" });
	});

	it("source: none, user_credentials: allowed also runs on the user's own credentials", () => {
		const manifest = manifestWith(null, { source: "none", user_credentials: "allowed" });
		expect(planModel(manifest, pi)).toEqual({ kind: "native" });
	});

	it("provides a model, only one: forbidden + a resolved model uses the org's connection", () => {
		const manifest = manifestWith(orgModel, { source: "proxied", user_credentials: "forbidden" });
		const plan = planModel(manifest, claude);
		expect(plan).toMatchObject({ kind: "org", provider: "acme-provider", modelId: "acme-model" });
	});

	it("provides a model, but you may use your own: still defaults to the org's model", () => {
		const manifest = manifestWith(orgModel, { source: "proxied", user_credentials: "allowed" });
		expect(planModel(manifest, claude)).toMatchObject({ kind: "org" });
	});

	it("names the policy field and the mismatch when source claims a model that does not exist", () => {
		const manifest = manifestWith(null, { source: "proxied" });
		expect(() => planModel(manifest, pi)).toThrow(/model_policy\.source is "proxied"/);
		expect(() => planModel(manifest, pi)).toThrow(/model-default/);
	});
});

describe("wire-format matching fails closed, naming the agent and the connection", () => {
	it("a connection whose only endpoint is openai-completions runs under Pi and fails closed under Claude", () => {
		const manifest = manifestWith({
			provider: "acme-provider",
			model_id: "acme-model",
			base_url: "https://api.example.com/v1",
			wire_format: "openai-completions",
			key_ref: "secret://acme/model-default",
			env_var: "PROVIDER_API_KEY",
		});
		expect(planModel(manifest, pi)).toMatchObject({ kind: "org", wireFormat: "openai-completions" });
		expect(() => planModel(manifest, claude)).toThrow(/"claude"/);
		expect(() => planModel(manifest, claude)).toThrow(/model-default/);
		expect(() => planModel(manifest, claude)).toThrow(/openai-completions/);
	});

	it("a bare base_url keeps meaning openai-completions, so existing workspaces still boot", () => {
		// Every connection configured before `wire_format` existed has only a
		// base_url. Reading that as "no format" would refuse the boot for all
		// of them on upgrade, so it keeps the value pi.ts used to hardcode.
		// Claude Code still refuses — it genuinely cannot speak that shape,
		// which is the honest answer rather than a regression.
		const manifest = manifestWith({
			provider: "acme-provider",
			model_id: "acme-model",
			base_url: "https://api.example.com/v1",
			key_ref: "r",
			env_var: "E",
		});
		expect(planModel(manifest, pi)).toMatchObject({
			kind: "org",
			wireFormat: "openai-completions",
		});
		expect(() => planModel(manifest, claude)).toThrow(/openai-completions/);
	});

	it("a connection with no address at all fails closed for every adapter", () => {
		const manifest = manifestWith({
			provider: "acme-provider",
			model_id: "acme-model",
			key_ref: "r",
			env_var: "E",
		} as never);
		expect(() => planModel(manifest, pi)).toThrow(/no wire format at all/);
		expect(() => planModel(manifest, claude)).toThrow(/no wire format at all/);
	});

	it("an `endpoints` connection is matched per adapter, preferring each one's own format", () => {
		const manifest = manifestWith({
			provider: "openrouter",
			model_id: "some-model",
			key_ref: "r",
			env_var: "E",
			endpoints: {
				"anthropic-messages": "https://openrouter.ai/api",
				"openai-completions": "https://openrouter.ai/api/v1",
			},
		});
		expect(planModel(manifest, claude)).toMatchObject({
			wireFormat: "anthropic-messages",
			baseUrl: "https://openrouter.ai/api",
		});
		expect(planModel(manifest, pi)).toMatchObject({
			wireFormat: "openai-completions",
			baseUrl: "https://openrouter.ai/api/v1",
		});
	});
});

describe("credential env var mapping — agents.md §5.2", () => {
	it("Claude Code always gets ANTHROPIC_AUTH_TOKEN, regardless of the key's registered name", () => {
		const manifest = manifestWith(orgModel);
		const plan = planModel(manifest, claude);
		expect(plan).toMatchObject({ kind: "org", credentialEnvVar: "ANTHROPIC_AUTH_TOKEN" });
	});

	it("Pi gets the name the key was actually delivered under", () => {
		const manifest = manifestWith({ ...orgModel, wire_format: "openai-completions", env_var: "PROVIDER_API_KEY" });
		const plan = planModel(manifest, pi);
		expect(plan).toMatchObject({ kind: "org", credentialEnvVar: "PROVIDER_API_KEY" });
	});

	it("carries no credential env var for a gateway connection with no key", () => {
		const manifest = manifestWith({
			provider: "acme-gateway",
			model_id: "m",
			base_url: "https://gateway.acme.internal",
			wire_format: "anthropic-messages",
		});
		const plan = planModel(manifest, claude);
		expect(plan).toMatchObject({ kind: "org", keyRef: undefined, credentialEnvVar: undefined });
	});
});

describe("describePlan", () => {
	it("names the org's model when one is used", () => {
		expect(
			describePlan({ kind: "org", provider: "p", modelId: "m", baseUrl: "x", wireFormat: "anthropic-messages" }),
		).toContain("p/m");
	});

	it("points at harness auth when running natively", () => {
		expect(describePlan({ kind: "native" })).toContain("harness auth");
	});
});
