import type { Chain } from "@harness/compose/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { keysAdd } from "../src/commands/keys.js";
import { providers } from "../src/commands/providers.js";
import { COMMAND_SHEET } from "../src/commands/sheet.js";
import { setup } from "../src/commands/setup.js";
import { fakeShell } from "./os/support.js";
import { composed, harness, policy } from "./preflight/support.js";

const credentials = { api_url: "http://api", token: "tok" };
const printed = (): string[] => vi.mocked(console.log).mock.calls.map((call) => String(call[0]));

beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => undefined);
	vi.mocked(console.log).mockClear();
});

/** One `CommitResult`, and what the CLI sent to earn it. */
function stubApi(body: Record<string, unknown> = { commit: "abc1234def", ref: "refs/heads/org" }): Array<{ url: string; method?: string; body: unknown }> {
	const calls: Array<{ url: string; method?: string; body: unknown }> = [];
	vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
		calls.push({ url, method: init.method, body: JSON.parse(init.body as string) });
		return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
	});
	return calls;
}

describe("providers (§11.20, D117)", () => {
	it("providers_decline_requires_reason", async () => {
		await expect(providers(credentials, composed(), "decline", "claude", undefined, undefined)).rejects.toMatchObject({ code: "cli.reason_required" });
		// Bare, it is the composed catalogue and no I/O at all.
		expect(await providers(credentials, composed(), undefined, undefined, undefined, undefined)).toBe(0);
		expect(printed()[0]).toBe("claude  approved  every team  claude ≥ 2.1.275");
	});

	it("providers_approve_puts_row", async () => {
		const calls = stubApi();
		expect(await providers(credentials, composed(), "approve", "claude", undefined, "acme.marketing,acme.sales")).toBe(0);
		expect(calls).toEqual([
			{
				url: "http://api/v1/providers/harness/claude",
				method: "PUT",
				// `pin` and `speaks` are the row's own: the verb moves the approval.
				body: { approval: "approved", scope: { teams: ["acme.marketing", "acme.sales"] }, pin: { binary: "claude", minVersion: "2.1.275" }, speaks: ["anthropic-messages"] },
			},
		]);
		expect(printed()).toContain("claude approved for acme.marketing, acme.sales · commit abc1234");
		await expect(providers(credentials, composed(), "approve", "cursor", undefined, undefined)).rejects.toMatchObject({ code: "cli.provider_unknown" });
		vi.unstubAllGlobals();
	});
});

describe("keys add (§11.21, D117)", () => {
	it("keys_add_refuses_unknown_provider", async () => {
		const asked = vi.fn(async () => "sk-never-asked-for");
		await expect(keysAdd(credentials, composed(), "openai", undefined, asked)).rejects.toMatchObject({ code: "cli.provider_unknown" });
		expect(asked).not.toHaveBeenCalled();
	});

	it("keys_add_never_prints_the_key", async () => {
		const KEY = "sk-live-DO-NOT-LEAK";
		const calls = stubApi({ commit: "abc1234def", ref: "refs/heads/org", default: true });
		const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(await keysAdd(credentials, composed(), "openrouter", "auto", async () => KEY)).toBe(0);
		expect(calls[0]).toEqual({ url: "http://api/v1/providers/model/openrouter/setup", method: "POST", body: { key: KEY, model: "auto" } });
		expect(printed()).toEqual(["openrouter · key stored in the bundled vault · default for the organisation · commit abc1234"]);
		// The one place the key may appear is the request body.
		for (const line of [...printed(), ...errors.mock.calls.map((call) => String(call[0])), calls[0].url]) expect(line).not.toContain(KEY);
		errors.mockRestore();
		vi.unstubAllGlobals();
	});
});

describe("setup (§11.22, D117)", () => {
	it("setup_prints_five_lines_and_exit_code", async () => {
		// The support fixture is an organisation with every step taken. The
		// sixth line is W5-D13's registration, which is not a checklist step.
		expect(await setup(composed({ harnesses: [harness()] }), fakeShell())).toBe(0);
		expect(printed()).toHaveLength(6);
		expect(printed().every((line) => line.startsWith("✓"))).toBe(true);
		expect(printed()[5]).toContain("`harness://` links open this machine's harness");

		vi.mocked(console.log).mockClear();
		const bare = policy({ grants: [], groups: {}, harnessProviders: {}, routing: { defaultFor: { teams: {}, harnesses: {}, providers: {} }, approvedFor: { teams: {}, harnesses: {}, providers: {} } } });
		expect(await setup(composed({ policy: bare }), fakeShell())).toBe(1);
		expect(printed()).toHaveLength(6);
		expect(printed()[0]).toBe("✗ No runtime is approved.  → harness providers approve pi  /console/org/providers");
		expect(printed()[1]).toContain("→ harness keys add anthropic  /console/org/providers/model");
		// Groups are console-only until someone asks for them (D117).
		expect(printed()[3]).toBe("✗ No security group reaches acme.marketing.interns.  /console/org/groups");
		expect(printed()[4]).toBe('✓ You hold Support.');

		// A personal account has no team to grant to, so that line is not a step.
		vi.mocked(console.log).mockClear();
		const personal: Chain = [
			{ kind: "org", path: "acme", ref: "refs/heads/org", commit: "c0" },
			{ kind: "user", path: "acme.dana", ref: "refs/heads/users/dana", commit: "c1" },
		];
		await setup(composed({ chain: personal, policy: bare }), fakeShell());
		expect(printed()).toHaveLength(5);
	});
});

it("sheet_has_five_groups", () => {
	// §11.17: the fifth group is §11.20–11.22 and `new --team`.
	expect(COMMAND_SHEET).toHaveLength(5);
	expect(COMMAND_SHEET.map((group) => group.group)).toEqual(["Pick something up", "See what is going on", "Change something", "Set up", "Sign in"]);
	expect(COMMAND_SHEET[3].rows.map((row) => row.run)).toEqual([
		"harness setup",
		"harness setup --unregister",
		"harness providers",
		"harness providers approve pi",
		'harness providers decline claude --reason "…"',
		"harness keys add openrouter",
		'harness new "Weekly newsletter" --team marketing',
	]);
});
