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
