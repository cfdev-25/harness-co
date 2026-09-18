import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { api } from "./api.js";
import { adopt, identify, record, reset, status } from "./assets.js";
import { type Manifest, materializeManifest, readCredentials, writeCredentials } from "./core.js";
import { doctor } from "./doctor.js";
import { childEnvironment } from "./env.js";
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
}

export async function resolveManifest(args: string[]): Promise<void> {
	if (!args.includes("--json")) throw new Error("Use `harness resolve --json` to print the resolved manifest.");
	const credentials = await readCredentials();
	console.log(JSON.stringify(await api(credentials, "/v1/resolve"), null, 2));
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

export async function run(piArgs: string[]): Promise<number> {
	const credentials = await readCredentials();
	const manifest = await api<Manifest>(credentials, "/v1/resolve");
	await hydrate(manifest, (message) => console.log(message));
	const session = await materializeManifest(manifest);
	await api(credentials, "/v1/sessions", {
		method: "POST",
		body: JSON.stringify({ id: session.id, model_metadata: manifest.model ?? {} }),
	});
	const refs = manifest.model?.key_ref ? [manifest.model.key_ref] : [];
	const deliveredRaw = await api<DeliveredKey[] | { keys: DeliveredKey[] }>(credentials, "/v1/api-keys/deliver", {
		method: "POST",
		body: JSON.stringify({ refs, session_id: session.id }),
	});
	const delivered = Array.isArray(deliveredRaw) ? deliveredRaw : deliveredRaw.keys;
	const redactions = Object.fromEntries(delivered.map((key) => [key.ref, key.value]));
	const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const piEntry = resolve(packageRoot, "../coding-agent/dist/bundle/cli.js");
	const extension = resolve(packageRoot, "../harness/dist/index.js");
	const theme = resolve(packageRoot, "../harness/themes/harness-dark.json");
	const env = childEnvironment({
		sessionId: session.id,
		sessionDir: session.root,
		adapterEnv: {
			// Until the Pi adapter lands (build-plan 2.1) these live inline.
			PI_CODING_AGENT_DIR: session.agent,
			PI_CODING_AGENT_SESSION_DIR: join(session.agent, "sessions"),
			PI_TELEMETRY: "0",
			// Until the proxy injects credentials (build-plan 3.2) the agent
			// still needs the provider key in its environment, so transcript
			// redaction still has a job. Both leave together in 3.2.
			HARNESS_REDACTIONS: JSON.stringify(redactions),
			...Object.fromEntries(delivered.map((key) => [key.env_var, key.value])),
		},
	});
	await createSpool(session.root);
	let code = 1;
	let watcher: { stop(): Promise<void> } | undefined;
	try {
		code = await new Promise<number>((resolveExit, reject) => {
			const child = spawn(
				process.execPath,
				[
					piEntry,
					"--offline",
					"--no-approve",
					"--no-extensions",
					"-e",
					extension,
					"--theme",
					theme,
					"--use-theme",
					"harness-dark",
					// Discovery off, so nothing from this machine is loaded, and
					// then the one directory we delivered named explicitly.
					"--no-prompt-templates",
					"--prompt-template",
					join(session.agent, "prompts"),
					...piArgs,
				],
				{ stdio: "inherit", env, cwd: process.cwd() },
			);
			watcher = supervise({ child, sessionId: session.id, sessionDir: session.root, credentials });
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
