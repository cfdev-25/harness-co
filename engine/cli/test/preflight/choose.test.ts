import type { Blocker, Chain } from "@harness/compose/contracts";
import { expect, it } from "vitest";
import { choose } from "../../src/preflight/choose.js";
import { ADMIN, composed, harness, ME, policy } from "./support.js";

/** D119: every run is in a harness; the fixture's is h1. */
const SEL = { harness_id: "h1" };

/** Every step of 03 §5.2 refuses by throwing its `Blocker`. */
function refusal(run: () => unknown): Blocker {
	try {
		run();
	} catch (thrown) {
		return thrown as Blocker;
	}
	throw new Error("expected a Blocker");
}

it("choose_refuses_not_approved", () => {
	const providers = policy().harnessProviders;
	providers.claude = { ...providers.claude, approval: "not-approved", reason: "the security review is open" };
	// Step 2 refuses before the harness, the grants or the model are looked at.
	const one = composed({ policy: policy({ harnessProviders: providers, routing: { defaultFor: { teams: {}, harnesses: {}, providers: {} }, approvedFor: { teams: {}, harnesses: {}, providers: {} } } }) });
	const blocker = refusal(() => choose(one, {}, { harness_id: "h1" }, ME));
	expect(blocker.code).toBe("preflight.provider_not_approved");
	expect(blocker.message).toBe("claude is not approved for use: the security review is open.");
	expect(blocker.remedy).toBe("Ask an organization admin to approve it.");
	expect(blocker.link).toBe("/console/org/providers");
});

it("beta_requires_admin", () => {
	const providers = policy().harnessProviders;
	providers.claude = { ...providers.claude, approval: "beta" };
	const one = composed({ policy: policy({ harnessProviders: providers }) });
	const blocker = refusal(() => choose(one, {}, { harness_id: "h1" }, ME));
	expect(blocker.code).toBe("preflight.provider_beta");
	expect(blocker.message).toBe("claude is in beta; only an admin may be handed credentials with it.");
	expect(blocker.remedy).toBe("Ask an admin to approve it, or run an approved runtime.");
	// D50: the broker re-checks the same rule at mint; here it only buys a good error.
	expect(choose(one, {}, { harness_id: "h1" }, ADMIN).provider.approval).toBe("beta");
});

it("choose_refuses_an_unknown_or_ambiguous_provider_word", () => {
	const two = policy().harnessProviders;
	two.pi = { id: "pi", approval: "approved", scope: { teams: "all" }, pin: { repo: "pi", commit: "abc" }, speaks: ["anthropic-messages"] };
	const unknown = refusal(() => choose(composed(), { provider: "cursor" }, SEL, ME));
	expect(unknown.code).toBe("preflight.provider_unknown");
	expect(unknown.message).toBe("`cursor` is not a runtime your organization has listed. Listed: claude.");
	expect(unknown.remedy).toBe("harness run claude");
	const ambiguous = refusal(() => choose(composed({ policy: policy({ harnessProviders: two }) }), {}, SEL, ME));
	expect(ambiguous.code).toBe("preflight.provider_ambiguous");
	expect(ambiguous.message).toBe("Say which runtime: claude, pi.");
	expect(ambiguous.remedy).toBe("harness run claude");
});

it("choose_refuses_a_provider_out_of_scope", () => {
	const providers = policy().harnessProviders;
	providers.claude = { ...providers.claude, scope: { teams: ["acme.engineering"] } };
	const blocker = refusal(() => choose(composed({ policy: policy({ harnessProviders: providers }) }), {}, SEL, ME));
	expect(blocker.code).toBe("preflight.provider_out_of_scope");
	expect(blocker.message).toBe("claude is approved for acme.engineering, not for acme.marketing.interns.");
	expect(blocker.remedy).toBe("Ask an organization admin to widen its approval scope.");
	expect(blocker.link).toBe("/console/org/providers");
});

