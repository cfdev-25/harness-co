import type { Blocker } from "@harness/compose/contracts";

/**
 * Windows (06 §9a). Windows has native confinement primitives and nobody has
 * built this jail on them yet, so the honest answer is the only answer: the
 * session does not start. The three paths out — the Linux jail inside WSL2
 * (W1), a native AppContainer `confine()` (W2), and an organization's explicit
 * unfenced approval (W3) — are the plan, not a fallback this function takes.
 */
export function refuseUnsupportedPlatform(): never {
	throw {
		code: "sandbox.unsupported_platform",
		message:
			"The harness confines the agent with a sandbox, and there is no native sandbox for Windows yet. It will not start a session it cannot confine.",
		remedy:
			"Run it inside WSL2 (`harness setup windows` installs what is needed, §9a W1), or on macOS or Linux. If your organization has approved unfenced Windows sessions, `harness preflight` will say so instead of this.",
	} satisfies Blocker;
}
