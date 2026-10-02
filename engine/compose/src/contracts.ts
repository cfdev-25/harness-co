/**
 * The engine's cross-document contracts, transcribed from
 * `docs/engine/00-overview.md` §4.1–§4.9 in the order they appear there.
 *
 * 00 §4 is the only place a cross-document type is defined; 10 rule 10 says
 * nothing redeclares or widens one. This file is that section as compilable
 * TypeScript and holds nothing runtime, so `@harness/contracts` can be
 * imported by the console without pulling in git-facing code (console 00 D3).
 *
 * Divergences from the prose are limited to what the prose needs to compile,
 * and each carries a comment saying so. The spine is authoritative: when it
 * is corrected, this file follows.
 */

// ---------------------------------------------------------------------------
// 4.1 Chain and nodes
// ---------------------------------------------------------------------------

export type NodeKind = "org" | "team" | "user";

export interface ChainNode {
	kind: NodeKind;
	/** Dotted path, root first: "acme", "acme.marketing", "acme.marketing.interns". */
	path: string;
	/** The ref: refs/heads/org, refs/heads/teams/<path>, refs/heads/users/<user-id>. */
	ref: string;
	/** Commit the ref pointed at when fetched. */
	commit: string;
}

/** Root first, narrowest last. The person's own user node is always last. */
export type Chain = ChainNode[];

// ---------------------------------------------------------------------------
// 4.2 Assets and the sidecar
// ---------------------------------------------------------------------------

/** `kind` is data. The allowed set is `policy/kinds.json` on the org branch (01 §4.2). */
export type AssetKind = string;

/** The sidecar, `asset.json`, one per asset directory (01 §5). */
export interface Sidecar {
	id: string; // uuid; the durable identity (prd-v2 §4.1)
	kind: AssetKind;
	/** Optional declarations. Absent means "none". */
	needs?: Need[];
	/** A wire format this asset requires from the model, if any (prd-v2 §9.3). */
	format?: WireFormat;
	/** Shown on the organisation assets row (00 §4.2); written by `PATCH /v1/assets/{id}` (WS3a). */
	description?: string;
}

export type Need =
	| { kind: "credential"; alias: string } // resolves through a security group entry
	| { kind: "asset"; id: string } // another asset must be subscribed
	| { kind: "environment"; name: string } // W5-D15: a tool brings its environment along
	| { kind: "login"; tool: "gh" | "aws" | "gcloud" | "az" | "supabase" | string }; // an ambient login

export interface ComposedAsset {
	id: string;
	kind: AssetKind;
	/** Directory name under <kind>/. The path is not identity; it may differ between branches. */
	name: string;
	/** The node whose copy won. */
	from: ChainNode;
	/** git tree id of the asset directory on that node. */
	tree: string;
	sidecar: Sidecar;
	/** Present when a wider node also holds this id: the copy this one overrides. */
	shadows?: { from: ChainNode; tree: string };
}

export type Conflict =
	| { kind: "same-path-different-id"; path: string; a: { id: string; from: ChainNode }; b: { id: string; from: ChainNode } }
	| { kind: "duplicate-id-on-one-branch"; id: string; from: ChainNode; paths: string[] }
	// TRANSCRIPTION FIX: the spine writes `{ kind: "unknown-kind"; kind: string; … }` —
	// `kind` twice in one member, the discriminant and the offending asset kind. The
	// payload is renamed `assetKind`; the spine must pick a name for it.
	| { kind: "unknown-kind"; assetKind: string; path: string; from: ChainNode }
	| { kind: "malformed"; path: string; from: ChainNode; why: string } // a policy, sidecar or harness file that fails to parse or validate
	| { kind: "invalid-grant"; grant: string; from: ChainNode; clause: "none" | "a" | "b" | "c" | "d" | "e"; why: string } // a narrowed grant failing 01 §6's subset/coverage clauses
	// A node (or a harness, `from` naming the node it was read off) whose `reach`
	// widens what it inherited: the parent stands and the step is reported (D131).
	| { kind: "reach-widened"; at: string; from: ChainNode; why: string }
	// D132: `Grant.reach` is retired. The grant grants nothing and says so.
	| { kind: "reach-grant-retired"; grant: string; from: ChainNode };

