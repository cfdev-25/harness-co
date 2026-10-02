import { mkdtempSync } from "node:fs";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { Blocker, PreflightReport, Slot } from "@harness/compose/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderReport } from "../../src/preflight/report.js";
import { asset, composed, fakeAdapter, fakeApi, harness, minted, policy, REHYDRATED, input as baseInput } from "./support.js";

/** The jail is 06's and is tested there; here it is stubbed so 03's own order
    and refusals are what the test observes (10 rule 17's one allowance is the
    network edge, so the sandbox stub is confined to the two calls preflight makes). */
const sandbox = vi.hoisted(() => ({
	probeSandbox: vi.fn(async () => undefined),
	confine: vi.fn((_plan: unknown, argv: string[]) => ({ command: argv[0], args: argv.slice(1) })),
	installProbeBinary: vi.fn(() => "/dev/null"),
}));
vi.mock("../../src/sandbox/index.js", () => sandbox);

const { preflight } = await import("../../src/preflight/preflight.js");

let dir: string;
let path: string;
const PATH = process.env.PATH;
// D30l: preflight makes the harness's environment under HARNESS_HOME — once for
// this file, never in the real home.
process.env.HARNESS_HOME = mkdtempSync(join(tmpdir(), "harness-preflight-home-"));

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "preflight-"));
	path = join(dir, "session", "preflight.json");
	sandbox.probeSandbox.mockClear();
	sandbox.probeSandbox.mockImplementation(async () => undefined);
});

afterEach(() => {
	process.env.PATH = PATH;
});

const input = (over = {}) => baseInput(dir, over);
const written = async (): Promise<PreflightReport> => JSON.parse(await readFile(path, "utf8")) as PreflightReport;
const satisfied = (alias: string): Slot => ({
	need: { kind: "credential", alias },
	state: "satisfied",
	evidence: "verified",
	resolvedFrom: { source: "vault", vault: "aws-prod", group: "marketing", grant: "g-mkt" },
});

it("report_written_before_spawn", async () => {
	// C17/P6: whole, on disk, before anything the caller could spawn exists.
	const passing = await preflight(input({ api: fakeApi({ credentials: [minted("model-key", "v")], slots: [satisfied("model-key")] }) }));
	expect(passing.report.passing).toBe(true);
	expect(passing.context).not.toBeNull();
	const onDisk = await written();
	expect(onDisk).toEqual(passing.report);
	expect(Object.keys(onDisk).sort()).toEqual(["at", "blockers", "choices", "composed", "drift", "passing", "plan", "sessionId", "slots"]);
	expect((await stat(path)).mode & 0o777).toBe(0o600);

	// And on failure: the same file, written whole, with no context to spawn from.
	const failing = await preflight(input({ sessionDir: join(dir, "second"), api: fakeApi({ blockers: [{ code: "broker.vault_unavailable", message: "no", remedy: "try" }] }) }));
	expect(failing.report.passing).toBe(false);
	expect(failing.context).toBeNull();
	expect(JSON.parse(await readFile(join(dir, "second", "preflight.json"), "utf8")).blockers[0].code).toBe("broker.vault_unavailable");
});

it("no_credential_value_in_report", async () => {
	const secret = "sk-live-DO-NOT-LEAK";
	await preflight(input({ api: fakeApi({ credentials: [minted("model-key", secret)], slots: [satisfied("model-key")] }) }));
	// Negative test (DoD): the value is nowhere in the session directory at all.
	for (const name of await readdir(join(dir, "session"), { recursive: true, withFileTypes: true })) {
		if (!name.isFile()) continue;
		expect(await readFile(join(name.parentPath, name.name), "utf8")).not.toContain(secret);
	}
});