it("choose_prefers_harness_default_then_provider_then_team", () => {
	// D8: harness → provider → team, each overriding the one after it.
	const routing = {
		defaultFor: { teams: { "acme.marketing": "team-mp" }, harnesses: { h1: "harness-mp" }, providers: { claude: "provider-mp" } },
		approvedFor: { teams: { "acme.marketing": ["team-mp", "provider-mp", "harness-mp"] }, harnesses: {}, providers: {} },
	};
	const providers = policy().modelProviders;
	for (const id of ["team-mp", "provider-mp", "harness-mp"]) {
		providers[id] = { id, endpoints: { "anthropic-messages": `https://${id}.example/v1` }, models: [`${id}-1`] };
	}
	// Two harnesses: h1 has a default of its own, `Sales` (h2) does not.
	const one = composed({ policy: policy({ routing, modelProviders: providers }), harnesses: [harness(), harness({ id: "h2", name: "Sales" })] });
	expect(choose(one, { harnessFlag: "Support" }, undefined, ME).model.provider.id).toBe("harness-mp");
	expect(choose(one, {}, { harness_id: "h2" }, ME).model.provider.id).toBe("provider-mp");
	const noProvider = { ...routing, defaultFor: { ...routing.defaultFor, providers: {} } };
	expect(choose(composed({ policy: policy({ routing: noProvider, modelProviders: providers }), harnesses: [harness({ id: "h2", name: "Sales" })] }), {}, { harness_id: "h2" }, ME).model.provider.id).toBe("team-mp");
});

it("model_flag_within_approved", () => {
	// D23: the default is never absolute.
	const chosen = choose(composed(), { model: "anthropic/claude-haiku-5" }, SEL, ME);
	expect(chosen.model.model).toBe("claude-haiku-5");
	const blocker = refusal(() => choose(composed(), { model: "mistral/big" }, SEL, ME));
	expect(blocker.code).toBe("preflight.model_not_approved");
	expect(blocker.message).toBe("mistral is not approved for acme.marketing.interns. Approved: anthropic, openrouter.");
	expect(blocker.remedy).toBe("--model anthropic/<id>");
	const unknown = refusal(() => choose(composed(), { model: "anthropic/opus-9" }, SEL, ME));
	expect(unknown.code).toBe("preflight.model_unknown");
	expect(unknown.message).toBe("anthropic lists no model called `opus-9`.");
	expect(unknown.remedy).toBe("Choose one of: claude-sonnet-5, claude-haiku-5.");
});

it("format_mismatch_names_both_sides", () => {
	// C19: the message carries the runtime's formats and the provider's.
	const blocker = refusal(() => choose(composed(), { model: "openrouter/auto" }, SEL, ME));
	expect(blocker.code).toBe("preflight.format_mismatch");
	expect(blocker.message).toBe("claude speaks anthropic-messages, but openrouter exposes openai-completions.");
	expect(blocker.remedy).toContain("Route Support through a provider exposing anthropic-messages");
	expect(blocker.remedy).toContain("run a runtime that speaks openai-completions");
});

it("choose_refuses_when_routing_has_no_approval_or_no_default", () => {
	const none = policy({ routing: { defaultFor: { teams: {}, harnesses: {}, providers: {} }, approvedFor: { teams: {}, harnesses: {}, providers: {} } } });
	const approvedOnly = policy({ routing: { defaultFor: { teams: {}, harnesses: {}, providers: {} }, approvedFor: { teams: { "acme.marketing": ["anthropic"] }, harnesses: {}, providers: {} } } });
	const wrongDefault = policy({
		routing: { defaultFor: { teams: { "acme.marketing": "openrouter" }, harnesses: {}, providers: {} }, approvedFor: { teams: { "acme.marketing": ["anthropic"] }, harnesses: {}, providers: {} } },
	});
	expect(refusal(() => choose(composed({ policy: none }), {}, SEL, ME))).toMatchObject({
		code: "preflight.model_none_approved",
		message: "No model provider is approved for acme.marketing.interns.",
		remedy: "Ask an organization admin to approve one.",
	});
	expect(refusal(() => choose(composed({ policy: approvedOnly }), {}, SEL, ME))).toMatchObject({
		code: "preflight.model_no_default",
		message: "No model provider is the default for Support/claude/acme.marketing.interns.",
		remedy: "Ask an organization admin to set one.",
	});
	expect(refusal(() => choose(composed({ policy: wrongDefault }), {}, SEL, ME))).toMatchObject({
		code: "preflight.model_default_not_approved",
		message: "openrouter is the default here but is not approved for acme.marketing.interns.",
		remedy: "Ask an organization admin to approve it, or to change the default.",
	});
});

