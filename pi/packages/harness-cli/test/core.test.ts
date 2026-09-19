import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { credentialsPath, frontmatterName, writeCredentials } from "../src/core.js";

const saved = { ...process.env };
afterEach(() => {
	process.env = { ...saved };
});

describe("credentials", () => {
	it("writes credentials with owner-only permissions", async () => {
		const home = await mkdtemp(join(tmpdir(), "harness-test-"));
		process.env.HARNESS_CREDENTIALS = join(home, "cfg", "credentials.json");
		await writeCredentials({ api_url: "http://example.test", token: "hpat_test" });
		const path = credentialsPath();
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(JSON.parse(await readFile(path, "utf8")).token).toBe("hpat_test");
	});
});

describe("frontmatterName", () => {
	it("reads a name and falls back cleanly", () => {
		expect(frontmatterName("---\nname: concise\n---\nBody", "fallback")).toBe("concise");
		expect(frontmatterName("Body", "fallback")).toBe("fallback");
	});
});
