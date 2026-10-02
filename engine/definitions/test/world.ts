import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Principal } from "../src/auth.js";
import type { Config } from "../src/config.js";
import { gitOut } from "../src/git.js";
import { type Servers, start } from "../src/index.js";
import { createBranch, createRepo } from "../src/repos.js";
import { type FakeApi, fakeApi } from "./fake-api.js";

export interface World {
	config: Config;
	api: FakeApi;
	servers: Servers;
	root: string;
	/** Base URL of the service's smart-HTTP and /internal surface. */
	url: string;
	scratch: string;
	close(): Promise<void>;
}

const hooks = fileURLToPath(new URL("../src/hooks", import.meta.url));

export async function world(): Promise<World> {
	const base = mkdtempSync(join(tmpdir(), "definitions-"));
	const api = await fakeApi();
	const config: Config = {
		root: join(base, "repos"),
		hooks,
		sock: join(base, "hooks.sock"),
		listen: "127.0.0.1:0",
		apiUrl: api.url,
		serviceToken: api.token,
		quota: 2 * 1024 ** 3,
	};
	const servers = await start(config);
	const port = (servers.http.address() as AddressInfo).port;
	return {
		config,
		api,
		servers,
		root: config.root,
		url: `http://127.0.0.1:${port}`,
		scratch: base,
		close: async () => {
			await servers.close();
			await api.close();
			rmSync(base, { recursive: true, force: true });
		},
	};
}

/** A bare repo with `refs/heads/org`, seeded with plumbing rather than through
    `/internal/orgs`, so a test of the transport does not depend on the index. */
export async function seedOrg(root: string, org: string): Promise<string> {
	const repo = await createRepo(root, org);
	await createBranch(repo, "refs/heads/org", org);
	return repo;
}

export async function seedBranch(repo: string, ref: string, nodePath: string): Promise<string> {
	return createBranch(repo, ref, nodePath);
}

/** One commit onto `ref` carrying `files`, built in a scratch index — no work tree. */
export async function seedCommit(repo: string, ref: string, files: Record<string, string>, message: string): Promise<string> {
	const index = join(mkdtempSync(join(tmpdir(), "seed-")), "index");
	const env = { GIT_INDEX_FILE: index };
	const head = (await gitOut(repo, ["rev-parse", ref])).trim();
	await gitOut(repo, ["read-tree", head], { env });
	for (const [path, content] of Object.entries(files)) {
		const oid = (await gitOut(repo, ["hash-object", "-w", "--stdin"], { input: Buffer.from(content) })).trim();
		await gitOut(repo, ["update-index", "--add", "--cacheinfo", `100644,${oid},${path}`], { env });
	}
	const tree = (await gitOut(repo, ["write-tree"], { env })).trim();
	const commit = (await gitOut(repo, ["commit-tree", tree, "-p", head, "-m", message])).trim();
	await gitOut(repo, ["update-ref", ref, commit, head]);
	return commit;
}

export const person = (
	userId: string,
	org: string,
	chain: Array<[string, string, string]>,
	readable: string[] = [],
): Principal => ({
	user_id: userId,
	org_id: org,
	chain: chain.map(([kind, path, ref]) => ({ kind: kind as "org" | "team" | "user", path, ref, commit: "" })),
	readable,
});

export function run(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		execFile("git", args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) =>
			resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr }),
		);
	});
}

export const asToken = (token: string): string[] => ["-c", `http.extraHeader=Authorization: Bearer ${token}`];
