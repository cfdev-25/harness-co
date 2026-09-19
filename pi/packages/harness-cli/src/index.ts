import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { adapters } from "./adapters/registry.js";
import type { Adapter } from "./adapters/types.js";
import { api } from "./api.js";
import { adopt, identify, record, reset, status } from "./assets.js";
import { type Manifest, readCredentials, sessionDir, writeCredentials } from "./core.js";
import { doctor } from "./doctor.js";
import { childEnvironment } from "./env.js";
import { findHarness, readSelection, resolveForSession, switchHarness } from "./harness.js";
import { help, manual, VERSION } from "./help.js";
import { hydrate } from "./hydrate.js";
import { createSpool, supervise } from "./supervise.js";

async function prompt(message: string): Promise<string> {
	const rl = createInterface({ input: stdin, output: stdout });
	try {
		return await rl.question(message);
	} finally {
		rl.close();
	}
}

function takeFlag(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	const value = args[index + 1];
	if (!value || value.startsWith("-")) throw new Error(`${name} requires a value.`);
	args.splice(index, 2);
	return value;
}

export async function login(args: string[]): Promise<void> {
	const apiUrl = takeFlag(args, "--api-url") ?? "http://localhost:8400";
	const flag = takeFlag(args, "--token");
	const token = (flag ?? (await prompt("Paste your access token from the web console: "))).trim();
	if (!token) throw new Error("An access token is required.");
	const credentials = { api_url: apiUrl, token };
	await api(credentials, "/v1/me");
	await writeCredentials(credentials);
	console.log("Logged in. Run `harness run` to start a session, or `harness --help` to see everything.");
}

interface Me {
	email?: string;
	org_unit_path?: string;
	units?: Array<{ role: string; name: string }>;
	user?: { email?: string; org_unit_path?: string };
}

export async function whoami(): Promise<void> {
	const credentials = await readCredentials();
	const me = await api<Me>(credentials, "/v1/me");
	const email = me.email ?? me.user?.email;
	// Widest org first, narrowest last, then who you are. The user's own unit
	// is named after their email, so it is dropped rather than repeated.
	const units = (me.units ?? []).filter((unit) => unit.role !== "user").map((unit) => unit.name);
	const line = [...units, email ?? "unknown email"].join("  ›  ");
	console.log(line || me.org_unit_path || "No workspace yet.");
	const selection = await readSelection();
	console.log(`harness: ${selection?.name ?? "none — everything you have is loaded"}`);
}

export async function resolveManifest(args: string[]): Promise<void> {
	if (!args.includes("--json")) throw new Error("Use `harness resolve --json` to print the resolved manifest.");
	const credentials = await readCredentials();
	console.log(JSON.stringify(await resolveForSession(credentials), null, 2));
}

interface DeliveredKey {
	ref: string;
	env_var: string;
	value: string;
}

/** Hydration on its own, so the asset loop does not require a session. */
export async function pull(): Promise<number> {
	const credentials = await readCredentials();
	const manifest = await api<Manifest>(credentials, "/v1/resolve");
	await hydrate(manifest, (message) => console.log(message));
	console.log("Up to date. `harness status` shows what you have changed.");
	return 0;
}

const RESERVED_RUN_FLAGS = new Set(["--help", "-h", "--version", "-v"]);

interface RunArgs {
	agentWord?: string;
	harnessFlag?: string;
	passthrough: string[];
	before: string[];
}

/**
 * `run pi --marketing -- --resume`: the agent is the one undashed word
 * before `--`, the harness is the one non-reserved dashed word, and `--`
 * hands everything after it to the agent verbatim (agents.md §2). Reserved
 * flags are excluded from the harness-flag count here so they keep their
 * ordinary CLI meaning instead of being mistaken for a harness name — `run`
 * checks `before` for them before looking at the rest of this.
 */
function splitRunArgs(args: string[]): RunArgs {
	const cut = args.indexOf("--");
	const before = cut < 0 ? args : args.slice(0, cut);
	const passthrough = cut < 0 ? [] : args.slice(cut + 1);
	const undashed = before.filter((arg) => !arg.startsWith("-"));
	const dashed = before.filter((arg) => arg.startsWith("-") && !RESERVED_RUN_FLAGS.has(arg));
	if (undashed.length > 1) {
		throw new Error(
			"`harness run` takes one agent name; agent arguments go after `--`, e.g. " +
				`\`harness run ${undashed[0]} -- ${undashed.slice(1).join(" ")}\`.`,
		);
	}
	if (dashed.length > 1) {
		throw new Error(`\`harness run\` takes one harness flag; you gave ${dashed.join(" and ")}.`);
	}
	return { agentWord: undashed[0], harnessFlag: dashed[0]?.slice(2), passthrough, before };
}

