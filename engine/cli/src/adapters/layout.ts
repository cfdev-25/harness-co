import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { claudeHolds } from "@harness/compose";
import type { ComposedAsset, Concern, EffectiveReach, SpawnPlan } from "@harness/compose/contracts";

/** 00 §4.8's `Concern` union as data, so a `capabilities` matrix and a
    `RenderReport` can be checked against the same list. */
export const CONCERNS: Concern[] = [
	"skill", "prompt", "system_prompt", "memory", "tool_index", "tool_gating",
	"audit", "state_isolation", "project_suppression", "model_org", "model_native",
];

// 03 §5.3 owns `loadSet`; this module imports it and owns no copy (07 §3).
export { loadSet } from "../preflight/loadset.js";

/** `<agentDir>/rendered.json` — the record that makes drift detection exact
    (07 §5, D92). Private to `adapters/`: nothing outside reads it. */
export interface Rendered {
	/** Asset ids, in the order they were laid out. */
	concerns: { skill: string[]; prompt: string[]; system_prompt: string[]; memory: string[]; tool_index: string[] };
	model: { endpoint: string; model: string } | null;
	hooks: string[];
	denies: string[];
	/** Relative link path → absolute target. */
	links: Record<string, string>;
	/** Relative generated path → sha256. */
	files: Record<string, string>;
}

/** The same object, filled in as `render` goes. */
export type RenderedBuilder = Rendered;

export function newRendered(): RenderedBuilder {
	return {
		concerns: { skill: [], prompt: [], system_prompt: [], memory: [], tool_index: [] },
		model: null,
		hooks: [],
		denies: [],
		links: {},
		files: {},
	};
}

/** The kinds a delivery is counted by, in the order both briefs name them. */
export const DELIVERED_KINDS = ["skill", "prompt", "memory", "tool", "context", "environment"] as const;
export type DeliveredKind = (typeof DELIVERED_KINDS)[number];
export type DeliveredSets = Record<DeliveredKind, string[]>;

const PLURALS: Record<string, string> = { memory: "memories" };
const plural = (kind: string) => PLURALS[kind] ?? `${kind}s`;

/** What this session was given, by kind — computed **once** (W5-D12): the two
    briefs, Pi's card and the CLI's boot screen all read this and none of them
    counts a load set of its own. */
export function deliveredSets(loaded: ComposedAsset[]): DeliveredSets {
	return Object.fromEntries(
		DELIVERED_KINDS.map((kind) => [kind, loaded.filter((asset) => asset.kind === kind).map((asset) => asset.name)]),
	) as DeliveredSets;
}

/** 07 §6a's second line: what this harness delivered, by name, so *what do you
    have?* separates the harness's assets from the runtime's own features. */
export function delivered(sets: DeliveredSets): string {
	const parts = DELIVERED_KINDS.filter((kind) => sets[kind].length > 0).map((kind) => `${plural(kind)} ${sets[kind].join(", ")}`);
	return parts.length === 0 ? "This harness delivers no assets yet." : `This harness delivers: ${parts.join(" · ")}.`;
}

/** The same delivery as counts — `3 skills · 1 prompt · 2 memories` (W5-D12). */
export function deliveredCounts(sets: DeliveredSets): string {
	const parts = DELIVERED_KINDS.filter((kind) => sets[kind].length > 0).map(
		(kind) => `${sets[kind].length} ${sets[kind].length === 1 ? kind : plural(kind)}`,
	);
	return parts.join(" · ") || "nothing yet";
}

/** 07 §6a's third line (D131): what this session can reach, said once, in the
    brief both providers open with. A session that does not know its own fence
    spends its turns discovering it — the refusal is a sentence, not a mystery. */
export function reachLine(reach: EffectiveReach): string {
	if (reach.mode === "off")
		return `Reach: off. This session can only connect to the hosts it holds a credential for; anything else is refused by the fence, and the model may not browse on the provider's side either. ${reach.setBy} decides this.`;
	if (reach.mode === "on")
		return `Reach: on${reach.hosts.length === 0 ? "" : `, except ${reach.hosts.join(", ")}`}. Set by ${reach.setBy}.`;
	return `Reach: allow-list — ${reach.hosts.join(", ") || "nothing"}. Anything else is refused by the fence, and the model may not browse on the provider's side either. ${reach.setBy} decides this; ask there to add a host.`;
}

/**
 * 07 §6a (D30j) — the one fixed paragraph both briefs open with, before any
 * asset and even when the harness is empty, so a session always knows where an
 * asset it makes belongs. The path is the real `assetsRoot`, not a literal
 * `~/.harness`: a session with a moved `HARNESS_HOME` reads its own.
 */