// ---------------------------------------------------------------------------
// 4.3 Policy objects
// ---------------------------------------------------------------------------

/** The one scoping primitive (prd-v2 §13). */
export interface Scope {
	/** Team paths, or every team. A user path is never a scope target. */
	teams: string[] | "all";
	/** Narrow to these harness ids. Absent = every harness the teams own. */
	harnesses?: string[];
}

export interface SecurityGroup {
	name: string; // unique on the org branch
	/** An alias is a secret *used at an upstream, attached one way*. The proxy needs all three (05). */
	entries: Array<{
		alias: string;
		secret: SecretRef;
		upstream: string; // https://api.stripe.com — origin only, no path
		attach: { header: string; prefix: string }; // { "Authorization", "Bearer " } · { "x-api-key", "" }
	}>;
	/** How far down the credential chain this group permits (prd-v2 §6.5). */
	sources: "vault" | "vault-or-local";
	/** Provider-specific mint parameters, opaque to the CLI (04 §3). */
	mint?: Record<string, unknown>;
}

export interface SecretRef {
	vault: string;
	ref: string;
} // vault = the id of a key vault `api` has connected (04 §7); not validated at push, refused at mint if unknown

/** A grant is a scoped instance of a security group. Differently scoped = a different grant.
    D132 retired `reach: "outside-endpoints"`: reach is `policy/reach.json`, not a grant. */
export interface Grant {
	id: string;
	scope: Scope;
	group?: string; // a SecurityGroup name
	/** Set on a grant a team admin narrowed: the grant it came from, and the aliases kept. */
	narrowedFrom?: { grant: string; aliases: string[] };
	by: string; // author (the commit's author is the record; this is a copy for readers)
}

export interface Boundary {
	id: string;
	scope: Scope;
	kind: "endpoint" | "command" | "filesystem" | "capability";
	value: string; // host[:port] pattern · resolved command pattern · path glob · capability name
	holds: "enforced" | "intercepted"; // prd-v2 §7
	reason: string;
}

/**
 * D131 — `policy/reach.json` on the org node and on team nodes, and `HarnessDef.reach`.
 * `allow`: `hosts` is the allow-list. `on`: `hosts` is the deny-list. `off`: `hosts` is
 * ignored. Absent everywhere is `off`. A host is an exact name or `*.suffix`.
 */
export interface Reach {
	mode: "off" | "allow" | "on";
	hosts: string[];
}

/** The composed reach, with the last node that narrowed it: a node path, or
    `harness:<id>` when the harness definition took the last step. */
export interface EffectiveReach extends Reach {
	setBy: string;
}

/** The shapes a model endpoint speaks. Two are implemented at M3; the rest are known values so an adapter's
    `speaks` and a provider's `endpoints` can name them the day they are needed. Matching is by intersection. */
export type WireFormat =
	| "anthropic-messages" | "openai-completions"                      // implemented
	| "openai-responses" | "google-generative" | "bedrock-converse";   // known, Later

/** Presets for OpenRouter, Anthropic and OpenAI ship as data (`engine/compose/presets/model-providers.json`) and
    are seeded into a new organisation's providers.json at sign-up (07 §11.0). */
export interface ModelProvider {
	id: string;
	endpoints: Partial<Record<WireFormat, string>>; // base URL per wire format
	models: string[];
	/** The credential for this provider is an entry alias, resolved through covering grants with the same
      precedence as any other alias (03 §5.4), or none (gateway). The entry's `upstream` is ignored for the
      model: the endpoint comes from `endpoints[wireFormat]`. */
	credential?: { alias: string };
}

export interface HarnessProvider {
	id: "pi" | "claude" | string;
	/** W6-D3. What the runtime calls itself — *Pi*, *Claude Code* — for every screen and
      every launch button. Optional on the contract, because an organisation seeded before
      this change holds rows without one and the reader falls back to the id; required of
      every row in `engine/compose/presets/harness-providers.json`, which is where ours
      come from. */
	name?: string;
	approval: "approved" | "beta" | "not-approved";
	scope: Scope; // approval scope: who may run it
	/** Vendored/forked: a repo + commit. Located: a binary and a version floor. Exactly one. */
	pin: { repo: string; commit: string } | { binary: string; minVersion: string };
	speaks: WireFormat[];
	reason?: string; // for not-approved / beta
}