it("mint_replaces_slots_alias_for_alias", async () => {
	const seen: unknown[] = [];
	const broker: Slot = { ...satisfied("model-key"), evidence: "harness-reported", resolvedFrom: { source: "vault", vault: "azure-kv", group: "central", grant: "g-org" } };
	const result = await preflight(input({ api: fakeApi({ credentials: [minted("model-key", "v")], slots: [broker] }, seen) }));
	// The broker's evidence and `resolvedFrom` are authoritative (§5.6).
	expect(result.report.slots).toEqual([broker]);
	expect(seen).toHaveLength(1);
	expect(seen[0]).toMatchObject({
		provider: "claude",
		provider_version: "2.1.280",
		harness: "h1",
		model: ["anthropic", "claude-sonnet-5"],
		aliases: ["model-key"],
		commits: { "refs/heads/org": "c0", "refs/heads/users/dana": "c3" },
		// W5-D141: where this session runs and on which machine, so the card
		// can offer *open again in …*.
		workspace: `${dir}/workspace`,
		hostname: hostname(),
	});
});

it("broker_refusal_is_final", async () => {
	const seen: unknown[] = [];
	const fence = vi.fn(async () => ({ close: async () => undefined }));
	const refusal: Blocker = { code: "broker.vault_unavailable", message: "The vault aws-prod did not answer.", remedy: "Retry in a moment." };
	const result = await preflight(input({ fence, api: fakeApi({ blockers: [refusal] }, seen) }));
	// I4: no retry with another alias or grant, and nothing to spawn.
	expect(seen).toHaveLength(1);
	expect(result.report.blockers).toEqual([refusal]);
	expect(result.context).toBeNull();
	expect(fence).not.toHaveBeenCalled();
});

it("api_unreachable_names_the_url", async () => {
	const api = { url: "http://127.0.0.1:8400", post: async () => { throw new Error("fetch failed"); } };
	const result = await preflight(input({ api }));
	expect(result.report.blockers[0]).toEqual({
		code: "preflight.api_unreachable",
		message: "Could not reach the Harness API at http://127.0.0.1:8400.",
		remedy: "Is it running? `harness preflight identity`.",
	});
});

it("drift_fails_preflight", async () => {
	const adapter = fakeAdapter({ rehydrate: async () => ({ ...REHYDRATED, skills: ["a-skill-render-invented"] }) });
	const one = composed({ assets: [asset("a1", "skill", "triage")] });
	const result = await preflight(input({ adapter, composed: one, api: fakeApi({ credentials: [minted("model-key", "v")], slots: [satisfied("model-key")] }) }));
	expect(result.report.passing).toBe(false);
	expect(result.report.drift.map((one) => Object.keys(one.expected as object)[0])).toEqual(["skills", "model", "denies"]);
	const blocker = result.report.blockers[0];
	expect(blocker.code).toBe("preflight.drift");
	expect(blocker.message).toBe('rendered.json does not match the plan: skills expected ["a1"], got ["a-skill-render-invented"].');
	expect(blocker.remedy).toBe("This is a bug in the Claude Code adapter; report it with `harness preflight --json`.");
});

it("unexpected_probe_success_aborts", async () => {
	const refusal: Blocker = {
		code: "sandbox.probe_unexpected_success",
		message: "The sandbox self-test for read succeeded when it should have been refused. The jail does not hold on this machine, so no session will start.",
		remedy: "Run `harness preflight sandbox` and send its output to your administrator.",
	};
	sandbox.probeSandbox.mockImplementation(async () => {
		throw refusal;
	});
	const result = await preflight(input({ api: fakeApi({ credentials: [minted("model-key", "v")], slots: [satisfied("model-key")] }) }));
	// P9/C26: surfaced verbatim, the boot ends, and the report still lands.
	expect(result.report.blockers).toEqual([refusal]);
	expect(result.report.passing).toBe(false);
	expect((await written()).blockers[0].code).toBe("sandbox.probe_unexpected_success");
});

it("the_failing_report_and_a_preflight_run_both_close_the_fence", async () => {
	const close = vi.fn(async () => undefined);
	const fence = async () => ({ close });
	await preflight(input({ spawn: false, fence, api: fakeApi({ credentials: [minted("model-key", "v")], slots: [satisfied("model-key")] }) }));
	expect(close).toHaveBeenCalledTimes(1); // D55: `harness preflight` closes it again.
	close.mockClear();
	await preflight(input({ spawn: true, fence, api: fakeApi({ credentials: [minted("model-key", "v")], slots: [satisfied("model-key")] }) }));
	expect(close).not.toHaveBeenCalled(); // `run` hands it to the session.
});

