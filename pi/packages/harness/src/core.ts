import { isAbsolute, relative, resolve } from "node:path";

export interface HarnessPolicy {
	allowed_tools?: string[];
	deploy_tools?: string[];
	approvals?: { deploy?: string };
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

export function isOutsidePath(path: unknown, cwd: string): boolean {
	if (typeof path !== "string" || path.length === 0) return false;
	const target = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
	const rel = relative(resolve(cwd), target);
	return rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel);
}

export function parseRedactions(raw: string | undefined): Array<[string, string]> {
	if (!raw) return [];
	try {
		const value: unknown = JSON.parse(raw);
		if (!value || Array.isArray(value) || typeof value !== "object") return [];
		return Object.entries(value as Record<string, unknown>)
			.filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
			.sort((a, b) => b[1].length - a[1].length);
	} catch {
		return [];
	}
}

export function redactText(text: string, redactions: Array<[string, string]>): string {
	let result = text;
	for (const [ref, secret] of redactions) result = result.split(secret).join(`[secret:${ref}]`);
	return result;
}

export function redactValue(value: unknown, redactions: Array<[string, string]>): unknown {
	if (typeof value === "string") return redactText(value, redactions);
	if (Array.isArray(value)) return value.map((item) => redactValue(item, redactions));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, redactions)]));
	}
	return value;
}

/** What `harness run` leaves in the session directory for us to show. */
export interface HarnessCard {
	name: string;
	description: string;
	org_unit_path: string;
	/** The drawing, already rendered by the CLI for this terminal. */
	lines: string[];
}

const ANSI = /\u001b\[[0-9;]*m/g;
const visibleWidth = (text: string) => text.replace(ANSI, "").length;

function wrap(text: string, width: number): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (line && line.length + 1 + word.length > width) {
			lines.push(line);
			line = "";
		}
		line = line ? `${line} ${word}` : word;
	}
	return line ? [...lines, line] : lines;
}

/**
 * The harness header: the drawing on the left, what it is on the right.
 *
 * Always exactly as tall as the drawing, so the header never grows with a
 * long description — that is cut off instead, because the description is a
 * reminder of where you are, not a document.
 */
export function headerLines(icon: string[], name: string, unit: string, description: string, width: number): string[] {
	const drawing = icon.length ? icon : [""];
	const textWidth = Math.max(12, width - visibleWidth(drawing[0]) - 6);
	const text = [name, unit, "", ...wrap(description, textWidth)];
	if (text.length > drawing.length) {
		text.length = drawing.length;
		const last = text[drawing.length - 1] ?? "";
		text[drawing.length - 1] = `${last.slice(0, Math.max(0, textWidth - 1))}\u2026`;
	}
	return drawing.map((line, index) => `  ${line}  ${text[index] ?? ""}`.trimEnd());
}
