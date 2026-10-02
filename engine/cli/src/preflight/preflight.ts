import { denyPatterns } from "../adapters/layout.js";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { covers } from "@harness/compose";
import type { Adapter, Blocker, Choices, Composed, Concern, Drift, MintedCredential, PreflightReport, ProbeRunner, Rehydrated, RenderContext, Slot, SpawnPlan } from "@harness/compose/contracts";
import { confine, probeSandbox } from "../sandbox/index.js";
import { type ChooseArgv, choose, type Me, type Selection } from "./choose.js";
import { diffRehydrated } from "./drift.js";
import { enforcers, type PlanContext, runEnforcers } from "./enforcers/index.js";
import { ensureEnvironment, environmentDir } from "../env.js";
import { loadSet } from "./loadset.js";
import { walkNeeds } from "./needs.js";
import { LOCAL_PROBES } from "./probes.js";

/** `POST /v1/sessions` (00 §4.10) through a function, so the network edge is the
    caller's and a test injects a fake (10 rule 17). It resolves with the
    broker's body for a refusal too: its `blockers` are the answer, not an error. */
export interface PreflightApi {
	url: string;
	post<T>(path: string, body: unknown): Promise<T>;
}

export interface PreflightInput {
	/** `run` is `{spawn:true}`; `harness preflight` is `{spawn:false}` (D55). */
	spawn: boolean;
	composed: Composed;
	adapter: Adapter;
	argv: ChooseArgv & { offline?: boolean; passthrough: string[] };
	selection?: Selection;
	selectionPath: string;
	me: Me;
	sessionId: string; sessionDir: string; agentDir: string;
	workspace: string; assetsRoot: string; home: string;
	/** 08 pre-allocates the loopback port: render and the plan must name it before the fence starts. */
	proxy: { url: string; port: number };
	api: PreflightApi;
	/** 05's `startProxy`, called by 08 — preflight closes it on a failing report and on `spawn:false`. */
	fence(plan: SpawnPlan, credentials: MintedCredential[]): Promise<{ close(): Promise<void> }>;
	notify(line: string): void;
}

export interface PreflightResult {
	report: PreflightReport;
	/** Row 11's input, plan included; `null` unless the report is passing. */
	context: RenderContext | null;
	/** Held by the supervisor, never written anywhere (I3). */
	credentials: MintedCredential[];
}

/** `POST /v1/sessions`' response body (04 §5.3 step 10). */
type Minted = { credentials: MintedCredential[]; slots: Slot[]; blockers: Blocker[] };

/**
 * 03 — rows 4–10 of the boot table, in order, for `run` and `harness preflight`
 * alike (D55). The only file in the directory that performs I/O.
 */
