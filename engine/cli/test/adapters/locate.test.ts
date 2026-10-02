import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { claudeAdapter } from "../../src/adapters/claude/index.js";
import { PI_PIN, pi } from "../../src/adapters/pi/index.js";

const fakeBin = fileURLToPath(new URL("./bin", import.meta.url));
const saved = { ...process.env };
afterEach(() => {
	process.env = { ...saved };
});

function withFakeClaude(version?: string) {
	process.env.PATH = `${fakeBin}${delimiter}${process.env.PATH ?? ""}`;
	if (version) process.env.HARNESS_FAKE_CLAUDE_VERSION = version;
}

describe("locate", () => {
	it("locate_refuses_below_min_version", async () => {
		withFakeClaude("2.1.200");
		await expect(claudeAdapter.locate({ binary: "claude", minVersion: "2.1.275" })).rejects.toMatchObject({
			code: "adapter.below_min_version",
			message: "Claude Code 2.1.200 is installed; your organization requires 2.1.275 or later.",
		});
	});

	it("accepts the floor itself and anything above it", async () => {
		withFakeClaude("2.1.275");
		expect(await claudeAdapter.locate({ binary: "claude", minVersion: "2.1.275" })).toMatchObject({ version: "2.1.275" });
		process.env.HARNESS_FAKE_CLAUDE_VERSION = "2.2.0";
		expect(await claudeAdapter.locate({ binary: "claude", minVersion: "2.1.275" })).toMatchObject({ version: "2.2.0" });
	});

	it("refuses a repo/commit pin for a located provider", async () => {
		withFakeClaude();
		await expect(claudeAdapter.locate({ repo: "anthropics/claude-code", commit: "a1b2c3d4" })).rejects.toMatchObject({
			code: "adapter.pin_shape",
		});
	});

	it("says so when nothing is installed", async () => {
		process.env.PATH = "";
		await expect(claudeAdapter.locate({ binary: "claude", minVersion: "2.1.275" })).rejects.toMatchObject({
			code: "adapter.not_installed",
		});
	});

	it("pi_locate_refuses_pin_mismatch", async () => {
		await expect(pi.locate({ repo: "pi", commit: "a1b2c3d4" })).rejects.toMatchObject({
			code: "adapter.pin_mismatch",
			message: `This CLI ships Pi at ${PI_PIN.commit.slice(0, 8)}; your organization approved a1b2c3d4.`,
		});
		await expect(pi.locate({ binary: "pi", minVersion: "0.85.1" })).rejects.toMatchObject({ code: "adapter.pin_shape" });
	});

	it("reports the vendored bundle at the pinned version", async () => {
		expect(await pi.locate({ repo: "pi", commit: PI_PIN.commit })).toMatchObject({ version: PI_PIN.version });
	});
});
