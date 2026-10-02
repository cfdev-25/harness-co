import type { Shell } from "../../src/os/shell.js";

export interface Call {
	file: string;
	args: string[];
}

export interface Fake extends Shell {
	/** Every process this run started, in order, `run` and detached alike. */
	calls: Call[];
	/** Every file written, by path. */
	files: Record<string, { body: string; mode?: number }>;
	made: string[];
	removed: string[];
	/** Queued answers, matched in order against the commands as they come. */
	answers: Array<{ stdout?: string; code?: number }>;
	present: Set<string>;
	directories: Set<string>;
}

/**
 * W5-D13's tests run on one machine and assert what all three would do, so
 * every process call and every file write goes through this instead of the
 * operating system (10 rule 17).
 */
export function fakeShell(platform: NodeJS.Platform = "darwin", overrides: Partial<Shell> = {}): Fake {
	const fake: Fake = {
		platform,
		home: platform === "win32" ? "C:\\Users\\dana" : "/home/dana",
		env: {},
		node: platform === "win32" ? "C:\\Program Files\\nodejs\\node.exe" : "/opt/node/bin/node",
		script: platform === "win32" ? "C:\\harness\\dist\\cli.js" : "/opt/harness/dist/cli.js",
		calls: [],
		files: {},
		made: [],
		removed: [],
		answers: [],
		present: new Set(),
		directories: new Set(),
		run: async (file, args) => {
			fake.calls.push({ file, args });
			const next = fake.answers.shift() ?? {};
			return { stdout: next.stdout ?? "", stderr: "", code: next.code ?? 0 };
		},
		spawnDetached: (file, args) => {
			fake.calls.push({ file, args });
		},
		has: async (name) => fake.present.has(name),
		exists: async (path) => fake.directories.has(path),
		write: async (path, body, mode) => {
			fake.files[path] = { body, mode };
		},
		mkdir: async (path) => {
			fake.made.push(path);
			fake.directories.add(path);
		},
		rm: async (path) => {
			fake.removed.push(path);
		},
		tmp: async () => "/tmp/harness-open-x",
		...overrides,
	};
	return fake;
}
