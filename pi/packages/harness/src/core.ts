import { isAbsolute, relative, resolve } from "node:path";

/** `<agentDir>/policy.json`, written by the Pi adapter (07 §7). It is what
    the extension needs to *speak*: nothing here is enforced by it. */
export interface HarnessPolicy {
	session_id?: string;
	/** Pi tool names the boundary leaves in place. */
	allowed?: string[];
	/** Pi tool names a deploy confirmation must cover. */
	confirm?: string[];
	/** The boundary, in the advisory vocabulary, so a notice can name it. */
	denies?: string[];
	/** W6-D153. Boundaries of kind `command` that cover this session. Unlike
	    `denies` these are **not** advisory: a `bash` call whose command line
	    one of them holds against is refused here, with the boundary's reason,
	    because `intercepted` means the runtime is the one that says no. */
	commands?: CommandBoundary[];
	/** The harness work tree (07 §6a): a write there is the person's, not an outside-path change. */
	assetsRoot?: string;
	/** 08 §11.1: the landing Pi draws as its header. `module` is the CLI's own
	    `landing.js`, imported by path at session start — one renderer for the
	    CLI's frames and this header; `frame` is its data and `mode` the colours
	    the terminal takes. */
	landing?: { module: string; mode: "truecolor" | "256" | "mono"; frame: Record<string, unknown> };
	/** W5-D11: the harness's brief, as a file. The extension appends it to the
	    runtime's own system prompt on `before_agent_start`. */
	system_prompt_file?: string;
}

/**
 * One command boundary, as the Pi adapter writes it (07 §7, W6-D153).
 *
 * `match` is the rule, already compiled by `@harness/compose`'s
 * `commandRuleSource` from `pattern`. This package is in the vendored Pi tree
 * and cannot import that one, so it is handed the rule rather than holding a
 * second copy of it: a matcher written twice is a boundary that means two
 * things, and the whole point of a command boundary is that it means the same
 * one in both runtimes.
 */
export interface CommandBoundary {
	id: string;
	/** What a person reads on the console row: `rm -rf /*`. */
	pattern: string;
	/** Why, in the words whoever set it wrote. Printed at the refusal. */
	reason: string;
	/** The compiled rule, as a `RegExp` source over the whole command line. */
	match: string;
}

/**
 * The first command boundary this command line trips, or `null`.
 *
 * Pure, and the only rule-reading in this package: a damaged `match` is a
 * boundary that cannot be applied, and a boundary that cannot be applied must
 * not take the session down with it — it is skipped, like a header that will
 * not draw. Order is the plan's, so the node that set it first is the one
 * named.
 */
export function commandBoundaryHit(
	commands: CommandBoundary[] | undefined,
	commandLine: unknown,
): CommandBoundary | null {
	if (typeof commandLine !== "string" || commandLine.trim() === "") return null;
	const line = commandLine.trim();
	for (const boundary of commands ?? []) {
		try {
			if (new RegExp(boundary.match).test(line)) return boundary;
		} catch {
			// An unusable rule is not a refusal and not a crash.
		}
	}
	return null;
}

/** What the person sees when a boundary refuses the call, and what the model
    is handed back as the tool's error: the pattern, and why it is there. */
export function commandRefusal(boundary: CommandBoundary): string {
	return `Your harness does not allow this command: ${boundary.pattern}. ${boundary.reason}`;
}

/**
 * W5-D11 (07 D137). Pi's `before_agent_start` hands the assembled system
 * prompt and takes a replacement, which is the runtime's own seam for this —
 * so the harness's brief is appended there rather than written into `AGENTS.md`
 * as a heading the model has to be told to treat as instructions. An empty or
 * missing brief changes nothing: `undefined` leaves the runtime's prompt alone.
 */
export function withBrief(runtimePrompt: string, brief: string): string | undefined {
	const trimmed = brief.trim();
	if (trimmed === "") return undefined;
	return runtimePrompt.trim() === "" ? trimmed : `${runtimePrompt.replace(/\s+$/, "")}\n\n${trimmed}`;
}

export function plainAction(tool: string, input: Record<string, unknown>, detailed = false): string {
	let sentence: string;
	if (tool === "read") sentence = `I'll read ${String(input.path ?? "a file")}.`;
	else if (tool === "bash") {
		const words = String(input.command ?? "")
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 8)
			.join(" ");
		sentence = `I'll run a command to ${words || "complete this task"}.`;
	} else sentence = `I'll use ${tool}.`;
	return detailed ? `${sentence} ${JSON.stringify(input)}` : sentence;
}

export function isOutsidePath(path: unknown, cwd: string, inside: string[] = []): boolean {
	if (typeof path !== "string" || path.length === 0) return false;
	const target = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
	// The project and the harness work tree (07 §6a) are both the person's;
	// anything else is outside and asked about.
	return [cwd, ...inside].every((root) => {
		const rel = relative(resolve(root), target);
		return rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel);
	});
}

