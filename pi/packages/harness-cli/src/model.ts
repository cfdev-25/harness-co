import type { Adapter } from "./adapters/types.js";
import type { Manifest } from "./core.js";

export type WireFormat = "anthropic-messages" | "openai-completions";
export type ModelSource = "proxied" | "gateway" | "none";
export type UserCredentials = "forbidden" | "allowed" | "required";

/**
 * What a session actually uses, decided once so every adapter reaches the
 * same answer (agents.md §5.1, closing G13). "org" carries a connection this
 * adapter can speak to; "native" means no org key is ever injected and the
 * agent's own signed-in credential — seeded from `~/.harness/agents/<id>/`
 * by `harness auth` — is what the session runs on.
 */
export type ModelPlan =
	| {
			kind: "org";
			provider: string;
			modelId: string;
			baseUrl: string;
			wireFormat: WireFormat;
			keyRef?: string;
			/** The env var name this *agent* reads a credential from — not
			    necessarily the name the org's key was registered under
			    (agents.md §5.2: Claude Code only ever reads
			    ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN). Undefined when the
			    connection carries no key at all (gateway mode, §5.3). */
			credentialEnvVar?: string;
	  }
	| { kind: "native" };

/** Unset fields default to the strictest reading available, so a policy
    nobody configured behaves exactly like today's Pi — use the org's model if
    one resolved, otherwise refuse — for both agents, rather than Claude Code
    quietly falling back to an ambient login (agents.md §5.1, G13). */
export function effectivePolicy(manifest: Manifest): { source: ModelSource; userCredentials: UserCredentials } {
	const policy = manifest.boundary.model_policy ?? {};
	return {
		source: policy.source ?? (manifest.model ? "proxied" : "none"),
		userCredentials: policy.user_credentials ?? "forbidden",
	};
}

/** Every wire format this connection can be reached on, whichever shape it
    was authored in. `{}` when it names neither — the fail-closed input, since
    no adapter's wireFormats can ever match an empty set. */
function endpointsOf(model: NonNullable<Manifest["model"]>): Record<string, string> {
	if (model.endpoints) return model.endpoints;
	// A bare `base_url` with no declared format is every connection that
	// existed before this field did, so it cannot mean "no format at all" —
	// that would refuse the boot for every workspace already configured.
	// It means what the code used to hardcode: openai-completions (the
	// `api` value `pi.ts` wrote into models.json). Pi keeps working
	// untouched, and Claude Code refuses it — which is the true answer, not
	// a regression, since Claude Code cannot speak that shape.
	if (model.base_url) return { [model.wire_format ?? "openai-completions"]: model.base_url };
	return {};
}

function matchWireFormat(
	model: NonNullable<Manifest["model"]>,
	adapter: Adapter,
): { wireFormat: WireFormat; baseUrl: string } | undefined {
	const available = endpointsOf(model);
	const wireFormat = adapter.wireFormats.find((format) => available[format]);
	return wireFormat ? { wireFormat, baseUrl: available[wireFormat] } : undefined;
}

/**
 * agents.md §5.1's table, applied once per session. Throws to refuse the
 * boot outright; every thrown message names the policy field or the
 * connection it failed against, so the CLI's error is the whole explanation.
 */
export function planModel(manifest: Manifest, adapter: Adapter): ModelPlan {
	const { source, userCredentials } = effectivePolicy(manifest);

	if (source === "none" && userCredentials === "forbidden") {
		throw new Error(
			"No model is configured for this session (model_policy.source: none), and your " +
				"organisation does not allow your own credentials (model_policy.user_credentials: " +
				"forbidden). Ask an admin to configure a model-default connection, or to relax model_policy.",
		);
	}
	// "required" means there is no org fallback for this session, by policy,
	// whether or not a model-default connection happens to exist elsewhere.
	if (userCredentials === "required" || source === "none") return { kind: "native" };

	if (!manifest.model) {
		throw new Error(`model_policy.source is "${source}", but no "model-default" connection exists.`);
	}
	const matched = matchWireFormat(manifest.model, adapter);
	if (!matched) {
		const available = Object.keys(endpointsOf(manifest.model));
		throw new Error(
			`"${adapter.id}" speaks ${adapter.wireFormats.join(", ")}, but the "model-default" connection ` +
				`only offers ${available.length ? available.join(", ") : "no wire format at all"}.`,
		);
	}
	return {
		kind: "org",
		provider: manifest.model.provider,
		modelId: manifest.model.model_id,
		baseUrl: matched.baseUrl,
		wireFormat: matched.wireFormat,
		keyRef: manifest.model.key_ref,
		credentialEnvVar: manifest.model.key_ref
			? adapter.id === "claude"
				? "ANTHROPIC_AUTH_TOKEN"
				: (manifest.model.env_var ?? undefined)
			: undefined,
	};
}

/** One line for the user: which credential is about to pay for this session. */
export function describePlan(plan: ModelPlan): string {
	if (plan.kind === "native") {
		return "No organisation model for this session — using your own sign-in (`harness auth`).";
	}
	return `Using your organisation's model: ${plan.provider}/${plan.modelId}.`;
}
