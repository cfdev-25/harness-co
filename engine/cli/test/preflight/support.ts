import { denyPatterns } from "../../src/adapters/layout.js";
import { covers } from "@harness/compose";
import type {
	Adapter,
	Choices,
	Chain,
	ComposedAsset,
	Composed,
	EffectivePolicy,
	HarnessDef,
	MintedCredential,
	Rehydrated,
	Sidecar,
	Slot,
} from "@harness/compose/contracts";
import type { PreflightApi, PreflightInput } from "../../src/preflight/preflight.js";

/** The chain every fixture here runs on: org › team › sub-team › person. */
export const CHAIN: Chain = [
	{ kind: "org", path: "acme", ref: "refs/heads/org", commit: "c0" },
	{ kind: "team", path: "acme.marketing", ref: "refs/heads/teams/acme.marketing", commit: "c1" },
	{ kind: "team", path: "acme.marketing.interns", ref: "refs/heads/teams/acme.marketing.interns", commit: "c2" },
	{ kind: "user", path: "acme.marketing.interns.dana", ref: "refs/heads/users/dana", commit: "c3" },
];

export const ICON = { palette: ["#000"], rows: [] };

export function policy(over: Partial<EffectivePolicy> = {}): EffectivePolicy {
	return {
		boundaries: [],
		grants: [{ id: "g-mkt", scope: { teams: ["acme.marketing"] }, group: "marketing", by: "rae@acme.co" }],
		groups: {
			marketing: {
				name: "marketing",
				sources: "vault",
				entries: [
					{ alias: "model-key", secret: { vault: "aws-prod", ref: "m" }, upstream: "https://api.anthropic.com", attach: { header: "x-api-key", prefix: "" } },
					{ alias: "crm", secret: { vault: "aws-prod", ref: "c" }, upstream: "https://api.crm.example", attach: { header: "Authorization", prefix: "Bearer " } },
				],
			},
		},
		modelProviders: {
			anthropic: {
				id: "anthropic",
				endpoints: { "anthropic-messages": "https://api.anthropic.com/v1" },
				models: ["claude-sonnet-5", "claude-haiku-5"],
				credential: { alias: "model-key" },
			},
			openrouter: { id: "openrouter", endpoints: { "openai-completions": "https://openrouter.ai/api/v1" }, models: ["auto"] },
		},
		harnessProviders: {
			claude: { id: "claude", approval: "approved", scope: { teams: "all" }, pin: { binary: "claude", minVersion: "2.1.275" }, speaks: ["anthropic-messages"] },
		},
		routing: {
			defaultFor: { teams: { "acme.marketing": "anthropic" }, harnesses: {}, providers: {} },
			approvedFor: { teams: { "acme.marketing": ["anthropic", "openrouter"] }, harnesses: {}, providers: {} },
		},
		kinds: ["skill", "memory", "tool", "prompt", "system_prompt"],
		required: [],
		recommended: [],
		reach: { mode: "off", hosts: [], setBy: "acme" },
		...over,
	};
}

export function asset(id: string, kind: string, name: string, sidecar: Partial<Sidecar> = {}): ComposedAsset {
	return { id, kind, name, from: CHAIN[0], tree: `t:${name}`, sidecar: { id, kind, ...sidecar } };
}

export function harness(over: Partial<HarnessDef> = {}): HarnessDef {
	return { id: "h1", name: "Support", description: "", icon: ICON, assets: [], ...over };
}

export function composed(over: Partial<Composed> = {}): Composed {
	// D119: every run is in a harness; the fixture's `Support` (h1) lists every asset given, so "loaded" is everything.
	return { chain: CHAIN, assets: [], conflicts: [], policy: policy(), harnesses: [harness({ assets: (over.assets ?? []).map((asset) => asset.id) })], tree: "tree0", ...over };
}

