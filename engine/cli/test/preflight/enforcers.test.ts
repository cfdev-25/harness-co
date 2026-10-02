import { join } from "node:path";
import type { Boundary, Enforcer, RenderContext, SpawnPlan } from "@harness/compose/contracts";
import { expect, it } from "vitest";
import { enforcers, type PlanContext, runEnforcers } from "../../src/preflight/enforcers/index.js";
import { asset, choicesFor, composed, fakeAdapter, harness, minted, policy } from "./support.js";

const DIR = "/tmp/preflight-enforcers";

function context(over: Partial<PlanContext> = {}): PlanContext {
	const ctx: PlanContext = {
		adapter: fakeAdapter(),
		located: { path: "/usr/local/bin/claude", version: "2.1.280" },
		loaded: [],
		home: DIR,
		workspace: `${DIR}/workspace`,
		assetsRoot: `${DIR}/assets`,
		sessionId: "s1",
		sessionDir: `${DIR}/session`,
		agentDir: `${DIR}/session/agent`,
		envDir: `${DIR}/envs/h1`,
		proxyUrl: "http://:secret@127.0.0.1:41234",
		passthrough: ["--verbose"],
		toolDirs: [],
		context: (plan: SpawnPlan) => ({ plan, workspace: `${DIR}/workspace` }) as RenderContext,
		...over,
	};
	return ctx;
}

const boundary = (over: Partial<Boundary>): Boundary => ({ id: "b1", scope: { teams: "all" }, kind: "endpoint", value: "x", holds: "enforced", reason: "because", ...over });

it("absent_boundary_is_not_empty_hosts", () => {
	// C32/D20: no endpoint boundary and no reach grant still derives the hosts.
	const one = composed();
	const plan = runEnforcers(one, choicesFor(one), [minted("crm", "v")], enforcers(context()));
	expect(plan.hosts).toEqual(["api.anthropic.com", "api.crm.example"]);
	expect(plan.deny).toEqual([]);
	expect(plan.connectors.crm).toEqual({ upstream: "https://api.crm.example", attach: { header: "Authorization", prefix: "Bearer " } });
});

it("reach_on_leaves_hosts_derived_with_deny_still_applied", () => {
	// D131: `hosts` is only ever the credentialed list now; the rest of the
	// internet is `reach`, which the plan carries beside it.
	const reach = { mode: "on" as const, hosts: [], setBy: "acme" };
	const one = composed({ policy: policy({ reach, boundaries: [boundary({ value: "pastebin.com" })] }) });
	const plan = runEnforcers(one, choicesFor(one), [], enforcers(context()));
	expect(plan.hosts).toEqual(["api.anthropic.com"]);
	expect(plan.reach).toEqual(reach);
	// P3: the deny list is applied whatever reach says.
	expect(plan.deny).toEqual(["pastebin.com"]);
});

it("the_harness_takes_the_last_narrowing_step", () => {
	// D131's fourth step, and the one place that knows both the chain and the
	// chosen harness. A harness that widens is ignored: the chain stands.
	const reach = { mode: "allow" as const, hosts: ["pypi.org", "crates.io"], setBy: "acme" };
	const one = composed({ policy: policy({ reach }) });
	const narrower = harness({ reach: { mode: "allow", hosts: ["pypi.org"] } });
	expect(runEnforcers(one, choicesFor(one, narrower), [], enforcers(context())).reach).toEqual({
		mode: "allow",
		hosts: ["pypi.org"],
		setBy: "harness:h1",
	});
	const wider = harness({ reach: { mode: "on", hosts: [] } });
	expect(runEnforcers(one, choicesFor(one, wider), [], enforcers(context())).reach).toEqual(reach);
});

it("the_model_connector_is_the_endpoint_with_the_entry_attach", () => {
	// 05 §6: `model` is a URL, and only the credential and the allowlist are shared.
	const one = composed();
	const plan = runEnforcers(one, choicesFor(one), [minted("model-key", "v")], enforcers(context()));
	// D134: and the wire format, which is what `shapeModelRequest` reads.
	expect(plan.connectors.model).toEqual({ upstream: "https://api.anthropic.com/v1", attach: { header: "x-api-key", prefix: "" }, wireFormat: "anthropic-messages" });
});

it("excluded_tool_dirs_fail_closed_without_sidecar", () => {
	// C12/C13: out of the load set, denied by a capability boundary, or unclassifiable.
	const inSet = asset("a1", "tool", "deploy");
	const gated = asset("a2", "tool", "release");
	const one = composed({
		assets: [inSet, gated],
		policy: policy({ boundaries: [boundary({ kind: "capability", value: "tool.release" })] }),
	});
	const ctx = context({
		loaded: [inSet, gated],
		toolDirs: [
			{ name: "deploy", id: "a1" },
			{ name: "release", id: "a2" },
			{ name: "stale", id: "a9" },
			{ name: "handmade", id: null },
		],
	});
	const plan = runEnforcers(one, choicesFor(one), [], enforcers(ctx));
	const tool = (name: string) => join(`${DIR}/assets`, "tool", name);
	expect(plan.filesystem.denyRead).toContain(tool("release"));
	expect(plan.filesystem.denyRead).toContain(tool("stale"));
	expect(plan.filesystem.denyRead).toContain(tool("handmade"));
	expect(plan.filesystem.denyRead).not.toContain(tool("deploy"));
	// 06 §7.2's standing set and the adapter's ambient stores ride along.
	expect(plan.filesystem.denyRead).toContain(join(DIR, ".config/harness"));
	expect(plan.filesystem.denyRead).toContain("/home/dana/.claude");
	expect(plan.filesystem.denyWrite).toEqual([`${DIR}/workspace/.claude`]);
	expect(plan.filesystem.allowWrite).toEqual([`${DIR}/workspace`, `${DIR}/assets`, `${DIR}/session/agent`, join(DIR, "session/audit.jsonl"), join(DIR, "session/tmp"), `${DIR}/envs/h1`]);
});

