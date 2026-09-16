import { describe, expect, it } from "vitest";
import { isOutsidePath, parseRedactions, plainAction, redactText, redactValue } from "../src/core.js";

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
		expect(isOutsidePath("/work/project-two/file", "/work/project")).toBe(true);
	});
});

describe("redaction", () => {
	it("requires JSON and replaces exact secret values recursively", () => {
		expect(parseRedactions("not-json")).toEqual([]);
		const entries = parseRedactions('{"secret://acme/key":"abc,123"}');
		expect(redactText("value abc,123 ok", entries)).toBe("value [secret:secret://acme/key] ok");
		expect(redactValue({ nested: ["abc,123"] }, entries)).toEqual({
			nested: ["[secret:secret://acme/key]"],
		});
	});
});
