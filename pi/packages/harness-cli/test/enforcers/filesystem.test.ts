import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { denyReadArgv } from "../../src/enforcers/filesystem.js";

const run = promisify(execFile);

describe("denyReadArgv", () => {
	it("leaves argv untouched when nothing is denied, on any platform", () => {
		expect(denyReadArgv(["a", "b"], [])).toEqual(["a", "b"]);
	});

	it("wraps argv with sandbox-exec, denying both file-read* and process-exec on the resolved path", async () => {
		// `/tmp` resolves to `/private/tmp` on macOS (docs/sandbox-notes.md,
		// Spike 5): asserting against the realpath is what proves the profile
		// would actually match, not just that a profile was generated.
		const dir = await realpath(await mkdtemp(join(tmpdir(), "denyread-")));
		const wrapped = denyReadArgv(["/bin/echo", "hi"], [dir]);
		expect(wrapped[0]).toBe("/usr/bin/sandbox-exec");
		expect(wrapped[1]).toBe("-p");
		expect(wrapped[2]).toContain(`(deny file-read* (subpath "${dir}"))`);
		expect(wrapped[2]).toContain(`(deny process-exec (subpath "${dir}"))`);
		expect(wrapped.slice(3)).toEqual(["/bin/echo", "hi"]);
	});

	it("drops a denied path that no longer exists rather than failing the launch", async () => {
		expect(denyReadArgv(["/bin/echo"], ["/does/not/exist/at/all"])).toEqual(["/bin/echo"]);
	});

	// This is the empirical claim itself (Spike 5), not just the argv shape:
	// a real script under the denied directory must fail to be read AND
	// fail to execute, matching what a team tool's `run` file needs.
	describe("empirically, against a real script under the denied path", () => {
		async function tool(): Promise<{ dir: string; run: string }> {
			const root = await realpath(await mkdtemp(join(tmpdir(), "denyread-tool-")));
			const dir = join(root, "tool", "deploy");
			await mkdir(dir, { recursive: true });
			const runPath = join(dir, "run");
			await writeFile(runPath, "#!/bin/sh\necho ran\n", { mode: 0o755 });
			return { dir, run: runPath };
		}

		it("denies cat of the tool's run file", async () => {
			const { dir, run: runPath } = await tool();
			const [command, ...args] = denyReadArgv(["cat", runPath], [dir]);
			await expect(run(command, args)).rejects.toThrow();
		});

		it("denies executing the tool's run file directly", async () => {
			const { dir, run: runPath } = await tool();
			const [command, ...args] = denyReadArgv([runPath], [dir]);
			await expect(run(command, args)).rejects.toThrow();
		});

		it("allows the same script when its directory is not in the deny set", async () => {
			const { run: runPath } = await tool();
			const [command, ...args] = denyReadArgv([runPath], []);
			const { stdout } = await run(command, args);
			expect(stdout).toContain("ran");
		});
	});
});
