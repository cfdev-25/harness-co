import type { Choices, Grant, Slot } from "@harness/compose/contracts";
import { expect, it } from "vitest";
import { walkNeeds } from "../../src/preflight/needs.js";
import { asset, choicesFor, composed, harness, policy } from "./support.js";

const alias = (slots: Slot[], name: string) => slots.find((slot) => slot.need.kind === "credential" && slot.need.alias === name) as Slot;
const walk = (one: ReturnType<typeof composed>, choices: Choices, loaded = one.assets, missing: string[] = []) =>
	walkNeeds(one, choices, { loaded, missing });

it("no_compatible_group_names_the_admin_action", () => {
	// 03 §5.4 step 3, the PRD's two sentences: a sub-team asks its parent, a
	// top-level team asks the organization.
	const one = composed({ policy: policy({ grants: [] }), assets: [asset("a1", "skill", "triage", { needs: [{ kind: "credential", alias: "crm" }] })] });
	const sub = alias(walk(one, choicesFor(one)).slots, "crm");
	expect(sub.state).toBe("unsatisfied");
	expect(sub.evidence).toBe("declared");
	expect(sub.blocker?.code).toBe("preflight.no_compatible_group");
	expect(sub.blocker?.message).toBe("acme.marketing.interns holds no group with an entry for `crm`.");
	expect(sub.blocker?.remedy).toBe("Ask a acme.marketing admin to narrow one into the sub-team.");

	const top = composed({ ...one, chain: one.chain.filter((node) => node.path !== "acme.marketing.interns") });
	const at = alias(walk(top, choicesFor(top)).slots, "crm");
	expect(at.blocker?.message).toBe("acme.marketing holds no group with an entry for `crm`.");
	expect(at.blocker?.remedy).toBe("Ask an organization admin to grant a group holding `crm` to acme.marketing.");
});

it("narrowest_grant_wins", () => {
	// D51: `(depth, narrowed)` descending; the sub-team's grant beats the team's.
	const grants: Grant[] = [
		{ id: "g-team", scope: { teams: ["acme.marketing"] }, group: "marketing", by: "rae" },
		{ id: "g-interns", scope: { teams: ["acme.marketing.interns"] }, group: "marketing", by: "rae" },
	];
	const one = composed({ policy: policy({ grants }), assets: [asset("a1", "skill", "triage", { needs: [{ kind: "credential", alias: "crm" }] })] });
	const slot = alias(walk(one, choicesFor(one)).slots, "crm");
	expect(slot.resolvedFrom).toEqual({ source: "vault", vault: "aws-prod", group: "marketing", grant: "g-interns" });
	// Nothing rounds up: a candidate is still `declared` until the broker answers.
	expect(slot.state).toBe("unsatisfied");
	expect(slot.evidence).toBe("declared");
});

it("tie_refuses", () => {
	// A tie is an admin's ambiguity, not ours to guess.
	const groups = policy().groups;
	groups.second = { ...groups.marketing, name: "second" };
	const grants: Grant[] = [
		{ id: "g-one", scope: { teams: ["acme.marketing"] }, group: "marketing", by: "rae" },
		{ id: "g-two", scope: { teams: ["acme.marketing"] }, group: "second", by: "rae" },
	];
	const one = composed({ policy: policy({ grants, groups }), assets: [asset("a1", "skill", "triage", { needs: [{ kind: "credential", alias: "crm" }] })] });
	const slot = alias(walk(one, choicesFor(one)).slots, "crm");
	expect(slot.blocker?.code).toBe("preflight.ambiguous_group");
	expect(slot.blocker?.message).toBe("Two grants of equal scope hold `crm`: g-one, g-two.");
	expect(slot.blocker?.link).toBe("/console/org/groups");
});

it("narrowed_grant_only_offers_kept_aliases", () => {
	const grants: Grant[] = [
		{ id: "g-interns", scope: { teams: ["acme.marketing.interns"] }, group: "marketing", narrowedFrom: { grant: "g-mkt", aliases: ["crm"] }, by: "rae" },
	];
	const one = composed({
		policy: policy({ grants }),
		assets: [asset("a1", "skill", "triage", { needs: [{ kind: "credential", alias: "crm" }, { kind: "credential", alias: "model-key" }] })],
	});
	const slots = walk(one, choicesFor(one)).slots;
	expect(alias(slots, "crm").resolvedFrom).toMatchObject({ grant: "g-interns" });
	// `model-key` is held by the group but was not kept by the narrowing.
	expect(alias(slots, "model-key").blocker?.code).toBe("preflight.no_compatible_group");
});

it("walkNeeds_puts_the_model_credential_first_and_skips_it_in_gateway_mode", () => {
	const one = composed({ assets: [asset("a1", "skill", "triage", { needs: [{ kind: "credential", alias: "crm" }] })] });
	const slots = walk(one, choicesFor(one)).slots;
	expect(slots.map((slot) => (slot.need.kind === "credential" ? slot.need.alias : slot.need.kind))).toEqual(["model-key", "crm"]);
	const gateway = choicesFor(one);
	gateway.model = { ...gateway.model, provider: { ...gateway.model.provider, credential: undefined } };
	expect(walk(one, gateway).slots).toHaveLength(1);
});

