import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:process";
import { describe, expect, it } from "vitest";
import { installProbeBinary } from "../../src/sandbox/probes.js";
import {
	connectScript,
	fixture,
	inside,
	listenScript,
	outside,
	readScript,
	writeScript,
} from "./support.js";

/** 06 §11 on macOS: every row that the Seatbelt profile decides, spawned for
    real under the profile the provider will get. */
describe.skipIf(platform !== "darwin")("the jail on macOS", () => {
	it("denied_host_has_no_route", () => {
		const f = fixture();
		const script = connectScript(443, "1.1.1.1");
		const jailed = inside(f, script).stdout;
		expect(jailed).toContain("SHUT");
		expect(jailed).toContain("EPERM");
		// The control: the same line outside the jail reaches the same host.
		expect(outside(f, script).stdout).toContain("OPEN");
	}, 30_000);

	it("denied_path_unreadable", () => {
		const f = fixture();
		for (const path of [
			join(f.home, ".config/harness/credentials.json"),
			join(f.home, ".ssh/id_ed25519"),
		]) {
			expect(inside(f, readScript(path)).stdout).toContain("SHUT");
			expect(inside(f, readScript(path)).stdout).toContain("EPERM");
			expect(outside(f, readScript(path)).stdout).toContain("OPEN");
		}
		// The deny is scoped, not global: a path outside the deny set still reads.
		expect(inside(f, readScript(join(f.home, ".harness/harness.json"))).stdout).toContain("OPEN");
	}, 30_000);

	it("compiled_binary_in_denied_dir_does_not_exec", () => {
		const f = fixture();
		const binary = installProbeBinary(f.session.dir);
		const script = join(f.session.dir, "denied", "run");
		writeFileSync(script, "#!/bin/sh\nexit 0\n");
		chmodSync(script, 0o755);
		const exec = (path: string) =>
			`try{require("node:child_process").execFileSync(${JSON.stringify(path)},{stdio:"ignore"});console.log("OPEN")}catch(e){console.log("SHUT",e.code)}`;
		expect(inside(f, exec(binary)).stdout).toContain("SHUT");
		// Spike 5's other three access modes: the script is refused too.
		expect(inside(f, exec(script)).stdout).toContain("SHUT");
		// The control that makes the result mean something: the same Mach-O binary
		// execs outside, so the refusal inside is the sandbox and not a bad build.
		expect(execFileSync(binary, { encoding: "utf8" })).toBe("hello\n");
	}, 30_000);

	it("write_outside_geometry_fails", () => {
		const f = fixture();
		for (const path of [
			join(f.home, ".harness/assets.git/PROBE"),
			join(f.session.dir, "preflight.json"),
			join(f.workspace, ".claude/x"),
		]) {
			expect(inside(f, writeScript(path)).stdout).toContain("SHUT");
			expect(existsSync(path)).toBe(false);
		}
		// The selection file (C16) exists and stays as it was.
		const selection = join(f.home, ".harness/harness.json");
		expect(inside(f, writeScript(selection)).stdout).toContain("SHUT");
		expect(readFileSync(selection, "utf8")).toBe("{}");
		for (const allowed of f.plan.filesystem.allowWrite) {
			const target = allowed.endsWith("audit.jsonl") ? allowed : join(allowed, "PROBE");
			expect(inside(f, writeScript(target)).stdout).toContain("OPEN");
		}
	}, 30_000);

	it("listener_bind_refused", () => {
		const f = fixture();
		expect(inside(f, listenScript(0)).stdout).toContain("SHUT");
		expect(outside(f, listenScript(0)).stdout).toContain("OPEN");
	}, 30_000);

	it("deny_write_settings_file_holds", () => {
		for (const claudeDir of [true, false]) {
			const f = fixture({ claudeDir });
			const settings = join(f.workspace, ".claude/settings.json");
			if (claudeDir) writeFileSync(settings, "{}");
			expect(inside(f, writeScript(settings)).stdout).toContain("SHUT");
			// And the directory itself cannot be created to hold one.
			const mkdir = `try{require("node:fs").mkdirSync(${JSON.stringify(join(f.workspace, ".claude"))},{recursive:true});require("node:fs").writeFileSync(${JSON.stringify(settings)},"{}");console.log("OPEN")}catch(e){console.log("SHUT",e.code)}`;
			expect(inside(f, mkdir).stdout).toContain("SHUT");
		}
	}, 30_000);

	it("env_is_exactly_plan_env", () => {
		const f = fixture();
		const seen = JSON.parse(inside(f, "console.log(JSON.stringify(process.env))").stdout);
		// `sandbox-exec` links CoreFoundation and sets this one variable for its
		// child from the uid; it carries nothing from the supervisor's
		// environment, and it is the only key the jail sees that the plan did not
		// put there.
		delete seen.__CF_USER_TEXT_ENCODING;
		expect(seen).toEqual(f.plan.env);
		expect(seen.TMPDIR).toBe(join(f.session.dir, "tmp"));
	}, 30_000);
});
