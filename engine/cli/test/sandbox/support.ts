import { type SpawnSyncReturns, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath, platform } from "node:process";
import type { SpawnPlan } from "@harness/compose/contracts";
import { confine } from "../../src/sandbox/confine.js";

export interface Fixture {
	root: string;
	home: string;
	workspace: string;
	plan: SpawnPlan;
	session: { dir: string; proxyPort: number };
}

/** A session geometry on disk: the 06 §7.1 allowWrite set, the §7.2 deny set,
    and the paths §8 and §11 write to. Real directories, because the kernel is
    what the profile talks to (10 rule 17). */
export function fixture(options: { proxyPort?: number; claudeDir?: boolean } = {}): Fixture {
	// Not the default TMPDIR on macOS: D86 allows writes under
	// /private/var/folders wholesale, so a fixture there would be writable for a
	// reason that has nothing to do with the geometry under test. Real sessions
	// live under HOME and a repository, neither of which is in that subpath.
	const root = mkdtempSync(join(platform === "darwin" ? "/private/tmp" : tmpdir(), "harness-sandbox-"));
	const home = join(root, "home");
	const workspace = join(root, "workspace");
	const dir = join(root, "session");
	for (const path of [
		join(home, ".config/harness"),
		join(home, ".ssh"),
		join(home, ".harness/assets"),
		join(home, ".harness/assets.git"),
		workspace,
		join(dir, "agent"),
		join(dir, "tmp"),
		join(dir, "denied"),
	]) {
		mkdirSync(path, { recursive: true });
	}
	if (options.claudeDir !== false) mkdirSync(join(workspace, ".claude"), { recursive: true });
	writeFileSync(join(home, ".config/harness/credentials.json"), '{"token":"the-login-token"}');
	writeFileSync(join(home, ".ssh/id_ed25519"), "PRIVATE KEY");
	writeFileSync(join(home, ".harness/harness.json"), "{}");
	writeFileSync(join(dir, "audit.jsonl"), "");
	const proxyPort = options.proxyPort ?? 61080;
	const plan: SpawnPlan = {
		hosts: [],
		deny: [],
		connectors: {},
		filesystem: {
			allowWrite: [
				workspace,
				join(home, ".harness/assets"),
				join(dir, "agent"),
				join(dir, "audit.jsonl"),
				join(dir, "tmp"),
			],
			denyRead: [join(home, ".config/harness"), join(home, ".ssh"), join(dir, "denied")],
			denyWrite: [join(workspace, ".claude")],
		},
		env: {
			HOME: home,
			PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
			TMPDIR: join(dir, "tmp"),
			HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
			HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
			NO_PROXY: "",
		},
		argv: [],
	};
	return { root, home, workspace, plan, session: { dir, proxyPort } };
}

/** Runs one line of JavaScript inside the jail, through the same `confine`
    call the provider gets, with `plan.env` and nothing merged (§7.3). */
export function inside(f: Fixture, script: string): SpawnSyncReturns<string> {
	const { command, args } = confine(f.plan, [execPath, "-e", script], f.session);
	return spawnSync(command, args, { env: f.plan.env, encoding: "utf8", timeout: 15_000 });
}

/** The same, without blocking this process: a test that answers the jailed
    child from an in-process listener cannot use `spawnSync`, which holds the
    event loop. Returns stdout. */
export function insideAsync(f: Fixture, script: string): Promise<string> {
	const { command, args } = confine(f.plan, [execPath, "-e", script], f.session);
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { env: f.plan.env, timeout: 15_000, killSignal: "SIGKILL" });
		let stdout = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.on("error", reject);
		child.on("close", () => resolve(stdout));
	});
}

/** The same line outside the jail: every negative test has its positive
    control, so a mechanism that broke cannot pass by failing (10 rule 20). */
export function outside(f: Fixture, script: string): SpawnSyncReturns<string> {
	return spawnSync(execPath, ["-e", script], { env: f.plan.env, encoding: "utf8", timeout: 15_000 });
}

export const readScript = (path: string) =>
	`try{const b=require("node:fs").readFileSync(${JSON.stringify(path)});console.log(b.length?"OPEN":"EMPTY")}catch(e){console.log("SHUT",e.code)}`;

export const writeScript = (path: string) =>
	`try{require("node:fs").writeFileSync(${JSON.stringify(path)},"x");console.log("OPEN")}catch(e){console.log("SHUT",e.code)}`;

export const connectScript = (port: number, host: string) =>
	`const s=require("node:net").connect(${port},${JSON.stringify(host)});s.on("connect",()=>{console.log("OPEN");process.exit(0)});s.on("error",(e)=>{console.log("SHUT",e.code);process.exit(0)})`;

export const listenScript = (port: number) =>
	`const s=require("node:net").createServer();s.on("error",(e)=>{console.log("SHUT",e.code);process.exit(0)});s.listen(${port},"127.0.0.1",()=>{console.log("OPEN");process.exit(0)})`;

/** The code of a thrown `Blocker` (contracts §4.7: throw = a Blocker). */
export function blockerOf(error: unknown): { code: string; message: string; remedy: string } {
	return error as { code: string; message: string; remedy: string };
}