export function seam(assetsRoot: string): string {
	return `Harness assets live at \`${assetsRoot}/<kind>/<name>/\` — \`skill/\`, \`tool/\`, \`prompt/\`, \`memory/\`, \`system_prompt/\`, \`connection/\`, \`context/\`, \`environment/\`. A new skill, tool, prompt, context (a template, a reference, brand assets) or environment (what must be installed) goes there, in that kind's shape; it is offered to keep when the session ends. Files in the working directory belong to the project, not to the harness. The \`harness-authoring\` skill says how to make one, and how to extract a setup from another tool. This harness has its own Python and Node environments, first on PATH: install there, never on the machine, and record what you install in an environment asset.`;
}

/** Broadest node first (shorter chain path), then name. One rule for both providers. */
export function sections(assets: ComposedAsset[], read: (a: ComposedAsset) => string): string {
	return [...assets]
		.sort((a, b) => a.from.path.length - b.from.path.length || a.name.localeCompare(b.name))
		.map((asset) => `## ${asset.name}\n\n${read(asset)}`)
		.join("\n\n");
}

/** 0600; records `{ path, sha256 }` into the `Rendered` under construction. */
export async function writeGenerated(r: RenderedBuilder, agentDir: string, rel: string, content: string): Promise<void> {
	const target = join(agentDir, rel);
	await mkdir(dirname(target), { recursive: true, mode: 0o700 });
	await writeFile(target, content, { mode: 0o600 });
	r.files[rel] = createHash("sha256").update(content).digest("hex");
}

/**
 * Symlink `<agentDir>/<rel>` → `<assetsRoot>/<kind>/<name>`; records the link.
 *
 * `file` narrows the target to one file inside the asset directory, which is
 * what a prompt needs: Claude Code loads `commands/<name>.md` and Pi loads
 * `--prompt-template`'s directory entry as a file, never as a directory. The
 * link is still into `assetsRoot`; nothing is copied (C5, A2).
 */
export async function symlinkAsset(
	r: RenderedBuilder,
	agentDir: string,
	rel: string,
	assetsRoot: string,
	kind: string,
	name: string,
	file?: string,
): Promise<void> {
	const target = file ? join(assetsRoot, kind, name, file) : join(assetsRoot, kind, name);
	const link = join(agentDir, rel);
	await mkdir(dirname(link), { recursive: true, mode: 0o700 });
	await symlink(target, link);
	r.links[rel] = target;
	// Also a `files` entry, so one comparison in 03 catches a retargeted link
	// and names it: `Rehydrated` carries hashes, not links (00 §4.8).
	r.files[rel] = `symlink:${target}`;
}

/** What `rehydrate` recomputes for one recorded path: the file's sha256, the
    link's actual target, or `missing`. Compared to `rendered.json`'s `files`. */
export async function recompute(agentDir: string, rel: string, recorded: string): Promise<string> {
	const path = join(agentDir, rel);
	try {
		if (recorded.startsWith("symlink:")) return `symlink:${await readlink(path)}`;
		return createHash("sha256").update(await readFile(path)).digest("hex");
	} catch {
		return "missing";
	}
}

export async function readRendered(agentDir: string): Promise<Rendered> {
	return JSON.parse(await readFile(join(agentDir, "rendered.json"), "utf8")) as Rendered;
}

/**
 * The work tree, post-hydration: `<assetsRoot>/<kind>/<name>/…`. `read` is
 * what `sections` concatenates through; `asset.json` is identity, never
 * content (01 §5), so it is never read as one.
 */
export function workTree(assetsRoot: string) {
	const files = (kind: string, name: string): string[] => {
		try {
			return readdirSync(join(assetsRoot, kind, name), { withFileTypes: true })
				.filter((entry) => !entry.isDirectory() && entry.name !== "asset.json")
				.map((entry) => entry.name)
				.sort();
		} catch {
			return [];
		}
	};
	return {
		files,
		dir: (kind: string, name: string) => join(assetsRoot, kind, name),
		read: (asset: ComposedAsset): string =>
			files(asset.kind, asset.name)
				.map((file) => readFileSync(join(assetsRoot, asset.kind, asset.name, file), "utf8").trimEnd())
				.join("\n\n"),
	};
}

/** The tool index both providers append: every loaded tool, by absolute path,
    because the agent runs it from the work tree and nothing copies it. */
/** The first non-empty line of `<assetsRoot>/context/<name>/CONTEXT.md`, if any. */
export function contextAbout(assetsRoot: string, name: string): string | undefined {
	return firstLineOf(join(assetsRoot, "context", name, "CONTEXT.md"));
}

