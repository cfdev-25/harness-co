import type { EffectiveReach, SpawnPlan } from "@harness/compose/contracts";
import { describe, expect, it } from "vitest";
import { shapeModelRequest } from "../../src/proxy/inject.js";
import { routable } from "../../src/proxy/tunnel.js";

/**
 * 05 §6a — D133 and D134 as pure functions. The conformance suite in
 * `proxy.test.ts` proves they are wired into a real listener; these prove the
 * rules themselves, which is where the table in the document lives.
 */

const plan = (reach: EffectiveReach, hosts: string[] = ["api.anthropic.com"]): Pick<SpawnPlan, "hosts" | "reach"> => ({ hosts, reach });
const at = (mode: EffectiveReach["mode"], hosts: string[] = []): EffectiveReach => ({ mode, hosts, setBy: "acme.marketing" });

describe("routable (D133)", () => {
	it("a credentialed host is always routable on 443, whatever reach says", () => {
		expect(routable(plan(at("off")), "api.anthropic.com", 443)).toEqual({ ok: true });
		// …and not on any other port: one rule, and the port comes first.
		expect(routable(plan(at("on")), "api.anthropic.com", 8443)).toEqual({ ok: false, reason: "port" });
	});

	it("an allow-list reaches what it names and refuses the rest by name", () => {
		const allowing = plan(at("allow", ["pypi.org"]));
		expect(routable(allowing, "pypi.org", 443)).toEqual({ ok: true });
		expect(routable(allowing, "files.pythonhosted.org", 443)).toEqual({ ok: false, reason: "reach.not-listed" });
	});

	it("a deny-list refuses what it names and reaches the rest", () => {
		const denying = plan(at("on", ["*.example.com"]));
		expect(routable(denying, "a.example.com", 443)).toEqual({ ok: false, reason: "reach.denied" });
		expect(routable(denying, "pypi.org", 443)).toEqual({ ok: true });
	});

	it("off refuses everything that is not credentialed", () => {
		expect(routable(plan(at("off")), "pypi.org", 443)).toEqual({ ok: false, reason: "reach.off" });
	});
});

describe("shapeModelRequest (D134)", () => {
	const shaped = (wire: "anthropic-messages" | "openai-completions", body: unknown, reach: EffectiveReach) => {
		const out = shapeModelRequest(wire, Buffer.from(JSON.stringify(body)), reach);
		return { stripped: out.stripped, body: JSON.parse(out.bytes.toString("utf8")) as Record<string, unknown> };
	};

	it("anthropic-messages loses every provider-side capability under allow", () => {
		const out = shaped("anthropic-messages", {
			model: "claude-opus-5",
			tools: [{ type: "web_search_20250305" }, { type: "web_fetch_20250910" }, { type: "code_execution_20250522" }, { name: "calc" }],
			mcp_servers: [{ url: "https://mcp.example" }],
			container: { id: "c1" },
		}, at("allow", ["pypi.org"]));
		expect(out.stripped).toEqual(["web_search_20250305", "web_fetch_20250910", "code_execution_20250522", "mcp_servers", "container"]);
		expect(out.body.tools).toEqual([{ name: "calc" }]);
		expect(out.body).not.toHaveProperty("mcp_servers");
		expect(out.body).not.toHaveProperty("container");
	});

	it("the openai shape loses its own four, plus the search options", () => {
		const out = shaped("openai-completions", {
			model: "gpt",
			tools: [{ type: "web_search" }, { type: "web_search_preview" }, { type: "mcp" }, { type: "code_interpreter" }, { type: "function", function: { name: "calc" } }],
			web_search_options: { search_context_size: "high" },
		}, at("allow"));
		expect(out.stripped).toEqual(["web_search", "web_search_preview", "mcp", "code_interpreter", "web_search_options"]);
		expect(out.body.tools).toHaveLength(1);
	});

	it("openrouter's two extra routes to the same thing", () => {
		const out = shaped("openai-completions", {
			model: "anthropic/claude-sonnet-5:online",
			plugins: [{ id: "web", max_results: 3 }, { id: "file-parser" }],
		}, at("allow"));
		expect(out.stripped).toEqual([":online", "plugins:web"]);
		expect(out.body.model).toBe("anthropic/claude-sonnet-5");
		expect(out.body.plugins).toEqual([{ id: "file-parser" }]);
	});

	it("`on` is the only mode that permits provider-side browsing", () => {
		const body = { tools: [{ type: "web_search_20250305" }], mcp_servers: [{ url: "https://mcp.example" }] };
		const out = shaped("anthropic-messages", body, at("on"));
		expect(out.stripped).toEqual([]);
		expect(out.body).toEqual(body);
	});

	it("a body that is not JSON, or holds none of it, is passed as it came", () => {
		const raw = Buffer.from("not json at all");
		expect(shapeModelRequest("anthropic-messages", raw, at("off"))).toEqual({ bytes: raw, stripped: [] });
		const plain = Buffer.from(JSON.stringify({ model: "m", messages: [] }));
		expect(shapeModelRequest("anthropic-messages", plain, at("off"))).toEqual({ bytes: plain, stripped: [] });
	});
});