it("harness_flag_never_writes_selection", async () => {
	const selectionPath = join(dir, "harness.json");
	await writeFile(selectionPath, '{"harness_id":"h1","name":"Support"}');
	const one = composed({ harnesses: [harness(), harness({ id: "h2", name: "Sales" })] });
	const result = await preflight(input({ composed: one, selectionPath, argv: { harnessFlag: "Sales", passthrough: [] }, api: fakeApi({ credentials: [minted("model-key", "v")], slots: [satisfied("model-key")] }) }));
	expect(result.report.choices.harness?.id).toBe("h2");
	expect(await readFile(selectionPath, "utf8")).toBe('{"harness_id":"h1","name":"Support"}');
});

it("harness_gone_deletes_selection_and_refuses", async () => {
	const selectionPath = join(dir, "harness.json");
	await writeFile(selectionPath, '{"harness_id":"h9","name":"Retired"}');
	const result = await preflight(input({ selectionPath, selection: { harness_id: "h9", name: "Retired" } }));
	expect(result.report.blockers[0]).toEqual({
		code: "preflight.harness_gone",
		message: "Your harness `Retired` no longer exists, or is no longer shared with you.",
		remedy: "harness switch",
	});
	await expect(stat(selectionPath)).rejects.toThrow();
	// The report is written even though Choose never produced a `Choices`.
	expect((await written()).passing).toBe(false);
});

it("nothing_rounds_up", async () => {
	// D53/P2: `--offline` skips the network probes and the slot stays `declared`.
	const one = composed({ assets: [asset("a1", "tool", "deploy", { needs: [{ kind: "login", tool: "aws" }] })] });
	const result = await preflight(
		input({ composed: one, argv: { offline: true, passthrough: [] }, api: fakeApi({ credentials: [minted("model-key", "v")], slots: [satisfied("model-key")] }) }),
	);
	const login = result.report.slots.find((slot) => slot.need.kind === "login") as Slot;
	expect(login).toMatchObject({ state: "unsatisfied", evidence: "declared", resolvedFrom: null });
	expect(login.blocker).toBeUndefined();
	expect(result.report.passing).toBe(false);
});

// ---------------------------------------------------------------------------
// T3: the local probes, against a real child process
// ---------------------------------------------------------------------------

/** A `gh` on `PATH` that records the environment it was handed and exits `code`. */
async function fakeGh(code: number): Promise<string> {
	const bin = join(dir, "bin");
	await writeFile(join(dir, "seen"), "", { flag: "w" });
	await import("node:fs/promises").then((fs) => fs.mkdir(bin, { recursive: true }));
	await writeFile(join(bin, "gh"), `#!/bin/sh\nenv > ${join(dir, "seen")}\nexit ${code}\n`, { mode: 0o755 });
	process.env.PATH = `${bin}:${PATH}`;
	return join(dir, "seen");
}

const withLogin = (tool: string) => composed({ assets: [asset("a1", "tool", "deploy", { needs: [{ kind: "login", tool }] })] });
const filled = () => fakeApi({ credentials: [minted("model-key", "v")], slots: [satisfied("model-key")] });

it("local_probe_env_is_home_and_path_only", async () => {
	const seen = await fakeGh(0);
	const result = await preflight(input({ composed: withLogin("gh"), api: filled() }));
	const keys = (await readFile(seen, "utf8")).split("\n").filter(Boolean).map((line) => line.slice(0, line.indexOf("=")));
	expect(keys.sort()).toEqual(["HOME", "PATH", "PWD", "SHLVL", "_"].filter((key) => keys.includes(key)).sort());
	expect(keys).not.toContain("HARNESS_API_TOKEN");
	expect(keys.filter((key) => key === "HOME" || key === "PATH").sort()).toEqual(["HOME", "PATH"]);
	const login = result.report.slots.find((slot) => slot.need.kind === "login") as Slot;
	expect(login).toMatchObject({ state: "satisfied", evidence: "verified", resolvedFrom: { source: "local", tool: "gh" } });
});