export async function preflight(input: PreflightInput): Promise<PreflightResult> {
	const blockers: Blocker[] = [];
	let slots: Slot[] = [];
	let drift: Drift[] = [];
	let choices: Choices | undefined;
	let credentials: MintedCredential[] = [];
	let context: RenderContext | null = null;
	let plan: SpawnPlan | null = null;
	let fence: { close(): Promise<void> } | undefined;

	const phases = async (): Promise<void> => {
		// Row 4: Choose, then the row's one piece of I/O (§5.2, §5.9).
		let chosen: Omit<Choices, "located">;
		try {
			chosen = choose(input.composed, input.argv, input.selection, input.me);
		} catch (thrown) {
			// harnesses.md §8.2: the stale selection goes before the person is told.
			if (isBlocker(thrown) && thrown.code === "preflight.harness_gone") await rm(input.selectionPath, { force: true });
			throw thrown;
		}
		// D11: native only where the adapter can actually use its own sign-in —
		// and W7-D2, only to a provider it has one *for*. `modelNative` is the
		// adapter's own list (07 §6); a runtime that declares none signs in to
		// nothing, so the session is the organization's model or it is refused
		// by the broker at step 5. The two agree, so the boot line's *your own
		// sign-in · not metered* is never printed for a session the broker
		// would refuse.
		const located = await input.adapter.locate(chosen.provider.pin);
		const signsIn =
			input.adapter.capabilities.model_native !== "none" &&
			(input.adapter.modelNative ?? []).includes(chosen.model.provider.id);
		choices = { ...chosen, located, native: chosen.native && signsIn };

		// §5.3–§5.4: what loads, and what it needs.
		const load = loadSet(input.composed, choices);
		const walked = walkNeeds(input.composed, choices, load);
		slots = walked.slots;
		blockers.push(...walked.blockers);
		if (blockers.length > 0) return; // §5.6: mint only if nothing has refused.

		// Row 5: Mint. The broker's slots replace ours alias-for-alias — its
		// evidence and `resolvedFrom` are authoritative — and its refusal is final (I4).
		// A `deferred` slot is native mode's model alias: the broker has no vault for
		// it and asking would refuse the session (04 §5.3 step 6).
		const minted = await mint(input, choices, slots.flatMap((slot) => (slot.need.kind === "credential" && slot.state !== "deferred" ? [slot.need.alias] : [])));
		credentials = minted.credentials;
		const authoritative = new Map(minted.slots.flatMap((slot) => (slot.need.kind === "credential" ? [[slot.need.alias, slot] as const] : [])));
		slots = slots.map((slot) => (slot.need.kind === "credential" ? (authoritative.get(slot.need.alias) ?? slot) : slot));
		blockers.push(...minted.blockers);
		if (minted.blockers.length > 0) return;

		// Row 6: Plan. The harness's environments exist before the geometry names
		// them (D30l) — made outside the jail, once per harness.
		const envDir = environmentDir(choices.harness?.id);
		await ensureEnvironment(envDir, input.notify);
		const ctx: PlanContext = {
			adapter: input.adapter, located: choices.located, loaded: load.loaded,
			home: input.home, workspace: input.workspace, assetsRoot: input.assetsRoot,
			sessionId: input.sessionId, sessionDir: input.sessionDir, agentDir: input.agentDir,
			envDir,
			proxyUrl: input.proxy.url, passthrough: input.argv.passthrough, toolDirs: await toolDirs(input.assetsRoot),
			context: (plan) => ({ composed: input.composed, choices: choices as Choices, plan, sessionId: input.sessionId, sessionDir: input.sessionDir, agentDir: input.agentDir, workspace: input.workspace, assetsRoot: input.assetsRoot, proxyUrl: input.proxy.url }),
		};
		plan = runEnforcers(input.composed, choices, credentials, enforcers(ctx));
		context = ctx.context(plan);

		// Row 7: Render. §5.8 step 0 first — a required concern the adapter cannot
		// provide refuses before anything is written (D13).
		requireConcerns(input, choices);
		for (const dropped of (await input.adapter.render(context)).dropped) {
			// D54: said once, recorded, and `passing` is unaffected.
			const message = `${input.adapter.displayName} cannot do ${dropped.concern}; continuing without it.`;
			input.notify(message);
			blockers.push({ code: "preflight.concern_dropped", message, remedy: dropped.why });
		}

		// §5.8 steps 2–3: drift against what the plan says the files should encode.
		drift = diffRehydrated(expected(input, choices, plan, load.loaded), await input.adapter.rehydrate(context));
		for (const one of drift) {
			const field = Object.keys(one.expected as object)[0];
			const [want, got] = [one.expected, one.actual].map((side) => JSON.stringify((side as Record<string, unknown>)[field]));
			const remedy = `This is a bug in the ${input.adapter.displayName} adapter; report it with \`harness preflight --json\`.`;
			blockers.push({ code: "preflight.drift", message: `${one.file} does not match the plan: ${field} expected ${want}, got ${got}.`, remedy });
		}

		// Row 8: Fence, started here so the probes can reach it (§5.8 step 4).
		fence = await input.fence(plan, forFence(credentials, choices, plan));

		// Row 9: Probe. Local logins first, then the two delegated ones under the
		// exact profile the agent will get; an unexpected success aborts (P9, C26).
		for (const [at, slot] of slots.entries()) {
			const tool = localTool(slot);
			if (tool !== undefined) slots[at] = await probeLogin(input, slot, tool);
		}
		const session = { dir: input.sessionDir, proxyPort: input.proxy.port };
		const planned = plan; // narrowed for the closure below
		await probeSandbox(planned, session);
		await input.adapter.probe(context, ((argv, opts) => {
			const { command, args } = confine(planned, argv, session);
			return capture(command, args, planned.env, opts?.timeoutMs ?? 5_000);
		}) satisfies ProbeRunner);
	};

	try {
		await phases();
	} catch (thrown) {
		// 10 rule 12: a `Blocker` is the report's business; anything else is a bug.
		if (!isBlocker(thrown)) throw thrown;
		blockers.push(thrown);
	}

	// Row 10: Report, written whole and before any spawn, passing or failing (C17, P6).
	// 04 §5.3 step 10: `blockers` is the session-level list and a per-slot blocker
	// rides on its slot, which is why §5.10's third clause exists at all.
	const passing = blockers.every((one) => one.code === "preflight.concern_dropped") && drift.length === 0 && slots.every((slot) => slot.state !== "unsatisfied");
	const composed = { commit: Object.fromEntries(input.composed.chain.map((node) => [node.ref, node.commit])), tree: input.composed.tree, conflicts: input.composed.conflicts };
	// A boot that failed before Choose has no `Choices`; the report is written anyway.
	const report: PreflightReport = { sessionId: input.sessionId, composed, choices: choices ?? null, plan, slots, drift, passing, blockers, at: new Date().toISOString() };
	await mkdir(input.sessionDir, { recursive: true });
	await writeFile(join(input.sessionDir, "preflight.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
	if (!passing || !input.spawn) await fence?.close();
	return { report, context: passing ? context : null, credentials };
}

/** §5.6. `aliases` arrive in slot order, so the model credential leads. */
async function mint(input: PreflightInput, choices: Choices, aliases: string[]): Promise<Minted> {
	try {
		return await input.api.post<Minted>("/v1/sessions", {
			id: input.sessionId,
			provider: choices.provider.id,
			provider_version: choices.located.version,
			harness: choices.harness?.id ?? null,
			// 04 §5.3's `model: tuple[str, str]` — (ModelProvider.id, model), which is
			// what `api` validates against; an object is refused before the broker runs.
			model: [choices.model.provider.id, choices.model.model],
			aliases,
			commits: Object.fromEntries(input.composed.chain.map((node) => [node.ref, node.commit])),
			// W5-D14: where this session is running and on which machine, so
			// the card can offer *open again in …*. The path is the person's
			// own and the broker stores it on the row alone — never in the
			// audit payload an admin reads (00 §4.10, 04 §5.3).
			workspace: input.workspace,
			hostname: hostname(),
		});
	} catch (cause) {
		if (isBlocker(cause)) throw cause;
		throw { code: "preflight.api_unreachable", message: `Could not reach the Harness API at ${input.api.url}.`, remedy: "Is it running? `harness preflight identity`." } satisfies Blocker;
	}
}

/** §5.8 step 0 (D13): `require:<concern>` on a covering capability boundary. */
function requireConcerns(input: PreflightInput, choices: Choices): void {
	for (const boundary of input.composed.policy.boundaries) {
		if (boundary.kind !== "capability" || !boundary.value.startsWith("require:")) continue;
		if (!covers(boundary.scope, input.composed.chain, choices.harness?.id ?? null)) continue;
		const concern = boundary.value.slice(8) as Concern;
		if (input.adapter.capabilities[concern] === "none") {
			const who = boundary.scope.teams === "all" ? "every team" : boundary.scope.teams.join(", ");
			throw { code: "adapter.unsupported_concern", message: `${who} requires \`${concern}\`, which ${input.adapter.displayName} cannot provide in this mode.`, remedy: "Choose the other provider." } satisfies Blocker;
		}
	}
}

/** §5.8 step 2: the `Rehydrated` the plan says the generated files must encode. */
function expected(input: PreflightInput, choices: Choices, plan: SpawnPlan, loaded: PlanContext["loaded"]): Rehydrated {
	const ids = (kind: string) => loaded.filter((asset) => asset.kind === kind).map((asset) => asset.id);
	return {
		skills: ids("skill"),
		prompts: ids("prompt"),
		instructions: { system_prompt: ids("system_prompt"), memory: ids("memory") },
		// 07 §7/§8: the generated config points at the connector, never the upstream,
		// and never at the credentialed form — the secret rides in a header (05 D70).
		model: plan.connectors.model ? { endpoint: `${new URL(input.proxy.url).origin}/connectors/model`, model: choices.model.model } : null,
		hooks: [],
		// 07 §8: a deny is written as a pattern over the directory, not as a path.
		// One formula for the deny patterns (07 §6): the adapters' own.
		denies: denyPatterns(plan),
		files: {},
	};
}

/** 05 §7 refuses to start with a connector it holds no credential for, and the
    `model` connector's value is the model provider's own alias re-keyed. */
function forFence(credentials: MintedCredential[], choices: Choices, plan: SpawnPlan): MintedCredential[] {
	const model = credentials.find((one) => one.alias === choices.model.provider.credential?.alias);
	return plan.connectors.model && model ? [...credentials, { ...model, alias: "model" }] : credentials;
}

/** The two ways into `LOCAL_PROBES`: a `login` need (§5.4 step 4), and a slot the
    broker deferred on a `vault-or-local` group (§5.5, 04 D60). A `vault` group
    never reaches here — the broker leaves it `unsatisfied`, not `deferred`. */
function localTool(slot: Slot): string | undefined {
	if (slot.need.kind === "login") return slot.need.tool in LOCAL_PROBES ? slot.need.tool : undefined;
	if (slot.need.kind !== "credential" || slot.state !== "deferred" || slot.via?.sources !== "vault-or-local") return undefined;
	return slot.need.alias in LOCAL_PROBES ? slot.need.alias : undefined;
}

/** §5.9: outside the jail, 5 s, a `{ HOME, PATH }`-only environment. */
async function probeLogin(input: PreflightInput, slot: Slot, tool: string): Promise<Slot> {
	const probe = LOCAL_PROBES[tool];
	// D53: a network probe under `--offline` leaves the slot `declared` (P2).
	if (probe.network && input.argv.offline === true) return slot;
	const result = await capture(probe.argv[0], probe.argv.slice(1), { HOME: input.home, PATH: process.env.PATH ?? "" }, 5_000);
	const refuse = (code: string, message: string, remedy: string): Slot => ({ ...slot, state: "unsatisfied", evidence: "declared", resolvedFrom: null, blocker: { code, message, remedy } });
	if (result.absent) return refuse("preflight.login_tool_absent", `\`${tool}\` is not installed, so its login cannot be checked.`, probe.install);
	if (!probe.verified(result)) return refuse("preflight.login_missing", `No \`${tool}\` login on this machine.`, probe.login);
	// The fallback is never silent: `resolved from` says where it came from (D30a).
	return { ...slot, state: "satisfied", evidence: "verified", resolvedFrom: { source: "local", tool }, blocker: undefined };
}

/** Every `<assetsRoot>/tool/<name>` on disk with the id its sidecar carries.
    A directory with no readable sidecar fails closed as `null` (C13). */
async function toolDirs(assetsRoot: string): Promise<PlanContext["toolDirs"]> {
	const root = join(assetsRoot, "tool");
	let names: string[];
	try {
		names = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch {
		return [];
	}
	return Promise.all(
		names.map(async (name) => {
			try {
				return { name, id: (JSON.parse(await readFile(join(root, name, "asset.json"), "utf8")) as { id?: string }).id ?? null };
			} catch {
				return { name, id: null };
			}
		}),
	);
}

function capture(command: string, args: string[], env: Record<string, string>, timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string; absent: boolean }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env, timeout: timeoutMs, killSignal: "SIGKILL" });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		// The one failure mode named here: the binary is not installed (§5.9).
		child.on("error", (error) => ((error as NodeJS.ErrnoException).code === "ENOENT" ? resolve({ code: -1, stdout, stderr, absent: true }) : reject(error)));
		child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr, absent: false }));
	});
}

function isBlocker(thrown: unknown): thrown is Blocker {
	const one = thrown as Blocker | null;
	return typeof one === "object" && one !== null && typeof one.code === "string" && typeof one.message === "string" && typeof one.remedy === "string";
}
