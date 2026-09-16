import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ALLOWED_TOOLS = new Set(["read", "grep", "find", "ls"]);
const BLOCKED_TOOL = "bash";

export default function gatingSpike(pi: ExtensionAPI) {
	const enforceAllowlist = () => {
		const available = pi.getAllTools().map((tool) => tool.name);
		const allowed = available.filter((name) => ALLOWED_TOOLS.has(name));
		pi.setActiveTools(allowed);
		return { available, active: pi.getActiveTools() };
	};

	pi.on("session_start", () => {
		enforceAllowlist();
	});

	// Re-apply immediately before each agent run in case another extension registered
	// or activated a tool after session_start.
	pi.on("before_agent_start", () => {
		enforceAllowlist();
	});

	pi.on("tool_call", (event) => {
		console.log(
			JSON.stringify({
				type: event.type,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: event.input,
			}),
		);

		// A named hard block remains as a backstop if another extension reactivates it.
		if (event.toolName === BLOCKED_TOOL) {
			return { block: true, reason: `${BLOCKED_TOOL} is blocked by the gating spike` };
		}

		// This catches calls to late-registered or unexpectedly reactivated tools.
		if (!ALLOWED_TOOLS.has(event.toolName)) {
			return { block: true, reason: `Tool "${event.toolName}" is not in the allowlist` };
		}

		return undefined;
	});

	pi.registerCommand("gating-status", {
		description: "Show and re-apply the spike tool allowlist",
		handler: async (_args, ctx) => {
			const { available, active } = enforceAllowlist();
			const message = [
				`Allowlist: ${[...ALLOWED_TOOLS].join(", ")}`,
				`Available: ${available.join(", ") || "(none)"}`,
				`Active: ${active.join(", ") || "(none)"}`,
				`Hard-blocked: ${BLOCKED_TOOL}`,
			].join("\n");

			if (ctx.hasUI) {
				ctx.ui.notify(message, "info");
			} else {
				console.log(message);
			}
		},
	});
}