it("a_local_probe_that_finds_nothing_or_no_tool_names_both", async () => {
	await fakeGh(1);
	const missing = await preflight(input({ composed: withLogin("gh"), api: filled() }));
	expect((missing.report.slots.find((slot) => slot.need.kind === "login") as Slot).blocker).toEqual({
		code: "preflight.login_missing",
		message: "No `gh` login on this machine.",
		remedy: "gh auth login",
	});
	process.env.PATH = join(dir, "empty");
	const absent = await preflight(input({ composed: withLogin("gh"), api: filled() }));
	const blocker = (absent.report.slots.find((slot) => slot.need.kind === "login") as Slot).blocker as Blocker;
	expect(blocker.code).toBe("preflight.login_tool_absent");
	expect(blocker.message).toBe("`gh` is not installed, so its login cannot be checked.");
	expect(blocker.remedy).toContain("Install the GitHub CLI");
});

it("deferred_slot_consults_local_only_when_via_allows", async () => {
	const seen = await fakeGh(0);
	const groups = policy().groups;
	groups.marketing.entries.push({ alias: "gh", secret: { vault: "aws-prod", ref: "g" }, upstream: "https://api.github.com", attach: { header: "Authorization", prefix: "Bearer " } });
	const one = composed({ policy: policy({ groups }), assets: [asset("a1", "tool", "deploy", { needs: [{ kind: "credential", alias: "gh" }] })] });
	const deferred: Slot = { need: { kind: "credential", alias: "gh" }, state: "deferred", evidence: "declared", resolvedFrom: null, via: { grant: "g-mkt", group: "marketing", sources: "vault-or-local" } };
	const result = await preflight(input({ composed: one, api: fakeApi({ credentials: [minted("model-key", "v")], slots: [satisfied("model-key"), deferred] }) }));
	// D52: the local leg is entered only after the broker deferred, and the
	// fallback is never silent — `resolved from` says where it came from (D30a).
	expect(result.report.slots[1]).toMatchObject({ state: "satisfied", evidence: "verified", resolvedFrom: { source: "local", tool: "gh" } });
	expect(await readFile(seen, "utf8")).not.toBe("");
});

it("local_leg_only_for_vault_or_local", async () => {
	const seen = await fakeGh(0);
	const groups = policy().groups;
	groups.marketing.entries.push({ alias: "gh", secret: { vault: "aws-prod", ref: "g" }, upstream: "https://api.github.com", attach: { header: "Authorization", prefix: "Bearer " } });
	const one = composed({ policy: policy({ groups }), assets: [asset("a1", "tool", "deploy", { needs: [{ kind: "credential", alias: "gh" }] })] });
	const refused: Slot = {
		need: { kind: "credential", alias: "gh" },
		state: "unsatisfied",
		evidence: "declared",
		resolvedFrom: null,
		via: { grant: "g-mkt", group: "marketing", sources: "vault" },
		blocker: { code: "broker.vault_unavailable", message: "The vault aws-prod did not answer.", remedy: "Retry in a moment." },
	};
	const result = await preflight(input({ composed: one, api: fakeApi({ credentials: [minted("model-key", "v")], slots: [satisfied("model-key"), refused] }) }));
	// A `vault` group never reaches the local probe: the binary was never run.
	expect(await readFile(seen, "utf8")).toBe("");
	expect(result.report.slots[1]).toEqual(refused);
	expect(result.report.passing).toBe(false);
});

it("concern_dropped_is_recorded_and_does_not_fail", async () => {
	// D54: a concern fails the boot only when a `require:` boundary names it.
	const said: string[] = [];
	const adapter = fakeAdapter({ render: async () => ({ honoured: [], dropped: [{ concern: "audit" as const, why: "Pi has no hook mechanism." }] }) });
	const result = await preflight(input({ adapter, notify: (line: string) => said.push(line), api: filled() }));
	expect(said.filter((line) => !line.startsWith("Made this harness's Python environment"))).toEqual(["Claude Code cannot do audit; continuing without it."]);
	expect(result.report.blockers).toEqual([{ code: "preflight.concern_dropped", message: "Claude Code cannot do audit; continuing without it.", remedy: "Pi has no hook mechanism." }]);
	expect(result.report.passing).toBe(true);
});

