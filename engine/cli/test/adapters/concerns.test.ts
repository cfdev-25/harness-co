import { describe, expect, it } from "vitest";
import { claudeAdapter } from "../../src/adapters/claude/index.js";
import { CONCERNS } from "../../src/adapters/layout.js";
import { pi } from "../../src/adapters/pi/index.js";

describe("capabilities", () => {
	/**
	 * `require:<concern>` (D13) makes a concern mandatory, and 03 §5.8 step 0
	 * raises `adapter.unsupported_concern` when the chosen adapter declares it
	 * `none`. That raise is preflight's — it needs the covering scope — so what
	 * this asserts is the half the adapter owns: a complete matrix, the values
	 * 07 §6 tabulates, and the fact that neither shipped adapter answers `none`
	 * to anything, so today's blocker can only come from a third provider.
	 */
	it("unsupported_required_concern_blocks", () => {
		for (const adapter of [pi, claudeAdapter]) {
			expect(Object.keys(adapter.capabilities).sort()).toEqual([...CONCERNS].sort());
			for (const concern of CONCERNS) {
				expect(["native", "emulated", "none"]).toContain(adapter.capabilities[concern]);
				expect(adapter.capabilities[concern]).not.toBe("none");
			}
		}
		const stub = { ...pi, displayName: "Stub", capabilities: { ...pi.capabilities, audit: "none" } as const };
		expect(stub.capabilities.audit).toBe("none");
	});

	it("declares 07 §6's matrix, so no provider difference is silent", () => {
		expect(pi.capabilities.skill).toBe("native");
		expect(claudeAdapter.capabilities.skill).toBe("emulated");
		expect(pi.capabilities.prompt).toBe("native");
		expect(claudeAdapter.capabilities.prompt).toBe("emulated");
		// D137 (superseding D91): the system prompt is native on both — Claude
		// takes `--append-system-prompt-file`, Pi's extension returns it on
		// `before_agent_start`. One ordering function still writes the file.
		expect(pi.capabilities.system_prompt).toBe("native");
		expect(claudeAdapter.capabilities.system_prompt).toBe("native");
		expect(pi.speaks).toEqual(["openai-completions", "anthropic-messages"]);
		expect(claudeAdapter.speaks).toEqual(["anthropic-messages"]);
	});
});