/** What `choose` would have returned, without running its I/O. */
export function choicesFor(one: Composed, harnessDef: HarnessDef | null = null, over: Partial<Choices> = {}): Choices {
	const grants = one.policy.grants.filter((grant) => covers(grant.scope, one.chain, harnessDef?.id ?? null));
	return {
		provider: one.policy.harnessProviders.claude,
		located: { path: "/usr/local/bin/claude", version: "2.1.280" },
		harness: harnessDef,
		view: "mine",
		model: { provider: one.policy.modelProviders.anthropic, model: "claude-sonnet-5", wireFormat: "anthropic-messages", endpoint: "https://api.anthropic.com/v1" },
		grants,
		native: false,
		...over,
	};
}

export const ME = { role: { level: "member" as const, at: null } };
export const ADMIN = { role: { level: "team-admin" as const, at: "acme.marketing" } };

export const REHYDRATED: Rehydrated = {
	skills: [],
	prompts: [],
	instructions: { system_prompt: [], memory: [] },
	model: null,
	hooks: [],
	denies: [],
	files: {},
};

/** A minimal `Adapter` (00 §4.8). The real ones live in `adapters/<provider>/`;
    preflight only ever calls the contract, so a fake proves the contract. */
export function fakeAdapter(over: Partial<Adapter> = {}): Adapter {
	const capabilities = Object.fromEntries(
		["skill", "prompt", "system_prompt", "memory", "tool_index", "tool_gating", "audit", "state_isolation", "project_suppression", "model_org", "model_native"].map(
			(concern) => [concern, "native"],
		),
	) as Adapter["capabilities"];
	return {
		id: "claude",
		displayName: "Claude Code",
		speaks: ["anthropic-messages"],
		capabilities,
		// W7-D2: what this runtime signs in to itself. The fake is Claude Code,
		// whose own login is an Anthropic subscription and nothing else.
		modelNative: ["anthropic"],
		locate: async () => ({ path: "/usr/local/bin/claude", version: "2.1.280" }),
		denyWrite: (ctx) => [`${ctx.workspace}/.claude`],
		ambientStores: () => ["/home/dana/.claude"],
		render: async () => ({ honoured: [], dropped: [] }),
		rehydrate: async (ctx) => ({
			...REHYDRATED,
			model: ctx.plan.connectors.model ? { endpoint: `${new URL(ctx.proxyUrl).origin}/connectors/model`, model: ctx.choices.model.model } : null,
			denies: denyPatterns(ctx.plan),
		}),
		launch: () => ({ argv: ["/usr/local/bin/claude"], env: { CLAUDE_HOME: "/x" } }),
		import: async () => ({ assets: [], harness: harness(), boundaries: [], dropped: [] }),
		probe: async () => undefined,
		...over,
	};
}

export function fakeApi(response: { credentials?: MintedCredential[]; slots?: Slot[]; blockers?: unknown[] }, seen: unknown[] = []): PreflightApi {
	return {
		url: "http://127.0.0.1:8400",
		async post<T>(_path: string, body: unknown): Promise<T> {
			seen.push(body);
			return { credentials: [], slots: [], blockers: [], ...response } as T;
		},
	};
}

export function minted(alias: string, value: string, group = "marketing", grant = "g-mkt"): MintedCredential {
	return { alias, value, kind: "minted", expiresAt: null, resolvedFrom: { source: "vault", vault: "aws-prod", group, grant }, evidence: "verified" };
}

export function input(dir: string, over: Partial<PreflightInput> = {}): PreflightInput {
	return {
		spawn: true,
		composed: composed(),
		adapter: fakeAdapter(),
		argv: { passthrough: [] },
		// D119: a session is always in a harness; the fixture's is `Support` (h1).
		selection: { harness_id: "h1", name: "Support" },
		selectionPath: `${dir}/harness.json`,
		me: ME,
		sessionId: "11111111-2222-3333-4444-555555555555",
		sessionDir: `${dir}/session`,
		agentDir: `${dir}/session/agent`,
		workspace: `${dir}/workspace`,
		assetsRoot: `${dir}/assets`,
		home: dir,
		proxy: { url: "http://:secret@127.0.0.1:41234", port: 41234 },
		api: fakeApi({ credentials: [minted("model-key", "sk-live-DO-NOT-LEAK")], slots: [] }),
		fence: async () => ({ close: async () => undefined }),
		notify: () => undefined,
		...over,
	};
}