it("a_required_concern_refuses_before_render", async () => {
	// D13/§5.8 step 0: `require:<concern>` on a covering capability boundary.
	let rendered = false;
	const adapter = fakeAdapter({
		capabilities: { ...fakeAdapter().capabilities, audit: "none" },
		render: async () => {
			rendered = true;
			return { honoured: [], dropped: [] };
		},
	});
	const boundaries = [{ id: "b1", scope: { teams: ["acme.marketing"] }, kind: "capability" as const, value: "require:audit", holds: "enforced" as const, reason: "approvals are recorded" }];
	const result = await preflight(input({ adapter, composed: composed({ policy: policy({ boundaries }) }), api: filled() }));
	expect(rendered).toBe(false);
	expect(result.report.blockers[0]).toEqual({
		code: "adapter.unsupported_concern",
		message: "acme.marketing requires `audit`, which Claude Code cannot provide in this mode.",
		remedy: "Choose the other provider.",
	});
});

it("native_mode_defers_the_model_slot_and_never_asks_the_broker_for_it", async () => {
	// D11: no covering grant, an adapter that can use its own sign-in. The slot is
	// `deferred` (which does not block, §5.10) and the alias is not minted, because
	// asking would refuse the session (04 §5.3 step 6).
	const seen: unknown[] = [];
	const one = composed({ policy: policy({ grants: [] }) });
	const result = await preflight(input({ composed: one, api: fakeApi({}, seen) }));
	expect(result.report.choices.native).toBe(true);
	expect(result.report.slots).toEqual([{ need: { kind: "credential", alias: "model-key" }, state: "deferred", evidence: "declared", resolvedFrom: { source: "local", tool: "claude" } }]);
	expect(seen[0]).toMatchObject({ aliases: [] });
	expect(result.report.passing).toBe(true);
	// C20/C22: no `model` connector at all, so model traffic is a tunnel.
	expect(result.context?.plan.connectors.model).toBeUndefined();
});

it("an_adapter_that_cannot_sign_in_itself_is_never_native", async () => {
	const adapter = fakeAdapter({ capabilities: { ...fakeAdapter().capabilities, model_native: "none" } });
	const one = composed({ policy: policy({ grants: [] }) });
	const result = await preflight(input({ adapter, composed: one, api: fakeApi({}) }));
	expect(result.report.choices.native).toBe(false);
	expect(result.report.slots[0].blocker?.code).toBe("preflight.no_compatible_group");
});

it("an_adapter_with_no_sign_in_for_this_provider_is_never_native", async () => {
	// W7-D2: `model_native` says a runtime can use its own login; `modelNative`
	// says which providers it has one *for*. Claiming native for a provider it
	// cannot sign in to would print *your own sign-in · not metered* over a
	// session the broker refuses at step 5, so the two have to be one answer.
	const adapter = fakeAdapter({ modelNative: ["openai-codex"] });
	const one = composed({ policy: policy({ grants: [] }) });
	const result = await preflight(input({ adapter, composed: one, api: fakeApi({}) }));
	expect(result.report.choices.native).toBe(false);
	expect(result.report.slots[0].blocker?.code).toBe("preflight.no_compatible_group");
});

it("a_slot_blocker_rides_on_its_slot_and_not_in_the_session_list", async () => {
	// 04 §5.3 step 10: the record keeps them apart; `run` prints both (§5.10).
	const one = composed({ policy: policy({ grants: [] }) });
	const adapter = fakeAdapter({ capabilities: { ...fakeAdapter().capabilities, model_native: "none" } });
	const result = await preflight(input({ adapter, composed: one, api: fakeApi({}) }));
	expect(result.report.blockers).toEqual([]);
	expect(result.report.slots[0].blocker?.code).toBe("preflight.no_compatible_group");
	expect(result.report.passing).toBe(false);
	expect(renderReport(result.report, "run")).toContain("holds no group with an entry for `model-key`");
});