/** The first non-empty, non-heading line of a marker file, or nothing. */
export function firstLineOf(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8").split("\n").map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("#"));
	} catch {
		return undefined;
	}
}

export function hasFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/** 07 §6 `context`: templates and references the assistant reads when a task
    calls for them — never injected. One line per asset: its name, its path,
    and the first line of its `CONTEXT.md` when it has one (D30k). */
export function contextIndex(assetsRoot: string, contexts: ComposedAsset[], firstLine: (name: string) => string | undefined): string {
	if (contexts.length === 0) return "";
	const rows = [...contexts]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((one) => {
			const about = firstLine(one.name);
			return `- \`${one.name}\` — \`${join(assetsRoot, "context", one.name)}/\`${about ? ` — ${about}` : ""}`;
		});
	return `## Context\n\nRead when a task calls for it; nothing here is loaded on its own.\n\n${rows.join("\n")}`;
}

/** The manifests an environment asset can carry, and the one command that applies each
    inside the session — through the fence, in the harness's own environment (D30m). */
const MANIFESTS: Array<[file: string, apply: (dir: string) => string]> = [
	["requirements.txt", (dir) => `pip install -r ${join(dir, "requirements.txt")}`],
	["pyproject.toml", (dir) => `pip install ${dir}`],
	["package.json", (dir) => `npm install -g ${dir}`],
	["Gemfile", (dir) => `BUNDLE_GEMFILE=${join(dir, "Gemfile")} bundle install`],
	["go.mod", (dir) => `go install ${dir}/...`],
];

/** 07 §6 `environment`: what a harness declares its environment holds — one line
    per asset with the command that applies each manifest it carries (D30m). */
export function environmentIndex(assetsRoot: string, environments: ComposedAsset[], has: (name: string, file: string) => boolean, firstLine: (name: string) => string | undefined): string {
	if (environments.length === 0) return "";
	const rows = [...environments]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((one) => {
			const dir = join(assetsRoot, "environment", one.name);
			const about = firstLine(one.name);
			const applies = MANIFESTS.filter(([file]) => has(one.name, file)).map(([, apply]) => `\`${apply(dir)}\``);
			return `- \`${one.name}\`${about ? ` — ${about}` : ""}${applies.length > 0 ? ` — apply with ${applies.join(", ")}` : ""}`;
		});
	return `## Environment\n\nWhat this harness declares its environment holds. Apply what is missing, inside this session; record what you add.\n\n${rows.join("\n")}`;
}

export function toolIndex(assetsRoot: string, tools: ComposedAsset[]): string {
	if (tools.length === 0) return "";
	const rows = [...tools]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((tool) => `- \`${tool.name}\` — run \`${join(assetsRoot, "tool", tool.name, "run")}\``);
	return `## Tools\n\n${rows.join("\n")}`;
}

/** The advisory deny layer both providers render from the plan's geometry —
    so the model reads a refusal instead of a mystery (07 §8). The control is
    the sandbox (06); these strings never widen it. */
export function denyPatterns(plan: SpawnPlan): string[] {
	// A file in `denyWrite` is denied as itself; a directory as everything under it.
	// `Edit(…)` covers every file-editing tool (Claude Code 2.1.286 says so, and
	// warned on every start that a `Write(…)` rule is matched by nothing).
	const pattern = (verb: string, path: string) => (extname(path) ? `${verb}(${path})` : `${verb}(${path}/**)`);
	return [
		...new Set([
			...plan.filesystem.denyWrite.map((path) => pattern("Edit", path)),
			...plan.filesystem.denyRead.map((dir) => `Read(${dir}/**)`),
		]),
	].sort();
}

/**
 * W6-D153 — the plan's command boundaries as Claude Code `permissions.deny`
 * rules, written into the session's `settings.json` beside the file denies.
 *
 * Claude Code's half of interception, and **only** the patterns its own
 * matcher can hold (`claudeHolds`). A pattern with a shell operator in it
 * matches no subcommand of any command line and was measured to refuse
 * nothing on 2.1.286 (07 §8's table), so writing `Bash(curl * | sh)` here
 * would be a claim with nothing behind it. Pi intercepts those alone and the
 * console row reads *intercepted by Pi*.
 *
 * It is not `denyPatterns`, which both adapters share: Pi's `policy.json`
 * takes that list as the sentence its extension says, in Pi's vocabulary, and
 * `Bash(…)` is Claude's.
 */
export function commandDenyRules(plan: SpawnPlan): string[] {
	return [...new Set(plan.commands.filter((one) => claudeHolds(one.pattern)).map((one) => `Bash(${one.pattern})`))].sort();
}