/**
 * The agent is a positional, matched against the registry before anything
 * else runs: a typo'd name silently launching the wrong agent is the one
 * failure this command must not have, so it is never passed through
 * (agents.md §2).
 */
function selectAdapter(agentWord: string | undefined): Adapter {
	const known = Object.keys(adapters);
	if (agentWord) {
		const found = adapters[agentWord];
		if (!found) throw new Error(`"${agentWord}" is not an agent this CLI knows. You have: ${known.join(", ")}.`);
		return found;
	}
	if (known.length === 1) return adapters[known[0]];
	throw new Error(`Say which agent: ${known.join(", ")}.`);
}

export async function run(args: string[]): Promise<number> {
	const { agentWord, harnessFlag, passthrough, before } = splitRunArgs(args);
	if (before.includes("--help") || before.includes("-h")) return help();
	if (before.includes("--version") || before.includes("-v")) {
		console.log(VERSION);
		return 0;
	}
	// Resolved with zero I/O, and before login is even checked: a typo in the
	// agent name is wrong regardless of who is signed in.
	const adapter = selectAdapter(agentWord);

	const credentials = await readCredentials();
	// The flag is a per-run override, never the persisted selection — that
	// stays `switch`'s file, so the two cannot fight over it (agents.md §2).
	const manifest = harnessFlag
		? await api<Manifest>(
				credentials,
				`/v1/resolve?harness_id=${encodeURIComponent((await findHarness(credentials, harnessFlag)).id)}`,
			)
		: await resolveForSession(credentials);
	// Hydration always sees the whole resolved set. Handing it a per-harness
	// one would delete clean directories on every switch and fetch them back
	// on the next — see docs/harnesses.md §3.
	await hydrate(manifest, (message) => console.log(message));
	if (!manifest.harness && manifest.harnesses?.length) {
		const count = manifest.harnesses.length;
		console.log(
			`${count} ${count === 1 ? "harness is" : "harnesses are"} available to you; ` +
				"`harness switch` picks one. Loading everything you have.",
		);
	}
	const id = randomUUID();
	const root = sessionDir(id);
	const ctx = { manifest, id, sessionDir: root, agentDir: join(root, "agent") };
	await adapter.render(ctx);
	await api(credentials, "/v1/sessions", {
		method: "POST",
		body: JSON.stringify({
			id: id,
			harness_id: manifest.harness?.id ?? null,
			model_metadata: manifest.model ?? {},
		}),
	});
	const refs = manifest.model?.key_ref ? [manifest.model.key_ref] : [];
	const deliveredRaw = await api<DeliveredKey[] | { keys: DeliveredKey[] }>(credentials, "/v1/api-keys/deliver", {
		method: "POST",
		body: JSON.stringify({ refs, session_id: id }),
	});
	const delivered = Array.isArray(deliveredRaw) ? deliveredRaw : deliveredRaw.keys;
	const redactions = Object.fromEntries(delivered.map((key) => [key.ref, key.value]));
	const launched = adapter.launch(ctx);
	const env = childEnvironment({
		sessionId: id,
		sessionDir: root,
		adapterEnv: {
			...launched.env,
			// Until the proxy injects credentials (build-plan 3.2) the agent
			// still needs the provider key in its environment, so transcript
			// redaction still has a job. Both leave together in 3.2.
			HARNESS_REDACTIONS: JSON.stringify(redactions),
			...Object.fromEntries(delivered.map((key) => [key.env_var, key.value])),
		},
	});
	await createSpool(root);
	let code = 1;
	let watcher: { stop(): Promise<void> } | undefined;
	try {
		code = await new Promise<number>((resolveExit, reject) => {
			// argv[0] is the executable the adapter chose. Not every agent is a
			// node bundle — Claude Code ships a native binary — so the command
			// is the adapter's to name, never this function's to assume.
			const [command, ...rest] = [...launched.argv, ...passthrough];
			const child = spawn(command, rest, {
				stdio: "inherit",
				env,
				cwd: process.cwd(),
			});
			watcher = supervise({ child, sessionId: id, sessionDir: root, credentials });
			child.once("error", reject);
			child.once("exit", (exitCode, signal) => resolveExit(exitCode ?? (signal ? 1 : 0)));
		});
	} finally {
		await watcher?.stop();
	}
	return code;
}