export interface Routing {
	/** prd-v2 §9.2. Keys are team paths, harness ids, or provider ids. */
	defaultFor: { teams: Record<string, string>; harnesses: Record<string, string>; providers: Record<string, string> };
	approvedFor: { teams: Record<string, string[]>; harnesses: Record<string, string[]>; providers: Record<string, string[]> };
}

/** TRANSCRIPTION FIX: `HarnessDef.icon` names `Icon`, which 00 §4 never declares.
    This is `harnesses.md` §6's shape, unchanged, so the spine can adopt it verbatim. */
export interface Icon {
	palette: string[];
	rows: string[];
}

export interface HarnessDef {
	id: string;
	name: string;
	description: string;
	icon: Icon; // 16×16, harnesses.md §6, unchanged
	/** Asset ids. The harness names the thing; the chain picks the copy (01 §5). */
	assets: string[];
	/** A last narrowing step, after the chain's (D131). Widening is a `reach-widened` conflict. */
	reach?: Reach;
}

// ---------------------------------------------------------------------------
// 4.4 The composed result
// ---------------------------------------------------------------------------

export interface EffectivePolicy {
	boundaries: Boundary[]; // union down the chain, each tagged with the node that set it (by id prefix)
	grants: Grant[]; // org grants + each node's narrowed grants, validated (01 §6)
	groups: Record<string, SecurityGroup>;
	modelProviders: Record<string, ModelProvider>;
	harnessProviders: Record<string, HarnessProvider>;
	routing: Routing;
	kinds: AssetKind[];
	/** W5-D10. Org assets every session loads, whatever the harness says, and which
      no harness may drop: the `required` list of org-only `policy/always-loaded.json`
      (a bare array there is read as this list). */
	required: string[];
	/** W5-D10. Org assets a **new** harness starts with — copied into its `assets`
      at creation and ordinary entries from then on. Never forced into a session. */
	recommended: string[];
	/** The chain's reach, narrowed org → team → sub-team (D131). The harness's own
      step is `effectiveReach(policy.reach, harness)`, which only the session knows. */
	reach: EffectiveReach;
}

export interface Composed {
	chain: Chain;
	assets: ComposedAsset[]; // one per id, the winning copy
	conflicts: Conflict[]; // non-empty ⇒ preflight fails with compose.* blockers
	policy: EffectivePolicy;
	harnesses: HarnessDef[]; // every harness on the chain
	/** W5-D12. Harness id → every node path that holds a definition for it, root
      first; the last is the node whose copy won (01 §6 step 10's D3 rule). The
      boot screen says *your version of Marketing's Support* from this and
      nothing else knows it. */
	harnessFrom: Record<string, string[]>;
	/** git tree id of the composed working set: <kind>/<name>/… for every asset, plus versions.json. */
	tree: string;
}

/** The only I/O compose() performs, as four git plumbing wrappers. The CLI (01 §7.2) and `definitions`
    (02 §4) each implement it once; compose() is pure given one. An absent directory lists as []. */
export interface Reader {
	ls(commit: string, dir: string): Promise<Array<{ name: string; mode: "040000" | "100644" | "100755" | "120000"; oid: string }>>;
	cat(oid: string): Promise<Uint8Array>;
	write(bytes: Uint8Array): Promise<string>; // blob oid
	mktree(entries: Array<{ name: string; mode: string; oid: string }>): Promise<string>; // tree oid
}

// ---------------------------------------------------------------------------
// 4.5 Choices and the plan
// ---------------------------------------------------------------------------

export interface Choices {
	provider: HarnessProvider;
	located: Located; // the binary Choose found for it, at or above the pin (07)
	harness: HarnessDef | null; // null = no filter (harnesses.md §0 "no harness is not an empty harness")
	/** "team": for every asset whose winning copy is the person's own, load its `shadows` copy instead (08 `--team`). */
	view: "mine" | "team";
	model: { provider: ModelProvider; model: string; wireFormat: WireFormat; endpoint: string };
	/** Grants that cover this harness for this person, after Scope evaluation. */
	grants: Grant[];
	/** No covering grant supplies the model credential and the provider can use its own sign-in (00 D11). */
	native: boolean;
}

