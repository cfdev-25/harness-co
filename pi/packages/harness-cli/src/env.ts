import { delimiter } from "node:path";

// The agent inherits nothing. Anything it needs is listed here explicitly, so
// a credential in the user's shell can never reach it by accident.
const PASSTHROUGH = ["TERM", "LANG", "TZ"] as const;
const PATH_ROOTS = ["/usr/", "/bin", "/sbin", "/opt/homebrew/", "/usr/local/"];

export interface ChildEnvironmentInput {
	sessionId: string;
	sessionDir: string;
	proxyUrl?: string;
	adapterEnv: Record<string, string>;
}

function systemPath(): string {
	return (process.env.PATH ?? "")
		.split(delimiter)
		.filter((entry) => PATH_ROOTS.some((root) => entry === root.replace(/\/$/, "") || entry.startsWith(root)))
		.join(delimiter);
}

export function childEnvironment(input: ChildEnvironmentInput): Record<string, string> {
	const env: Record<string, string> = {
		// HOME is verbatim: ~/.harness paths must resolve inside the jail.
		HOME: process.env.HOME ?? "",
		PATH: systemPath(),
		HARNESS_SESSION_ID: input.sessionId,
		HARNESS_SESSION_DIR: input.sessionDir,
	};
	for (const key of PASSTHROUGH) {
		const value = process.env[key];
		if (value !== undefined) env[key] = value;
	}
	if (input.proxyUrl) {
		env.HTTP_PROXY = input.proxyUrl;
		env.HTTPS_PROXY = input.proxyUrl;
		env.NO_PROXY = "";
	}
	for (const [key, value] of Object.entries(input.adapterEnv)) {
		if (key in env) throw new Error(`adapter may not override core env: ${key}`);
		env[key] = value;
	}
	return env;
}