async function collectFiles(path: string): Promise<Array<{ path: string; content_b64: string }>> {
	const info = await stat(path);
	if (info.isFile()) {
		return [{ path: basename(path), content_b64: (await readFile(path)).toString("base64") }];
	}
	const files: Array<{ path: string; content_b64: string }> = [];
	async function walk(directory: string) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) await walk(absolute);
			else if (entry.isFile()) {
				files.push({
					path: absolute.slice(path.length + 1),
					content_b64: (await readFile(absolute)).toString("base64"),
				});
			}
		}
	}
	await walk(path);
	return files;
}

export async function pushAsset(args: string[]): Promise<void> {
	const nonInteractive = args.includes("--non-interactive") || !stdin.isTTY;
	const index = args.indexOf("--non-interactive");
	if (index >= 0) args.splice(index, 1);
	const message = takeFlag(args, "--message");
	if (!message) throw new Error("The --message flag is required.");
	const path = args[0];
	if (!path) throw new Error("Provide a skill directory, tool directory, or memory Markdown file.");
	const { kind, name } = await identify(path);
	const credentials = await readCredentials();
	const me = await api<{ org_unit_id?: string; user?: { org_unit_id?: string } }>(credentials, "/v1/me");
	const orgUnitId = me.org_unit_id ?? me.user?.org_unit_id;
	if (!orgUnitId) throw new Error("Your account does not have a user workspace.");
	const files = await collectFiles(path);
	const matches = await api<Array<{ id: string; kind: string; name: string; head_version_id?: string }>>(
		credentials,
		`/v1/org-units/${encodeURIComponent(orgUnitId)}/assets`,
	);
	const existing = matches.find((asset) => asset.kind === kind && asset.name === name);
	try {
		if (!existing) {
			await api(credentials, "/v1/assets", {
				method: "POST",
				body: JSON.stringify({ org_unit_id: orgUnitId, kind, name, message, files }),
			});
		} else {
			await api(credentials, `/v1/assets/${existing.id}/versions`, {
				method: "POST",
				body: JSON.stringify({ message, parent_version_id: existing.head_version_id, files }),
			});
		}
		await record(path, message);
		console.log(`Pushed ${kind} "${name}".`);
	} catch (error) {
		const status = (error as Error & { status?: number }).status;
		const detail = (error as Error & { detail?: unknown }).detail;
		if (status === 409) {
			const head = (detail as { head?: { message?: string; author?: string } } | undefined)?.head;
			console.error(`Your version: ${message}`);
			console.error(`Their version: ${head?.message ?? "Unknown"} by ${head?.author ?? "Unknown"}`);
			// Overriding someone else's version is a decision, so it is never
			// made on their behalf when nobody is there to make it.
			if (nonInteractive) {
				console.error(`Run \`harness push\` from a terminal to choose, or \`harness reset ${kind}/${name}\`.`);
				process.exitCode = 1;
				return;
			}
			const choice = (await prompt("[k]eep pushing mine / [a]bort: ")).trim().toLowerCase();
			if (choice !== "k") return;
			await api(credentials, `/v1/assets/${existing?.id}/versions`, {
				method: "POST",
				body: JSON.stringify({
					message,
					parent_version_id: head && (head as { version_id?: string }).version_id,
					files,
				}),
			});
			await record(path, message);
			return;
		}
		if (status === 422 && Array.isArray(detail)) {
			for (const reason of detail) console.error(typeof reason === "string" ? reason : JSON.stringify(reason));
			return;
		}
		throw error;
	}
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	const args = [...argv];
	if (args[0] === "--help" || args[0] === "-h") return help();
	if (args[0] === "--version" || args[0] === "-v") {
		console.log(VERSION);
		return 0;
	}
	const command = args[0] && !args[0].startsWith("-") ? args.shift() : "run";
	if (command === "help") return help();
	if (command === "man") return manual();
	if (command === "login") await login(args);
	else if (command === "whoami") await whoami();
	else if (command === "resolve") await resolveManifest(args);
	else if (command === "push") await pushAsset(args);
	else if (command === "switch") return switchHarness(args);
	else if (command === "pull") return pull();
	else if (command === "doctor") return doctor(args);
	else if (command === "status") return status();
	else if (command === "reset") return reset(args);
	else if (command === "adopt") return adopt(args);
	else if (command === "run") return run(args);
	else return run(argv);
	return 0;
}

export * from "./core.js";