export interface SpawnPlan {
	/** Tunnel allowlist: credentialed hosts + the model endpoint host, always routable on 443 (D133). */
	hosts: string[];
	/** Always applied, before `hosts` and before reach. From boundaries of kind endpoint. */
	deny: string[];
	/** The session's effective reach: the chain's, narrowed by the harness (D131, D133). */
	reach: EffectiveReach;
	/** alias → how the proxy attaches the credential on /connectors/<alias>/…
      `wireFormat` is set on `model` only, and is what `shapeModelRequest` reads (D134). */
	connectors: Record<string, { upstream: string; attach: { header: string; prefix: string }; wireFormat?: WireFormat }>;
	filesystem: {
		allowWrite: string[]; // workspace, assets work tree, session agent dir, spool, private tmp
		denyRead: string[]; // credentials, ~/.ssh …, excluded tool dirs, ambient provider stores
		denyWrite: string[]; // the provider's own settings files inside the workspace (07 §5)
	};
	/** W6-D153. Boundaries of kind `command` that cover this session, carried on
      the plan so both adapters read them from here and neither re-filters the
      composed policy — the same road `deny` and `denyWrite` travel. `holds` is
      always `intercepted`: the runtime refuses the call, the fence never sees
      it. `commandMatches(pattern, line)` is the one matcher (03 §5.7 row 6). */
	commands: Array<{ id: string; pattern: string; reason: string }>;
	env: Record<string, string>; // the core set + adapter additions; adapters may add, never override
	argv: string[]; // adapter's argv + passthrough; sandbox wrapper prepended at spawn
}

export interface Enforcer {
	readonly name: string;
	/** Pure. Tighten only: allowlists intersect, deny lists union. Throw = a Blocker.
      `minted` is what the broker returned (§3 row 5); the network and credentials enforcers derive
      hosts and connectors from it, so Plan runs after Mint. */
	plan(composed: Composed, choices: Choices, minted: MintedCredential[], plan: SpawnPlan): SpawnPlan;
	/** Runs under the exact profile the agent will get. Throw = a Blocker. Unexpected success is a failure. */
	probe?(plan: SpawnPlan, run: ProbeRunner): Promise<void>;
}

// ---------------------------------------------------------------------------
// 4.6 Credentials, evidence, slots
// ---------------------------------------------------------------------------

export type Evidence = "verified" | "harness-reported" | "declared";
export type SlotState = "satisfied" | "unsatisfied" | "deferred";

/** Where a credential slot was filled from. The one field that makes a chain reviewable (prd-v2 §6.5). */
export type ResolvedFrom =
	| { source: "vault"; vault: string; group: string; grant: string } // where it came from, then why you were allowed
	| { source: "local"; tool: string }
	| null;

/** Preflight emits a `login` slot for every tool in its probe table, satisfied or not — the console's Account
    screen reads *logins present* from the last posted report, so the positive ones must be there too (console 04 D45). */
export interface Slot {
	need: Need;
	state: SlotState;
	evidence: Evidence;
	resolvedFrom: ResolvedFrom;
	/** Set by the broker on a credential slot it chose a grant for but could not fill (deferred):
      the CLI consults a local login only if `via.sources === "vault-or-local"` (04 D60). */
	via?: { grant: string; group: string; sources: SecurityGroup["sources"] };
	blocker?: Blocker;
}

/** What the broker returns to the supervisor for one alias. Never reaches the jail. */
export interface MintedCredential {
	alias: string;
	value: string;
	/** minted = created for this session and expires with it; stored = a long-lived value handed out under lease. */
	kind: "minted" | "stored";
	expiresAt: string | null;
	resolvedFrom: Extract<ResolvedFrom, { source: "vault" }>;
	evidence: Evidence;
}

// ---------------------------------------------------------------------------
// 4.7 Blockers and the report
// ---------------------------------------------------------------------------

export interface Blocker {
	/** Namespaced by owning doc: compose.* repo.* definitions.* preflight.* broker.* proxy.* sandbox.* adapter.* cli.* supervise.* */
	code: string;
	/** One sentence, plain words, names the thing. */
	message: string;
	/** What to do. Always present. */
	remedy: string;
	/** A console deep link or a CLI command, when one exists. */
	link?: string;
}