it("asset_needs_are_verified_when_loaded_and_named_when_not", () => {
	const needer = asset("a1", "skill", "triage", { needs: [{ kind: "asset", id: "a2" }] });
	const needed = asset("a2", "tool", "deploy");
	const both = composed({ assets: [needer, needed], harnesses: [harness({ assets: ["a1"] })] });
	const satisfied = walk(both, choicesFor(both, harness({ assets: ["a1", "a2"] })), [needer, needed]).slots;
	expect(satisfied.find((slot) => slot.need.kind === "asset")).toMatchObject({ state: "satisfied", evidence: "verified" });

	const excluded = walk(both, choicesFor(both, harness({ assets: ["a1"] })), [needer]).slots.find((slot) => slot.need.kind === "asset") as Slot;
	expect(excluded.blocker?.code).toBe("preflight.asset_needed");
	expect(excluded.blocker?.message).toBe("triage needs deploy, which is not in this harness.");
	expect(excluded.blocker?.remedy).toBe("Add deploy to Support, or remove triage.");

	// P8: an id the chain does not hold names the chain instead of the harness.
	const nowhere = composed({ assets: [asset("a1", "skill", "triage", { needs: [{ kind: "asset", id: "ghost" }] })] });
	const slot = walk(nowhere, choicesFor(nowhere)).slots.find((one) => one.need.kind === "asset") as Slot;
	expect(slot.blocker?.remedy).toContain("acme › acme.marketing › acme.marketing.interns › acme.marketing.interns.dana");
});

it("missing_ids_become_slots_and_a_format_mismatch_becomes_a_blocker", () => {
	const one = composed({
		assets: [asset("a1", "skill", "summariser", { format: "openai-completions" })],
		harnesses: [harness({ assets: ["a1", "gone"] })],
	});
	const walked = walk(one, choicesFor(one, harness({ assets: ["a1", "gone"] })), one.assets, ["gone"]);
	const missing = walked.slots.find((slot) => slot.need.kind === "asset") as Slot;
	expect(missing.blocker?.code).toBe("preflight.asset_missing");
	expect(missing.blocker?.message).toBe("Support names an asset that nothing on your chain provides.");
	expect(missing.blocker?.remedy).toBe("Remove gone from Support, or ask an admin to share it with you.");
	expect(missing.blocker?.link).toBe("/console/org/harnesses/h1");
	// C19: a format mismatch is a Blocker, not a slot, and names both sides.
	expect(walked.blockers[0].code).toBe("preflight.asset_format");
	expect(walked.blockers[0].message).toBe("summariser needs the openai-completions format, and anthropic exposes anthropic-messages.");
	expect(walked.blockers[0].remedy).toBe("Drop it from this harness, or route through a provider exposing openai-completions.");
});

it("login_needs_are_unsatisfied_in_the_table_and_deferred_outside_it", () => {
	// §5.4 step 4: a tool the table knows is probed later; one it does not is an
	// OAuth in the provider's own store and is never counted as satisfied.
	const one = composed({
		assets: [asset("a1", "tool", "deploy", { needs: [{ kind: "login", tool: "gh" }, { kind: "login", tool: "figma" }] })],
	});
	const slots = walk(one, choicesFor(one)).slots.filter((slot) => slot.need.kind === "login");
	expect(slots.map((slot) => slot.state)).toEqual(["unsatisfied", "deferred"]);
	expect(slots.every((slot) => slot.evidence === "declared")).toBe(true);
});

it("narrowest_grant_wins_and_tie_is_ambiguous", () => {
	// D51 in one place, under 03 §8's name: the pair `narrowest_grant_wins` and
	// `tie_refuses` assert above; this is the row a reviewer searches for.
	const groups = policy().groups;
	groups.second = { ...groups.marketing, name: "second" };
	const narrow: Grant[] = [
		{ id: "g-team", scope: { teams: ["acme.marketing"] }, group: "marketing", by: "rae" },
		{ id: "g-interns", scope: { teams: ["acme.marketing.interns"] }, group: "marketing", by: "rae" },
	];
	const tied: Grant[] = [
		{ id: "g-one", scope: { teams: ["acme.marketing"] }, group: "marketing", by: "rae" },
		{ id: "g-two", scope: { teams: ["acme.marketing"] }, group: "second", by: "rae" },
	];
	const over = (grants: Grant[]) => composed({ policy: policy({ grants, groups }), assets: [asset("a1", "skill", "triage", { needs: [{ kind: "credential", alias: "crm" }] })] });
	expect(alias(walk(over(narrow), choicesFor(over(narrow))).slots, "crm").resolvedFrom).toMatchObject({ grant: "g-interns" });
	expect(alias(walk(over(tied), choicesFor(over(tied))).slots, "crm").blocker?.code).toBe("preflight.ambiguous_group");
});
