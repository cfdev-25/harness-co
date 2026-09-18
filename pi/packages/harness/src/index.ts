import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type HarnessPolicy, isOutsidePath, parseRedactions, plainAction, redactText, redactValue } from "./core.js";

interface AuditEvent {
	action: "tool.call";
	payload: { tool: string; plain_sentence: string; duration_ms: number; ok: boolean };
	occurred_at: string;
}

const DECLINED = "The user declined this action.";
const NOT_ALLOWED = "This tool is not allowed by your Harness policy.";

// The extension holds no credential and reaches no network. Audit events are
// appended to a spool the supervisor tails and forwards; the supervisor owns
// the heartbeat, because it is the parent process and knows we are alive.
const sessionDir = () => process.env.HARNESS_SESSION_DIR;

export default function harnessExtension(pi: ExtensionAPI) {
	let policy: HarnessPolicy = {};
	let showWork = false;
	let started = false;
	let timer: NodeJS.Timeout | undefined;
	let flushing = false;
	const audit: AuditEvent[] = [];
	const calls = new Map<string, { startedAt: number; sentence: string; tool: string }>();
	const redactions = parseRedactions(process.env.HARNESS_REDACTIONS);

	async function loadPolicy(ctx: ExtensionContext) {
		const path = join(sessionDir() ?? ctx.cwd, "policy.json");
		try {
			policy = JSON.parse(await readFile(path, "utf8")) as HarnessPolicy;
		} catch (error) {
			ctx.ui.notify(`Harness could not read policy.json: ${String(error)}`, "error");
			policy = { allowed_tools: [] };
		}
	}

	function applyAllowlist(ctx: ExtensionContext) {
		const allowed = new Set(policy.allowed_tools ?? []);
		const active = pi.getActiveTools();
		const rejected = active.filter((tool) => !allowed.has(tool));
		if (rejected.length === 0) return;
		pi.setActiveTools(active.filter((tool) => allowed.has(tool)));
		const message = `Harness disabled tools outside policy: ${rejected.join(", ")}`;
		ctx.ui.notify(message, "warning");
		// This is a defense-in-depth control, not a security boundary: another extension
		// can reactivate tools. The tool_call handler below therefore also fails closed.
	}

	async function flush() {
		const dir = sessionDir();
		if (flushing || !dir) return;
		flushing = true;
		try {
			const batch = audit.slice(0, 100);
			if (batch.length === 0) return;
			const lines = batch.map((event) => JSON.stringify(event));
			await appendFile(join(dir, "audit.jsonl"), `${lines.join("\n")}\n`);
			audit.splice(0, batch.length);
		} catch {
			// Attested telemetry is best effort. Keep queued events for the next flush.
		} finally {
			flushing = false;
		}
	}

	pi.registerCommand("show-work", {
		description: "Toggle full technical action details",
		handler: async (_args, ctx) => {
			showWork = !showWork;
			ctx.ui.notify(`Technical action details are ${showWork ? "on" : "off"}.`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await loadPolicy(ctx);
		applyAllowlist(ctx);
		if (!started) {
			started = true;
			timer = setInterval(() => void flush(), 15_000);
			timer.unref();
		}
	});

	pi.on("before_agent_start", (_event, ctx) => applyAllowlist(ctx));

	pi.on("tool_call", async (event, ctx) => {
		const sentence = plainAction(event.toolName, event.input, showWork);
		ctx.ui.notify(sentence, "info");
		const startedAt = Date.now();
		calls.set(event.toolCallId, { startedAt, sentence, tool: event.toolName });

		if (!(policy.allowed_tools ?? []).includes(event.toolName)) {
			audit.push({
				action: "tool.call",
				payload: { tool: event.toolName, plain_sentence: sentence, duration_ms: 0, ok: false },
				occurred_at: new Date().toISOString(),
			});
			return { block: true, reason: NOT_ALLOWED };
		}

		const deployGate =
			policy.approvals?.deploy === "required" && (policy.deploy_tools ?? []).includes(event.toolName);
		const pathGate =
			(event.toolName === "write" || event.toolName === "edit") && isOutsidePath(event.input.path, ctx.cwd);
		if (!deployGate && !pathGate) return undefined;

		const confirmed =
			ctx.hasUI &&
			(await ctx.ui.confirm(
				deployGate ? "Confirm deployment" : "Confirm outside-path change",
				deployGate ? sentence : `${sentence}\nThis path is outside ${ctx.cwd}.`,
			));
		if (!confirmed) {
			calls.delete(event.toolCallId);
			audit.push({
				action: "tool.call",
				payload: { tool: event.toolName, plain_sentence: sentence, duration_ms: Date.now() - startedAt, ok: false },
				occurred_at: new Date().toISOString(),
			});
			return { block: true, reason: DECLINED };
		}
		return undefined;
	});

	pi.on("tool_result", (event) => {
		const call = calls.get(event.toolCallId);
		calls.delete(event.toolCallId);
		if (call) {
			audit.push({
				action: "tool.call",
				payload: {
					tool: call.tool,
					plain_sentence: call.sentence,
					duration_ms: Date.now() - call.startedAt,
					ok: !event.isError,
				},
				occurred_at: new Date().toISOString(),
			});
		}
		return {
			content: event.content.map((item) =>
				item.type === "text" ? { ...item, text: redactText(item.text, redactions) } : item,
			),
			details: redactValue(event.details, redactions),
		};
	});

	pi.on("session_shutdown", async () => {
		if (timer) clearInterval(timer);
		await flush();
	});
}

export * from "./core.js";