/** One row of the authoritative endpoint log, written by the proxy (05). */
export interface EndpointEvent {
	at: string; // ISO
	mode: "tunnel" | "inject" | "refused";
	host: string;
	port: number;
	alias?: string; // inject only
	method?: string; // inject only
	path?: string; // inject only, query stripped
	status: number | "no-route" | "denied" | "no-sni" | "sni-mismatch" | "ip-literal" | "bad-secret" | "retired" | "stripped";
	bytesOut: number;
	bytesIn: number;
	/** Why, in one machine-readable word: `port`, `reach.off`, `reach.not-listed`,
      `reach.denied`, `boundary`, or `stripped:<names>` (D133, D134). */
	reason?: string;
	/** The node whose policy decided it: a node path, `harness:<id>`, or the
      boundary's own node. The console's Allow action writes there (D133). */
	setBy?: string;
	/** Inject mode, alias `model` only: token usage read from the response when the wire format exposes it (05 §6).
      Absent in tunnel mode — native sessions are "not metered", never zero (C22). */
	usage?: { input: number; output: number } | null;
}

/** Aggregated per (host, port, alias) for the session record and the console's Endpoints reached. */
export interface EndpointTally {
	host: string;
	port: number;
	alias?: string;
	count: number;
	refused: number;
	/** Model requests this host shaped a capability out of (D134). */
	stripped: number;
	/** `EndpointEvent.reason` → how many events carried it. */
	reasons: Record<string, number>;
	firstAt: string;
	lastAt: string;
}

export interface Drift {
	file: string;
	expected: unknown;
	actual: unknown;
}

export interface PreflightReport {
	sessionId: string;
	composed: { commit: Record<string, string>; tree: string; conflicts: Conflict[] };
	/** null when Choose itself refused — the blockers say why (08 §12.3). */
	choices: Choices | null;
	/** The plan, when one was produced (03 §5.10). */
	plan: SpawnPlan | null;
	slots: Slot[];
	drift: Drift[];
	passing: boolean;
	blockers: Blocker[];
	/** ISO time; the report is written to <sessionDir>/preflight.json before any spawn. */
	at: string;
}

// ---------------------------------------------------------------------------
// 4.8 Adapter contract
// ---------------------------------------------------------------------------

export type Concern =
	| "skill"
	| "prompt"
	| "system_prompt"
	| "memory"
	| "tool_index"
	| "tool_gating"
	| "audit"
	| "state_isolation"
	| "project_suppression"
	| "model_org"
	| "model_native";

export type Support = "native" | "emulated" | "none";

export interface RenderContext {
	composed: Composed;
	choices: Choices;
	plan: SpawnPlan;
	sessionId: string;
	sessionDir: string; // ~/.harness/sessions/<id>
	agentDir: string; // <sessionDir>/agent — the only place render may write
	workspace: string; // the person's cwd; denyWrite() names files under it
	assetsRoot: string; // ~/.harness/assets — render may symlink into it, never copy from it
	proxyUrl: string; // http://:<secret>@127.0.0.1:<port>
}

export interface Located {
	path: string;
	version: string;
}