it("choose_names_the_harnesses_when_a_flag_matches_none_or_many", () => {
	const two = [harness(), harness({ id: "h2", name: "support" })];
	const unknown = refusal(() => choose(composed({ harnesses: [harness()] }), { harnessFlag: "Sales" }, SEL, ME));
	expect(unknown.code).toBe("preflight.harness_unknown");
	expect(unknown.message).toBe("No harness called `Sales`. You have: Support.");
	expect(unknown.remedy).toBe("harness switch");
	const ambiguous = refusal(() => choose(composed({ harnesses: two }), { harnessFlag: "support" }, SEL, ME));
	expect(ambiguous.code).toBe("preflight.harness_ambiguous");
	expect(ambiguous.message).toBe("`support` names more than one harness: Support (h1), support (h2).");
	expect(ambiguous.remedy).toBe("harness run --h1");
});

it("choose_reads_the_view_from_the_flag_or_the_selection", () => {
	expect(choose(composed(), {}, SEL, ME).view).toBe("mine");
	expect(choose(composed(), { team: true }, SEL, ME).view).toBe("team");
	expect(choose(composed(), {}, { harness_id: "h1", version: "team" }, ME).view).toBe("team");
});

it("choose_collects_the_grants_covering_this_harness", () => {
	const grants = [
		{ id: "g-mkt", scope: { teams: ["acme.marketing"] }, group: "marketing", by: "rae" },
		{ id: "g-crm", scope: { teams: ["acme.marketing"] }, group: "marketing", by: "rae" },
		{ id: "g-other", scope: { teams: ["acme.engineering"] }, group: "marketing", by: "rae" },
	];
	const chosen = choose(composed({ policy: policy({ grants }) }), {}, SEL, ME);
	expect(chosen.grants.map((one) => one.id)).toEqual(["g-mkt", "g-crm"]);
	// D132: Choose derives no reach at all — it is `policy/reach.json`, composed.
	expect(chosen).not.toHaveProperty("outsideEndpoints");
});

it("native_when_no_grant_covers_the_model_credential", () => {
	// D9's last row / D11: Choose says so rather than refusing.
	expect(choose(composed(), {}, SEL, ME).native).toBe(false);
	expect(choose(composed({ policy: policy({ grants: [] }) }), {}, SEL, ME).native).toBe(true);
	const narrowed = [{ id: "g-mkt", scope: { teams: ["acme.marketing"] }, group: "marketing", narrowedFrom: { grant: "g-org", aliases: ["crm"] }, by: "rae" }];
	expect(choose(composed({ policy: policy({ grants: narrowed }) }), {}, SEL, ME).native).toBe(true);
});

it("a_provider_with_no_credential_at_all_is_native_too", () => {
	// W7-D2 retires *gateway mode is never native*: W6-D6 already retired the
	// keyless gateway provider, so a row that names no alias is not an
	// organization model — it is a key that reaches nobody, which is the same
	// fact the broker reads (`broker.needs_key`). `preflight.ts` is what then
	// asks whether this runtime actually signs in to it.
	const providers = { ...policy().modelProviders, anthropic: { ...policy().modelProviders.anthropic, credential: undefined } };
	expect(choose(composed({ policy: policy({ modelProviders: providers }) }), {}, SEL, ME).native).toBe(true);
});

it("routing_default_under_org_path_applies_to_org_user_chain", () => {
	// D30i: a personal account (org · user) keys its one default under the org
	// path, with no team invented for it — and a team's key still overrides it.
	const personal: Chain = [
		{ kind: "org", path: "acme", ref: "refs/heads/org", commit: "c0" },
		{ kind: "user", path: "acme.dana", ref: "refs/heads/users/dana", commit: "c1" },
	];
	const routing = {
		defaultFor: { teams: { acme: "anthropic" }, harnesses: {}, providers: {} },
		approvedFor: { teams: { acme: ["anthropic", "openrouter"] }, harnesses: {}, providers: {} },
	};
	const one = composed({ chain: personal, policy: policy({ routing }) });
	expect(choose(one, {}, { harness_id: "h1" }, ME).model.provider.id).toBe("anthropic");

	const beaten = { ...routing, defaultFor: { ...routing.defaultFor, teams: { acme: "openrouter", "acme.marketing": "anthropic" } } };
	expect(choose(composed({ policy: policy({ routing: beaten }) }), {}, SEL, ME).model.provider.id).toBe("anthropic");
});

it("run_refuses_without_a_harness (D119)", () => {
	// A session is always in a harness: no flag and no selection is a refusal, not "everything".
	expect(refusal(() => choose(composed({ policy: policy({ harnessProviders: { pi: { id: "pi", approval: "approved", scope: { teams: "all" }, pin: { repo: "pi", commit: "c" }, speaks: ["anthropic-messages"] } } }) }), { provider: "pi" }, undefined, ME)).code).toBe("cli.no_harness");
});
