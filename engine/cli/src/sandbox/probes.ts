import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arch, execPath, platform } from "node:process";
import { fileURLToPath } from "node:url";
import type { Blocker, SpawnPlan } from "@harness/compose/contracts";
import { confine } from "./confine.js";

const TIMEOUT_MS = 5_000;
type Session = { dir: string; proxyPort: number };
const q = JSON.stringify;

/**
 * The six probes of 06 §8, run before every spawn through the **same**
 * `confine` call the provider gets (D88), so what they prove is the jail the
 * agent will be in and not a second one. Probes 1–5 must fail; probe 6 must
 * succeed; any other outcome ends the boot.
 */
export async function probeSandbox(plan: SpawnPlan, session: Session): Promise<void> {
	const binary = installProbeBinary(session.dir);
	const home = plan.env.HOME;
	const denied = join(session.dir, "denied");
	// Row 5 differs by platform: on Linux the listener binds inside the private
	// namespace and proves nothing, so the probe asserts instead that the port
	// the forwarder holds cannot be taken.
	const listenOn = platform === "linux" ? session.proxyPort : 0;
	const writeTargets = [join(home, ".harness/assets.git/PROBE"), ...plan.filesystem.denyWrite.map((d) => join(d, "PROBE"))];

	// Row 1: an IP literal, so no DNS is involved.
	await expectShut(plan, session, "network", connect(443, "1.1.1.1"));
	// Row 2: the one file the whole design exists to keep out, and the probe dir.
	await expectShut(
		plan,
		session,
		"read",
		`const f=require("node:fs");let o=false;try{o=f.readFileSync(${q(join(home, ".config/harness/credentials.json"))}).length>0}catch{}try{o=o||f.readdirSync(${q(denied)}).length>0}catch{}console.log(o?"OPEN":"SHUT")`,
	);
	// Row 3: the compiled binary — the Spike 5 case, which a script cannot prove.
	await expectShut(
		plan,
		session,
		"exec",
		`try{require("node:child_process").execFileSync(${q(binary)},{stdio:"ignore"});console.log("OPEN")}catch{console.log("SHUT")}`,
	);
	// Row 4: outside the geometry, and inside the provider's own settings dirs.
	await expectShut(
		plan,
		session,
		"write",
		`const f=require("node:fs");let o=false;for(const p of ${q(writeTargets)}){try{f.writeFileSync(p,"probe");f.unlinkSync(p);o=true}catch{}}console.log(o?"OPEN":"SHUT")`,
	);
	// Row 5: no listener of its own.
	await expectShut(
		plan,
		session,
		"bind",
		`const s=require("node:net").createServer();s.on("error",()=>{console.log("SHUT");process.exit(0)});s.listen(${listenOn},"127.0.0.1",()=>{console.log("OPEN");process.exit(0)})`,
	);
	// Row 6: the one route there is.
	if (!(await run(plan, session, "proxy", connect(session.proxyPort, "127.0.0.1")))) {
		throw {
			code: "sandbox.proxy_unreachable",
			message:
				"The agent cannot reach the harness proxy from inside the sandbox, so it would have no network at all.",
			remedy: `Run \`harness preflight sandbox\`. On Linux, check that ${session.dir}/proxy.sock was created.`,
		} satisfies Blocker;
	}
}

/** Verifies the shipped probe binary for this platform/arch against
    `SHA256SUMS` and copies it to `<sessionDir>/denied/probe` (§8.2). It never
    runs outside the jail. */
export function installProbeBinary(sessionDir: string): string {
	const name = `${platform}-${arch}`;
	const dir = fileURLToPath(new URL("../../probe/", import.meta.url));
	const sums = new Map(
		readFileSync(join(dir, "SHA256SUMS"), "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => line.trim().split(/\s+/))
			.map(([sum, file]) => [file, sum] as const),
	);
	let bytes: Buffer;
	try {
		bytes = readFileSync(join(dir, name));
	} catch {
		throw missing(name);
	}
	if (!sums.has(name)) throw missing(name);
	if (createHash("sha256").update(bytes).digest("hex") !== sums.get(name)) {
		throw {
			code: "sandbox.probe_binary_checksum",
			message: `The sandbox probe binary for ${name} does not match its recorded checksum. The harness will not run an unverified binary.`,
			remedy: "Reinstall the harness CLI.",
		} satisfies Blocker;
	}
	mkdirSync(join(sessionDir, "denied"), { recursive: true });
	const target = join(sessionDir, "denied", "probe");
	writeFileSync(target, bytes);
	chmodSync(target, 0o755);
	return target;
}

const connect = (port: number, host: string) =>
	`const s=require("node:net").connect(${port},${q(host)});s.on("connect",()=>{console.log("OPEN");process.exit(0)});s.on("error",()=>{console.log("SHUT");process.exit(0)})`;

const missing = (name: string): Blocker => ({
	code: "sandbox.probe_binary_missing",
	message: `No sandbox probe binary is built for ${name}, so the harness cannot prove the sandbox holds here.`,
	remedy: "This platform is not yet supported; see `docs/engine/06-sandbox.md` §8.2.",
});

type Family = "network" | "read" | "exec" | "write" | "bind";

async function expectShut(plan: SpawnPlan, session: Session, family: Family, script: string): Promise<void> {
	if (!(await run(plan, session, family, script))) return;
	throw {
		code: "sandbox.probe_unexpected_success",
		message: `The sandbox self-test for ${family} succeeded when it should have been refused. The jail does not hold on this machine, so no session will start.`,
		remedy:
			"Run `harness preflight sandbox` and send its output to your administrator. Nothing you can change will make this session safe.",
	} satisfies Blocker;
}

/** True when the probed operation was open to the agent. */
async function run(plan: SpawnPlan, session: Session, name: string, script: string): Promise<boolean> {
	const { command, args } = confine(plan, [execPath, "-e", script], session);
	const { stdout, stderr, timedOut } = await capture(command, args);
	if (timedOut) {
		throw {
			code: "sandbox.probe_timeout",
			message: `The sandbox self-test ${name} did not finish within 5 seconds.`,
			remedy: "Retry; if it repeats, run `harness preflight sandbox`.",
		} satisfies Blocker;
	}
	if (stdout.includes("OPEN")) return true;
	if (stdout.includes("SHUT")) return false;
	// No verdict at all: on Linux the probe runs through the forwarder, and the
	// forwarder failing to start is the one named way this happens (§10).
	if (platform === "linux") {
		throw {
			code: "sandbox.forwarder_failed",
			message: `The in-sandbox forwarder exited before the agent started (${stderr.trim()}).`,
			remedy: "Run `harness preflight sandbox`.",
		} satisfies Blocker;
	}
	throw new Error(`sandbox probe ${name} returned no verdict: ${stderr.trim() || "no output"}`);
}

function capture(command: string, args: string[]): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], timeout: TIMEOUT_MS, killSignal: "SIGKILL" });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (_code, signal) => resolve({ stdout, stderr, timedOut: signal === "SIGKILL" }));
	});
}
