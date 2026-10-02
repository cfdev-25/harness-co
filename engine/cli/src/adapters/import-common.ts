import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AssetKind, Boundary, HarnessDef, Imported } from "@harness/compose/contracts";
import { safeName } from "../paths.js";
import { assetsRoot } from "../selection.js";

/** Where one provider keeps each thing §4a's table names. The table is the
    same for both; only these file names differ, which is why it is data. */
export interface ImportSpec {
	provider: string;
	instructions: string[]; // relative to the source dir
	/** Relative to `source.workspace`: the project's own copies of the same files. */
	workspaceInstructions?: string[];
	prompts: string; // directory of one-file prompts
	skills: string; // directory of skill directories
	settings: string;
	mcp?: string;
}

const read = async (path: string): Promise<string | null> => readFile(path, "utf8").catch(() => null);
const list = async (dir: string): Promise<string[]> => readdir(dir).catch(() => []);

/** One memory per top-level heading; a file with no headings is one memory.
    The first section is a `system_prompt` when its heading is *Instructions*
    or *System* — the person said so, we do not guess from content. */
export function split(content: string): Array<{ kind: AssetKind; name: string; body: string }> {
	const parts = content.split(/^# +(.+)$/m);
	if (parts.length === 1) return [{ kind: "memory", name: "notes", body: content.trim() }];
	const out: Array<{ kind: AssetKind; name: string; body: string }> = [];
	for (let i = 1; i < parts.length; i += 2) {
		const name = parts[i].trim();
		const first = i === 1 && parts[0].trim() === "";
		const kind = first && /^(instructions|system)$/i.test(name) ? "system_prompt" : "memory";
		out.push({ kind, name, body: `# ${name}\n\n${parts[i + 1].trim()}`.trim() });
	}
	return out;
}

/** Fresh v4 ids (D3), except where this name was imported before: a second
    run finds the sidecar it wrote and keeps the id, so importing twice is
    idempotent rather than a second copy of everything. */
async function sidecarId(dir: string, kind: AssetKind): Promise<string> {
	const existing = await read(join(dir, "asset.json"));
	if (existing) {
		try {
			return (JSON.parse(existing) as { id: string }).id;
		} catch {
			// A damaged sidecar is not an identity; mint a new one.
		}
	}
	return randomUUID();
}

async function place(kind: AssetKind, name: string): Promise<string> {
	const dir = join(assetsRoot(), kind, safeName(name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")));
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await writeFile(join(dir, "asset.json"), `${JSON.stringify({ id: await sidecarId(dir, kind), kind }, null, 2)}\n`);
	return dir;
}

function boundaries(deny: string[], from: string, dropped: Imported["dropped"]): Boundary[] {
	const out: Boundary[] = [];
	for (const pattern of deny) {
		const match = /^(Read|Write|Edit)\((.+)\)$/.exec(pattern);
		if (!match) {
			dropped.push({ what: `permissions.deny \`${pattern}\``, from, why: "No boundary kind maps this pattern." });
			continue;
		}
		out.push({
			id: randomUUID(),
			scope: { teams: "all" },
			kind: "filesystem",
			value: match[2],
			holds: "enforced",
			reason: `Imported from ${from}.`,
		});
	}
	return out;
}

/**
 * 07 §4a — an existing setup becomes a harness. Writes to the work tree only;
 * nothing is pushed until the person runs `push` or the exit review offers
 * it. What cannot carry is named, never silently lost (I7, C2).
 */
export async function importSetup(spec: ImportSpec, source: { dir: string; workspace?: string }): Promise<Imported> {
	const assets: Imported["assets"] = [];
	const dropped: Imported["dropped"] = [];
	const found: Boundary[] = [];

	const instructions = [
		...spec.instructions.map((rel) => join(source.dir, rel)),
		...(source.workspace ? (spec.workspaceInstructions ?? []).map((rel) => join(source.workspace as string, rel)) : []),
	];
	for (const from of instructions) {
		const content = await read(from);
		if (content === null) continue;
		for (const part of split(content)) {
			const path = await place(part.kind, part.name);
			await writeFile(join(path, `${part.kind}.md`), `${part.body}\n`);
			assets.push({ kind: part.kind, name: basename(path), path, from });
		}
	}

	for (const file of await list(join(source.dir, spec.prompts))) {
		if (!file.endsWith(".md")) continue;
		const from = join(source.dir, spec.prompts, file);
		const path = await place("prompt", file.replace(/\.md$/, ""));
		await writeFile(join(path, `${basename(path)}.md`), (await read(from)) ?? "");
		assets.push({ kind: "prompt", name: basename(path), path, from });
	}

	for (const name of await list(join(source.dir, spec.skills))) {
		const from = join(source.dir, spec.skills, name);
		const path = await place("skill", name);
		await cp(from, path, { recursive: true, force: true });
		await writeFile(join(path, "asset.json"), `${JSON.stringify({ id: await sidecarId(path, "skill"), kind: "skill" }, null, 2)}\n`);
		assets.push({ kind: "skill", name: basename(path), path, from });
	}

	const settingsPath = join(source.dir, spec.settings);
	const settings = JSON.parse((await read(settingsPath)) ?? "{}") as Record<string, unknown> & {
		permissions?: { deny?: string[] };
		hooks?: Record<string, unknown>;
		mcpServers?: Record<string, unknown>;
	};
	found.push(...boundaries(settings.permissions?.deny ?? [], settingsPath, dropped));
	for (const event of Object.keys(settings.hooks ?? {})) {
		dropped.push({ what: `hook ${event}`, from: settingsPath, why: "A hook is arbitrary code we cannot vouch for." });
	}
	const servers = Object.keys(settings.mcpServers ?? {});
	if (spec.mcp) {
		// `.mcp.json` is a project file; `~/.claude` only has one if the person
		// kept it there.
		const mcpPath = join(source.workspace ?? source.dir, spec.mcp);
		const mcp = JSON.parse((await read(mcpPath)) ?? "{}") as { mcpServers?: Record<string, unknown> };
		for (const name of Object.keys(mcp.mcpServers ?? {})) servers.push(name);
	}
	for (const name of servers) {
		dropped.push({ what: `MCP server ${name}`, from: settingsPath, why: "Pi has no MCP (D10)." });
	}
	for (const key of ["env", "model", "apiKeyHelper"]) {
		if (key in settings) {
			dropped.push({ what: `settings.${key}`, from: settingsPath, why: "Credentials and model routing are the organisation's." });
		}
	}

	const name = basename(source.workspace ?? process.cwd());
	const harness: HarnessDef = {
		// A uuid, because 02 §7 refuses `harnesses/<id>.json` whose id is not one
		// and 00 §4.3 says so; derived from the source rather than random, because
		// importing twice must yield the same ids (07 §4a).
		id: uuidFrom(`${spec.provider}:${name}`),
		name,
		description: `Imported from ${spec.provider} on ${new Date().toISOString().slice(0, 10)}.`,
		icon: { palette: ["#6f7ae8"], rows: [] },
		assets: [],
	};
	for (const asset of assets) {
		harness.assets.push((JSON.parse(await readFile(join(asset.path, "asset.json"), "utf8")) as { id: string }).id);
	}
	return { assets, harness, boundaries: found, dropped };
}

/** An RFC 4122 v5-shaped uuid over a name, so the same source mints the same id. */
function uuidFrom(name: string): string {
	const hash = createHash("sha256").update(`harness:import:${name}`).digest();
	hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
	hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
	const hex = hash.subarray(0, 16).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
