import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";

/**
 * W5-D13. The one seam every per-OS call in `os/` goes through, so a test can
 * assert the exact command and the exact file contents on all three platforms
 * from one machine (10 rule 17). Nothing in `os/` touches `node:child_process`
 * or `node:fs` directly.
 */
export interface Shell {
	platform: NodeJS.Platform;
	home: string;
	env: Record<string, string | undefined>;
	/**
	 * The two tokens every registration writes down. A registered handler is
	 * launched by LaunchServices, the Windows shell or a desktop file, none of
	 * which carries the person's `PATH`: `#!/usr/bin/env node` on a machine
	 * whose node lives under nvm or Homebrew would fail silently, with no
	 * terminal and no dialog. So the interpreter and the script are named
	 * absolutely and invoked as a pair.
	 */
	node: string;
	script: string;
	/** Runs to completion and returns what it said. `code` is never thrown on. */
	run(file: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }>;
	/** Starts something and does not wait: a terminal outlives this process. */
	spawnDetached(file: string, args: string[]): void;
	/** Is this on the PATH? */
	has(name: string): Promise<boolean>;
	/** Is there a directory here? */
	exists(path: string): Promise<boolean>;
	write(path: string, body: string, mode?: number): Promise<void>;
	mkdir(path: string): Promise<void>;
	rm(path: string): Promise<void>;
	/** A fresh empty directory under the machine's temp root. */
	tmp(): Promise<string>;
}

/** One POSIX shell word: safe inside a `do shell script` or a `.command`. */
export const word = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;

/** The same text inside an AppleScript string literal. */
export const appleString = (text: string): string => text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

/** The same text inside a PowerShell single-quoted string. */
export const psString = (text: string): string => text.replaceAll("'", "''");

/** The absolute path of the script this process is running (`dist/cli.js`). */
function runningScript(): string {
	const argv = process.argv[1];
	if (argv === undefined) return "";
	try {
		return realpathSync(argv);
	} catch {
		return argv;
	}
}

export function shell(): Shell {
	return {
		platform: process.platform,
		home: homedir(),
		env: process.env,
		node: process.execPath,
		script: runningScript(),
		run: (file, args) =>
			new Promise((resolve) => {
				execFile(file, args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
					const code = (error as { code?: unknown } | null)?.code;
					resolve({ stdout: String(stdout), stderr: String(stderr), code: typeof code === "number" ? code : error === null ? 0 : 1 });
				});
			}),
		spawnDetached: (file, args) => {
			spawn(file, args, { detached: true, stdio: "ignore" }).unref();
		},
		has: async (name) => {
			const [file, args] = process.platform === "win32" ? ["where.exe", [name]] : ["/bin/sh", ["-c", `command -v ${name}`]];
			return await new Promise((resolve) => execFile(file, args, (error) => resolve(error === null)));
		},
		exists: async (path) => {
			try {
				return (await stat(path)).isDirectory();
			} catch {
				return false;
			}
		},
		write: async (path, body, mode = 0o600) => {
			await writeFile(path, body, { mode });
			await chmod(path, mode);
		},
		mkdir: async (path) => {
			await mkdir(path, { recursive: true });
		},
		rm: async (path) => {
			await rm(path, { recursive: true, force: true });
		},
		tmp: () => mkdtemp(join(tmpdir(), "harness-open-")),
	};
}
