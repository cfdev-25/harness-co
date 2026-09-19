import { afterEach, describe, expect, it, vi } from "vitest";

// A dedicated file because the mock is process-wide for every test in it:
// docs/sandbox-notes.md's own Phase 2 rule is "no unsandboxed fallback", so a
// platform this enforcer cannot back with a verified mechanism must refuse
// to launch rather than pretend, and that needs a platform other than the
// one these tests actually run on.
vi.mock("node:process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:process")>()),
	platform: "linux",
}));

afterEach(() => {
	vi.resetModules();
});

describe("denyReadArgv on a platform with no verified mechanism", () => {
	it("refuses to launch, naming the platform, when there is anything to deny", async () => {
		const { denyReadArgv } = await import("../../src/enforcers/filesystem.js");
		expect(() => denyReadArgv(["claude"], ["/some/tool/dir"])).toThrow(/linux/);
	});

	it("still passes argv through untouched when there is nothing to deny", async () => {
		const { denyReadArgv } = await import("../../src/enforcers/filesystem.js");
		expect(denyReadArgv(["claude", "--flag"], [])).toEqual(["claude", "--flag"]);
	});
});
