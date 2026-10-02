import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	commandBoundaryHit,
	commandRefusal,
	type HarnessPolicy,
	isOutsidePath,
	plainAction,
	withBrief,
} from "./core.js";

interface AuditEvent {
	action: "tool.call";
	payload: {
		tool: string;
		plain_sentence: string;
		duration_ms: number;
		ok: boolean;
		/** The session this call belongs to, so Logs can put the row under it.
		    `policy.json` is where the id comes from; absent in a session with no
		    harness, and the line is still a valid audit event without it. */
		session?: string;
		/** W6-D153: `boundary:<id>` when a command boundary refused the call, so
		    the row on Logs is the refusal and not a tool call that merely failed. */
		refused?: string;
	};
	occurred_at: string;
}

const DECLINED = "The user declined this action.";

/**
 * The extension holds no credential, reaches no network and enforces nothing
 * (07 §10, C29). A session with `--no-extensions` and no `-e` is exactly as
 * safe; this one is only quieter. What it does is say what is happening in
 * plain sentences, ask before a deploy or a change outside the work tree, and
 * append to the spool the supervisor tails.
 */
const sessionDir = () => process.env.HARNESS_SESSION_DIR;
const agentDir = () => process.env.PI_CODING_AGENT_DIR;

export default function harnessExtension(pi: ExtensionAPI) {
	let policy: HarnessPolicy = {};
	/** W5-D11: the harness's brief, read once beside `policy.json`. */
	let brief = "";
	let showWork = false;
	let started = false;
	let timer: NodeJS.Timeout | undefined;
	let flushing = false;
	const audit: AuditEvent[] = [];
	const calls = new Map<string, { startedAt: number; sentence: string; tool: string }>();

	const record = (tool: string, sentence: string, ms: number, ok: boolean, refused?: string) =>
		audit.push({
			action: "tool.call",
			payload: {
				tool,
				plain_sentence: sentence,
				duration_ms: ms,
				ok,
				...(policy.session_id ? { session: policy.session_id } : {}),
				...(refused ? { refused } : {}),
			},
			occurred_at: new Date().toISOString(),
		});

	/**
	 * 08 §11.1: the harness landing as Pi's header, drawn by the CLI's own
	 * renderer at whatever width Pi gives it. A landing that cannot be drawn
	 * is a notice, never the reason a session fails.
	 */
	async function showLanding(ctx: ExtensionContext) {
		const landing = policy.landing;
		if (!landing || ctx.mode !== "tui") return;
		try {
			const renderer = (await import(pathToFileURL(landing.module).href)) as {
				landingLines: (frame: unknown, width: number, mode: string) => string[];
			};
			ctx.ui.setHeader(() => ({
				invalidate: () => {},
				render: (width: number) => renderer.landingLines(landing.frame, width, landing.mode),
			}));
		} catch (error) {
			ctx.ui.notify(`Harness could not draw its landing: ${String(error)}`, "warning");
		}
	}

	async function loadPolicy(ctx: ExtensionContext) {
		const path = join(agentDir() ?? ctx.cwd, "policy.json");
		try {
			policy = JSON.parse(await readFile(path, "utf8")) as HarnessPolicy;
		} catch (error) {
			ctx.ui.notify(`Harness could not read policy.json: ${String(error)}`, "error");
			policy = {};
		}
		// W5-D11. A brief that is not there is a harness with no `system_prompt`
		// asset, which is ordinary — never a notice, and never a failure.
		brief = await readFile(
			policy.system_prompt_file ?? join(agentDir() ?? ctx.cwd, "system-prompt.md"),
			"utf8",
		).catch(() => "");
	}

	/**
	 * A notice, not a block (D94). The read geometry already refused — the
	 * files are not there and the binary will not exec — so blocking here
	 * would add nothing except the impression that this extension is the
	 * control. Naming the boundary is the part that helps.
	 */
	function noticeBoundary(ctx: ExtensionContext) {
		const allowed = policy.allowed;
		if (!allowed) return;
		const outside = pi.getActiveTools().filter((tool) => !allowed.includes(tool));
		if (outside.length === 0) return;
		const why = (policy.denies ?? []).join(", ");
		ctx.ui.notify(
			`Your harness does not cover ${outside.join(", ")}${why ? `; the boundary is ${why}` : ""}.`,
			"warning",
		);
	}

	async function flush() {
		const dir = sessionDir();
		if (flushing || !dir) return;
		flushing = true;
		try {
			const batch = audit.slice(0, 100);
			if (batch.length === 0) return;
			await appendFile(join(dir, "audit.jsonl"), `${batch.map((event) => JSON.stringify(event)).join("\n")}\n`);
			audit.splice(0, batch.length);
		} catch {
			// The spool is telemetry; the proxy log is authoritative (C29).
			// Keep the queued events for the next flush.
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
		noticeBoundary(ctx);
		await showLanding(ctx);
		if (!started) {
			started = true;
			timer = setInterval(() => void flush(), 15_000);
			timer.unref();
		}
	});

	// W5-D11 (07 D137). The runtime's prompt first, the harness's brief after
	// it: the harness narrows what the runtime already is, and a narrowing that
	// came first would be overridden by the thing it narrows.
	pi.on("before_agent_start", (event) => {
		const systemPrompt = withBrief(event.systemPrompt, brief);
		return systemPrompt === undefined ? undefined : { systemPrompt };
	});

	pi.on("tool_call", async (event, ctx) => {
		const sentence = plainAction(event.toolName, event.input, showWork);
		ctx.ui.notify(sentence, "info");
		const startedAt = Date.now();
		calls.set(event.toolCallId, { startedAt, sentence, tool: event.toolName });

		// W6-D153, before either gate: a command boundary is not a question. It
		// is the organisation's refusal, so nobody is asked and the reason it
		// carries is what the model and the person both read. `hasUI` does not
		// come into it — a boundary that only held when somebody was watching
		// would not be a boundary.
		if (event.toolName === "bash") {
			const boundary = commandBoundaryHit(policy.commands, (event.input as { command?: unknown }).command);
			if (boundary) {
				const refusal = commandRefusal(boundary);
				ctx.ui.notify(refusal, "error");
				calls.delete(event.toolCallId);
				record(event.toolName, sentence, Date.now() - startedAt, false, `boundary:${boundary.id}`);
				return { block: true, reason: refusal };
			}
		}

		const deployGate = (policy.confirm ?? []).includes(event.toolName);
		const pathGate =
			(event.toolName === "write" || event.toolName === "edit") &&
			isOutsidePath(event.input.path, ctx.cwd, policy.assetsRoot ? [policy.assetsRoot] : []);
		if (!deployGate && !pathGate) return undefined;

		// No UI means nobody can be asked, so nobody consented.
		const confirmed =
			ctx.hasUI &&
			(await ctx.ui.confirm(
				deployGate ? "Confirm deployment" : "Confirm outside-path change",
				deployGate ? sentence : `${sentence}\nThis path is outside ${ctx.cwd}.`,
			));
		if (confirmed) return undefined;
		calls.delete(event.toolCallId);
		record(event.toolName, sentence, Date.now() - startedAt, false);
		return { block: true, reason: DECLINED };
	});

	pi.on("tool_result", (event) => {
		const call = calls.get(event.toolCallId);
		calls.delete(event.toolCallId);
		if (call) record(call.tool, call.sentence, Date.now() - call.startedAt, !event.isError);
		// Nothing is rewritten on the way back: there is no value in the jail
		// to redact (00 §6), so there is no redaction here.
		return undefined;
	});

	pi.on("session_shutdown", async () => {
		if (timer) clearInterval(timer);
		await flush();
	});
}

export * from "./core.js";
