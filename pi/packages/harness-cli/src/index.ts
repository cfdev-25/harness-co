import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
	type Credentials,
	frontmatterName,
	type Manifest,
	materializeManifest,
	readCredentials,
	writeCredentials,
} from "./core.js";

interface ApiErrorBody {
	message?: string;
	detail?: unknown;
}

async function api<T>(credentials: Credentials, path: string, init: RequestInit = {}): Promise<T> {
	const response = await fetch(`${credentials.api_url.replace(/\/$/, "")}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${credentials.token}`,
			"content-type": "application/json",
			...init.headers,
		},
	});
	if (!response.ok) {
		let body: ApiErrorBody = {};
		try {
			body = (await response.json()) as ApiErrorBody;
		} catch {
			// Keep the status fallback below.
		}
		const error = new Error(body.message ?? `Harness API request failed (${response.status}).`);
		Object.assign(error, { status: response.status, detail: body.detail });
		throw error;
	}
	return (await response.json()) as T;
}

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
	const token = (await prompt("Paste your access token from the web app: ")).trim();
	if (!token) throw new Error("An access token is required.");
	const credentials = { api_url: apiUrl, token };
	await api(credentials, "/v1/me");
	await writeCredentials(credentials);
	console.log("Logged in.");
}

export async function whoami(): Promise<void> {
	const credentials = await readCredentials();
	const me = await api<{ email?: string; org_unit_path?: string; user?: { email?: string; org_unit_path?: string } }>(
		credentials,
		"/v1/me",
	);
	console.log(
		`${me.email ?? me.user?.email ?? "Unknown email"} — ${me.org_unit_path ?? me.user?.org_unit_path ?? "Unknown workspace"}`,
	);
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

export async function run(piArgs: string[]): Promise<number> {
	const credentials = await readCredentials();
	const manifest = await api<Manifest>(credentials, "/v1/resolve");
	const session = await materializeManifest(manifest);
	await api(credentials, "/v1/sessions", {
		method: "POST",
		body: JSON.stringify({ id: session.id, model_metadata: manifest.model ?? {} }),
	});
	const refs = Array.from(
		new Set(
			[
				manifest.model?.key_ref,
				...(manifest.connections ?? []).map((connection) => connection.key_ref ?? connection.ref),
			].filter((value): value is string => Boolean(value)),
		),
	);
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
	const env = {
		...process.env,
		PI_CODING_AGENT_DIR: session.agent,
		PI_CODING_AGENT_SESSION_DIR: join(session.agent, "sessions"),
		PI_TELEMETRY: "0",
		HARNESS_SESSION_ID: session.id,
		HARNESS_SESSION_DIR: session.root,
		HARNESS_API_URL: credentials.api_url,
		HARNESS_API_TOKEN: credentials.token,
		HARNESS_REDACTIONS: JSON.stringify(redactions),
		...Object.fromEntries(delivered.map((key) => [key.env_var, key.value])),
	};
	let code = 1;
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
					"--no-prompt-templates",
					...piArgs,
				],
				{ stdio: "inherit", env, cwd: process.cwd() },
			);
			child.once("error", reject);
			child.once("exit", (exitCode, signal) => resolveExit(exitCode ?? (signal ? 1 : 0)));
		});
	} finally {
		await api(credentials, `/v1/sessions/${session.id}`, {
			method: "PATCH",
			body: JSON.stringify({ status: "closed" }),
		}).catch(() => undefined);
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
	const message = takeFlag(args, "--message");
	if (!message) throw new Error("The --message flag is required.");
	const path = args[0];
	if (!path) throw new Error("Provide a skill directory or memory Markdown file.");
	const info = await stat(path);
	const isSkill = info.isDirectory() && (await stat(join(path, "SKILL.md")).catch(() => undefined))?.isFile();
	const isMemory = info.isFile() && extname(path).toLowerCase() === ".md";
	if (!isSkill && !isMemory)
		throw new Error("Push a skill directory containing SKILL.md or one Markdown memory file.");
	const primary = isSkill ? join(path, "SKILL.md") : path;
	const name = frontmatterName(await readFile(primary, "utf8"), basename(path, extname(path)));
	const kind = isSkill ? "skill" : "memory";
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
		console.log(`Pushed ${kind} "${name}".`);
	} catch (error) {
		const status = (error as Error & { status?: number }).status;
		const detail = (error as Error & { detail?: unknown }).detail;
		if (status === 409) {
			const head = (detail as { head?: { message?: string; author?: string } } | undefined)?.head;
			console.error(`Your version: ${message}`);
			console.error(`Their version: ${head?.message ?? "Unknown"} by ${head?.author ?? "Unknown"}`);
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
	const command = args[0] && !args[0].startsWith("-") ? args.shift() : "run";
	if (command === "login") await login(args);
	else if (command === "whoami") await whoami();
	else if (command === "resolve") await resolveManifest(args);
	else if (command === "push") await pushAsset(args);
	else if (command === "run") return run(args);
	else return run(argv);
	return 0;
}

export * from "./core.js";
