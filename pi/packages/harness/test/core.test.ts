import { describe, expect, it } from "vitest";
import { isOutsidePath, plainAction } from "../src/core.js";

describe("plainAction", () => {
	it("uses friendly templates and hides args by default", () => {
		expect(plainAction("read", { path: "notes.md" })).toBe("I'll read notes.md.");
		expect(plainAction("bash", { command: "git status --short and more words beyond eight now" })).toBe(
			"I'll run a command to git status --short and more words beyond eight.",
		);
		expect(plainAction("custom", { secret: "hidden" })).toBe("I'll use custom.");
	});

	it("shows args only when requested", () => {
		expect(plainAction("custom", { query: "all" }, true)).toContain('{"query":"all"}');
	});
});

describe("policy helpers", () => {
	it("detects paths outside the working directory", () => {
		expect(isOutsidePath("src/a.ts", "/work/project")).toBe(false);
		expect(isOutsidePath("../secret", "/work/project")).toBe(true);
		// 07 §6a: the harness work tree is the person's too, so a write there is not asked about.
		expect(isOutsidePath("/home/me/.harness/assets/skill/x/SKILL.md", "/work/project", ["/home/me/.harness/assets"])).toBe(false);
		expect(isOutsidePath("/home/me/.ssh/id", "/work/project", ["/home/me/.harness/assets"])).toBe(true);
		expect(isOutsidePath("/work/project-two/file", "/work/project")).toBe(true);
	});
});

describe("what the extension no longer does", () => {
	it("exports no redaction: there is no value in the jail to redact", async () => {
		const core = (await import("../src/core.js")) as Record<string, unknown>;
		for (const name of ["parseRedactions", "redactText", "redactValue"]) expect(core[name]).toBeUndefined();
	});

	// The extension enforces nothing, so it must also reach nothing: a network
	// call is a rule here, not merely a fact about today's source (07 §10).
	it("extension_makes_no_network_call", async () => {
		const { readFile } = await import("node:fs/promises");
		const { fileURLToPath } = await import("node:url");
		for (const file of ["index.ts", "core.ts"]) {
			const source = await readFile(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), "utf8");
			expect(source).not.toMatch(/node:(http|https|net|tls|dgram)|\bfetch\s*\(|https?:\/\//);
		}
	});
});