it("the_provider_enforcer_appends_the_passthrough_and_the_environment_is_the_core_set", () => {
	const one = composed();
	const plan = runEnforcers(one, choicesFor(one, harness()), [], enforcers(context()));
	expect(plan.argv).toEqual(["/usr/local/bin/claude", "--verbose"]);
	expect(plan.env.HARNESS_SESSION_ID).toBe("s1");
	expect(plan.env.CLAUDE_HOME).toBe("/x");
	expect(plan.env.HTTPS_PROXY).toBe("http://:secret@127.0.0.1:41234");
});

it("enforcers_never_widen", () => {
	const one = composed();
	const choices = choicesFor(one);
	const list = enforcers(context());
	// Every ordering of the real list is a sequence of tightenings; only the plan
	// it reaches differs, and the runner checks every step.
	for (const order of orderings(list)) expect(() => runEnforcers(one, choices, [], order)).not.toThrow();
	const widen = (name: string, change: (plan: SpawnPlan) => SpawnPlan): Enforcer => ({ name, plan: (_c, _ch, _m, plan) => change(plan) });
	const cases: Enforcer[] = [
		widen("adds-a-host", (plan) => ({ ...plan, hosts: [...plan.hosts, "pastebin.com"] })),
		// D131: reach only ever moves down `on` → `allow` → `off`, and its list
		// only ever tightens, so a step that reverses either is the same bug.
		widen("reopens-reach", (plan) => ({ ...plan, reach: { mode: "on" as const, hosts: [], setBy: "x" } })),
		widen("lengthens-the-allow-list", (plan) => ({ ...plan, reach: { ...plan.reach, hosts: [...plan.reach.hosts, "pastebin.com"] } })),
		widen("drops-a-deny", (plan) => ({ ...plan, deny: [] })),
		widen("unreads", (plan) => ({ ...plan, filesystem: { ...plan.filesystem, denyRead: [] } })),
		widen("rewrites-env", (plan) => ({ ...plan, env: { ...plan.env, HOME: "/elsewhere" } })),
		widen("rewrites-argv", (plan) => ({ ...plan, argv: ["/bin/sh"] })),
		widen("opens-a-write", (plan) => ({ ...plan, filesystem: { ...plan.filesystem, allowWrite: [...plan.filesystem.allowWrite, "/"] } })),
	];
	const denied = composed({
		policy: policy({ reach: { mode: "allow", hosts: ["pypi.org"], setBy: "acme" }, boundaries: [boundary({ value: "pastebin.com" })] }),
	});
	for (const bug of cases) {
		// A widening is a bug, so it is thrown — never a Blocker the person sees.
		expect(() => runEnforcers(denied, choicesFor(denied), [], [...list, bug])).toThrowError(/widened/);
	}
});

/** Every ordering of a five-element list is 120 runs; that is the "random orderings" of §5.7 done exhaustively. */
function orderings<T>(list: readonly T[]): T[][] {
	if (list.length <= 1) return [[...list]];
	return list.flatMap((item, at) => orderings([...list.slice(0, at), ...list.slice(at + 1)]).map((rest) => [item, ...rest]));
}

it("command_boundaries_reach_the_plan_scoped_and_deduplicated", () => {
	// W6-D153, 03 §5.7 row 6. The plan is where both adapters read them, so a
	// boundary that does not cover this session must not be on it, and a
	// pattern two nodes set is one refusal with the first node's id on it.
	const one = composed({
		policy: policy({
			boundaries: [
				boundary({ id: "acme/b-wipe", kind: "command", value: "rm -rf /*", holds: "intercepted", reason: "never a step in a task" }),
				boundary({ id: "acme.marketing/b-wipe", kind: "command", value: "rm -rf /*", holds: "intercepted", reason: "said twice" }),
				boundary({ id: "acme/b-else", kind: "command", value: "shutdown*", holds: "intercepted", reason: "not ours to do", scope: { teams: ["acme.eng"] } }),
				boundary({ id: "acme/b-host", value: "pastebin.com" }),
			],
		}),
	});
	const plan = runEnforcers(one, choicesFor(one), [], enforcers(context()));
	expect(plan.commands).toEqual([
		{ id: "acme/b-wipe", pattern: "rm -rf /*", reason: "never a step in a task" },
	]);
	// An endpoint boundary is still an endpoint boundary and goes nowhere near here.
	expect(plan.deny).toEqual(["pastebin.com"]);
});

it("an_enforcer_that_drops_a_command_boundary_is_a_bug_not_a_plan", () => {
	// Tighten-only covers `commands` like every other deny: dropping one would
	// turn a boundary into a suggestion, silently.
	const one = composed({
		policy: policy({ boundaries: [boundary({ id: "acme/b-wipe", kind: "command", value: "rm -rf /*", holds: "intercepted", reason: "never" })] }),
	});
	const greedy: Enforcer = { name: "greedy", plan: (_c, _ch, _m, plan) => ({ ...plan, commands: [] }) };
	expect(() => runEnforcers(one, choicesFor(one), [], [...enforcers(context()), greedy])).toThrow(
		"the greedy enforcer widened commands",
	);
});
