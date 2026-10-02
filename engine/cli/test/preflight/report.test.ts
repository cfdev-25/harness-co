import type { PreflightReport, Slot } from "@harness/compose/contracts";
import { expect, it } from "vitest";
import { renderReport } from "../../src/preflight/report.js";
import { choicesFor, composed, harness } from "./support.js";

const one = composed({ harnesses: [harness()] });

function report(over: Partial<PreflightReport> = {}): PreflightReport {
	return {
		sessionId: "s1",
		composed: { commit: { "refs/heads/org": "c0" }, tree: "t", conflicts: [] },
		choices: choicesFor(one, harness()),
		plan: { hosts: ["api.anthropic.com"], deny: [], reach: { mode: "allow", hosts: ["pypi.org", "crates.io"], setBy: "acme.marketing" }, connectors: {}, filesystem: { allowWrite: [], denyRead: [], denyWrite: [] }, env: {}, argv: [] },
		slots: [],
		drift: [],
		passing: true,
		blockers: [],
		at: "2026-09-25T00:00:00.000Z",
		...over,
	};
}

const vault = (alias: string): Slot => ({
	need: { kind: "credential", alias },
	state: "satisfied",
	evidence: "verified",
	resolvedFrom: { source: "vault", vault: "aws-prod", group: "Marketing", grant: "g-mkt" },
});
const local = (alias: string): Slot => ({ need: { kind: "credential", alias }, state: "satisfied", evidence: "verified", resolvedFrom: { source: "local", tool: "gh" } });


it("preflight_renders_the_sections_in_plain_words", () => {
	const rendered = renderReport(report({ slots: [vault("model-key"), local("gh")], drift: [{ file: "rendered.json", expected: { skills: [] }, actual: { skills: ["x"] } }] }));
	for (const section of ["identity", "harness", "provider", "model", "credentials", "reach", "drift", "blockers"]) expect(rendered).toContain(section);
	expect(rendered).toContain("Support");
	expect(rendered).toContain("anthropic/claude-sonnet-5");
	// D30a: `resolved from` is the place, never the rule.
	expect(rendered).toContain("your local gh login");
	expect(rendered).toContain("Marketing · aws-prod");
	// C4: an enforcement claim is labelled, never assumed.
	expect(rendered).toContain("enforced");
});