export interface Adapter {
	readonly id: string;
	readonly displayName: string;
	/** 08 §11.1. `ours`: the runtime draws the harness landing as its own header (Pi); absent or `theirs`: the CLI prints it and then the runtime's start-up follows. */
	readonly landing?: "ours" | "theirs";
	readonly speaks: readonly WireFormat[];
	readonly capabilities: Readonly<Record<Concern, Support>>;
	/** W7-D2. The model providers this runtime signs in to **itself**, by provider id — the
      list behind `capabilities.model_native`, which says only whether it can do it at all
      (07 §6). Pi ships an OAuth flow per id in `packages/ai/src/auth/oauth/`; Claude Code
      signs in to Anthropic. A keyless provider on this list is *your sign-in*, not a
      missing key; one not on it is still `needs-key`. `engine/compose/presets/harness-providers.json`
      carries the same list as `modelNative` so the server can predict this without running
      the runtime, exactly as it carries `speaks`. */
	readonly modelNative?: readonly string[];
	/** Find the binary this adapter is responsible for; refuse below the pin. */
	locate(pin: HarnessProvider["pin"]): Promise<Located>;
	/** Directories inside the workspace the agent must not be able to write (where its own settings live:
      <workspace>/.claude, <workspace>/.pi). Directories, not files, so a new settings file cannot appear beside a denied one (06 D81). */
	denyWrite(ctx: RenderContext): string[];
	/** Provider-side stores an ambient login could come from; always added to denyRead (G13). */
	ambientStores(): string[];
	/** Writes generated files under agentDir only. Returns what it honoured and what it dropped. */
	render(ctx: RenderContext): Promise<RenderReport>;
	/** Reads back what render wrote and returns the IR it encodes, for drift detection. */
	rehydrate(ctx: RenderContext): Promise<Rehydrated>;
	launch(ctx: RenderContext, located: Located): { argv: string[]; env: Record<string, string> };
	/** Read a provider's EXISTING configuration — one a person built before they had us — into assets and a
      harness definition, reporting what could not carry (07 §4a). The inverse of render over foreign files. */
	import(source: { dir: string; workspace?: string }): Promise<Imported>;
	/** After spawn, under the profile: came up at the located version, on the chosen model, with no credential we did not give. */
	probe(ctx: RenderContext, run: ProbeRunner): Promise<void>;
}

export interface RenderReport {
	honoured: Concern[];
	dropped: Array<{ concern: Concern; why: string }>;
}

/** What an import produced. Assets are written to the work tree with fresh sidecars; nothing is pushed
    until the person says so (08 §11.19). `dropped` is the fidelity report — declared, not discovered (I7). */
export interface Imported {
	assets: Array<{ kind: AssetKind; name: string; path: string; from: string }>; // from = the source file
	harness: HarnessDef;
	boundaries: Boundary[]; // e.g. from permissions.deny
	dropped: Array<{ what: string; from: string; why: string }>; // hooks, MCP servers, unknown keys
}

/** The subset of the plan an adapter's files encode. Compared field-by-field to the plan. */
export interface Rehydrated {
	skills: string[]; // asset ids
	prompts: string[];
	instructions: { system_prompt: string[]; memory: string[] }; // asset ids in order
	model: { endpoint: string; model: string } | null;
	hooks: string[]; // audit hook commands
	denies: string[]; // permission denies the file carries
	/** path → sha256 of every generated file, recomputed from disk; compared to rendered.json (07 §5). */
	files: Record<string, string>;
}

export interface ProbeRunner {
	(argv: string[], opts?: { timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }>;
}

// ---------------------------------------------------------------------------
// 4.9 Resolver contract (broker side, Python)
//
// Transcribed from the section's Python so the one definition stays in one
// place: `TypedDict` → interface, `Literal[…]` → a union, `str | None` →
// `string | null`, `dict | None` → `Record<string, unknown> | null`,
// `Protocol` → interface, `-> None` → `void`. `expires_at` keeps its Python
// spelling because the field name is the Python wire shape, not an
// identifier we choose (10 rule 16 covers prose, not a foreign field name).
// The implementation is Python in `api`; nothing in the engine implements it.
// ---------------------------------------------------------------------------

export interface Probe {
	ready: boolean;
	evidence: "verified" | "harness-reported" | "declared";
	detail: string;
}

export interface Minted {
	value: string;
	kind: "minted" | "stored";
	expires_at: string | null;
	evidence: "verified" | "harness-reported" | "declared";
}

/** TRANSCRIPTION FIX: `Resolver.resolve` names `SessionContext`, which 00 §4 never
    declares. Left opaque rather than invented; the spine (or 04) must give it a shape. */
/** Who and what a mint is for, so the vault's own audit carries attribution (04 §5.3). */
export interface SessionContext {
  person: string;   // user id
  session: string;  // session id
  org: string;
  group: string;
  grant: string;
}

export interface Resolver {
	id: string; // matches ModelProvider.credential / SecretRef.vault
	probe(ref: string): Probe;
	resolve(ref: string, session: SessionContext, mint: Record<string, unknown> | null): Minted;
	revoke(minted: Minted): void; // no-op for stored
}
