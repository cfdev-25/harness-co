import { api } from "./api.js";
import {
	assetsRoot,
	credentialsPath,
	harnessHome,
	inHarness,
	type Manifest,
	type ManifestAsset,
	readCredentials,
} from "./core.js";
import { childEnvironment } from "./env.js";
import { differs, ensureRepo, g, worktreeTree } from "./git.js";
import { harnessCard, resolveForSession } from "./harness.js";
import { absent, bad, bold, dim, good, heading, row, warn } from "./style.js";

/**
 * What did the server actually send me, and what would the agent actually get?
 * Everything here is readable by definition — secret *values* never leave the
 * server, so there is nothing to redact. References and variable names are
 * shown; the login token is not.
 */

const SECTIONS = ["identity", "harness", "boundary", "model", "assets", "local", "env"] as const;
type Section = (typeof SECTIONS)[number];

// Until the proxy and sandbox land, every boundary field is delivered but not
// enforced. Saying so on every line is the difference between describing a
// boundary and claiming one.
const ENFORCED: Record<string, string> = {};
const ADVISORY = new Set(["approvals.deploy", "build_policy.push_review", "load_policy.default"]);

interface Me {
	email?: string;
	org_unit_path?: string;
	role?: string;
	role_unit?: string | null;
	units?: Array<{ role: string; name: string }>;
}

function status(field: string): string {
	if (ENFORCED[field]) return good("enforced");
	if (ADVISORY.has(field)) return warn("advisory");
	return dim("not enforced yet");
}

function flatten(value: unknown, prefix = ""): string[] {
	// null is "nobody set a policy"; [] is "a policy was set and permits
	// nothing". Collapsing them would hide why enforcement will behave as it
	// does — see merge_boundaries.
	if (value === null || value === undefined) {
		return [row(prefix, absent("not set — unrestricted"), status(prefix))];
	}
	if (Array.isArray(value)) {
		const shown = value.length ? value.join(", ") : bad("none permitted");
		return [row(prefix, shown, status(prefix))];
	}
	if (typeof value === "object") {
		return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) =>
			flatten(inner, prefix ? `${prefix}.${key}` : key),
		);
	}
	return [row(prefix, String(value), status(prefix))];
}

function freshness(manifest: Manifest & { issued_at?: string; ttl_seconds?: number }): string {
	if (!manifest.issued_at) return "";
	const age = Math.round((Date.now() - Date.parse(manifest.issued_at)) / 1000);
	const ttl = manifest.ttl_seconds;
	const stale = ttl !== undefined && age > ttl;
	return `resolved ${age}s ago${ttl === undefined ? "" : `, ttl ${ttl}s`}${stale ? " — STALE" : ""}`;
}

function identity(me: Me, apiUrl: string): string[] {
	const chain = (me.units ?? []).filter((unit) => unit.role !== "user").map((unit) => unit.name);
	return [
		`  ${[...chain, me.email ?? "unknown email"].join(dim("  ›  "))}`,
		row("role", me.role === "user" ? dim("user") : bold(me.role ?? "user"), me.role_unit ? `at ${me.role_unit}` : ""),
		row("api", apiUrl),
		row("unit path", me.org_unit_path ?? absent("none")),
		row("credentials", credentialsPath()),
	];
}

function harness(manifest: Manifest): string[] {
	if (manifest.harness) {
		const held = manifest.harness.assets?.length ?? 0;
		return [
			...harnessCard(manifest.harness),
			row("contains", held === 0 ? bad("nothing yet") : `${held} name${held === 1 ? "" : "s"}`),
		];
	}
	const available = manifest.harnesses ?? [];
	return [
		`  ${absent("none selected — everything you have is loaded")}`,
		available.length
			? row("available", available.map((item) => item.name).join(", "), "`harness switch`")
			: row("available", absent("none created yet")),
	];
}

function model(manifest: Manifest): string[] {
	if (!manifest.model) return [`  ${bad("not configured")} ${dim("— `harness run` will fail")}`];
	const { provider, model_id, base_url, key_ref, env_var } = manifest.model;
	return [
		row("provider", provider),
		row("model", model_id),
		row("base url", base_url),
		row("key reference", key_ref),
		// The variable's name, never its value: values are delivered at spawn
		// and written nowhere we can read.
		row("key delivered as", env_var),
	];
}

function membership(item: ManifestAsset, manifest: Manifest): string {
	if (!manifest.harness) return "";
	return inHarness(item, manifest.harness) ? "" : dim("  not in this harness");
}

function assets(manifest: Manifest, ownPath?: string): string[] {
	const items = manifest.assets ?? [];
	if (items.length === 0) return [`  ${absent("none delivered")}`];
	// Grouped by kind, because that is how you think about them: "which skills
	// do I have" is a question, "asset number four" is not.
	const kinds = [...new Set(items.map((item) => item.kind))].sort();
	return kinds.flatMap((kind) => {
		const group = items.filter((item) => item.kind === kind);
		return [
			`  ${bold(`${kind}s`)} ${dim(`(${group.length})`)}`,
			...group.map((item) => {
				const seq = item.version_seq === undefined ? "" : ` v${item.version_seq}`;
				const files = ` · ${item.files.length} file(s)`;
				const over = item.shadows ? warn(` overrides ${item.shadows.org_unit_path} v${item.shadows.seq}`) : "";
				// Whether this is the team's or something the user added themselves.
				const from = item.org_unit_path === ownPath ? bold("yours") : dim(`from ${item.org_unit_path ?? "?"}`);
				return `    ${item.name.padEnd(22)}${`${seq}${files}`.padEnd(20)}${from}${over}${membership(item, manifest)}`;
			}),
		];
	});
}

async function local(): Promise<string[]> {
	await ensureRepo();
	const remote = await g("rev-parse", "--verify", "--quiet", "refs/harness/remote^{commit}").catch(() => undefined);
	const rows = [row("work tree", assetsRoot()), row("history", `${harnessHome()}/assets.git`)];
	if (!remote) return [...rows, `  ${absent("nothing delivered yet — run `harness run`")}`];
	const versions = await g("show", `${remote}:versions.json`)
		.then((text) => JSON.parse(text) as Record<string, unknown>)
		.catch(() => ({}));
	const keys = Object.keys(versions).sort();
	if (keys.length === 0) return [...rows, `  ${absent("nothing delivered yet")}`];
	const work = await worktreeTree();
	for (const key of keys) {
		const changed = await differs(work, remote, key);
		rows.push(`  ${key.padEnd(34)}${changed ? warn("modified") : good("clean")}`);
	}
	return rows;
}

function environment(): string[] {
	const env = childEnvironment({ sessionId: "<session>", sessionDir: "<session dir>", adapterEnv: {} });
	const watched = ["HARNESS_API_TOKEN", "AWS_SECRET_ACCESS_KEY", "GITHUB_TOKEN", "NPM_TOKEN", "OPENAI_API_KEY"];
	const leaked = watched.filter((key) => key in env);
	return [
		row("passed to the agent", Object.keys(env).sort().join(", ")),
		row(
			"withheld",
			leaked.length === 0 ? good("every credential in your shell") : bad(`LEAKED: ${leaked.join(", ")}`),
		),
	];
}

export async function doctor(args: string[]): Promise<number> {
	const wanted = args.filter((arg) => !arg.startsWith("-"));
	const unknown = wanted.filter((name) => !SECTIONS.includes(name as Section));
	if (unknown.length) {
		console.error(`Unknown section: ${unknown.join(", ")}. Pick from: ${SECTIONS.join(", ")}`);
		return 1;
	}
	const show = (name: Section) => wanted.length === 0 || wanted.includes(name);

	const credentials = await readCredentials();
	const [me, manifest] = await Promise.all([api<Me>(credentials, "/v1/me"), resolveForSession(credentials)]);

	if (args.includes("--json")) {
		console.log(JSON.stringify({ me, manifest }, null, 2));
		return 0;
	}

	const blocks: Array<[Section, string, string, string[]]> = [
		["identity", "IDENTITY", "", identity(me, credentials.api_url)],
		["harness", "HARNESS", "what this session loads", harness(manifest)],
		["boundary", "BOUNDARY", `merged down the org tree · ${freshness(manifest)}`, flatten(manifest.boundary)],
		["model", "MODEL", "", model(manifest)],
		["assets", "ASSETS", freshness(manifest), assets(manifest, me.org_unit_path)],
		["local", "LOCAL", "", await local()],
		["env", "AGENT ENVIRONMENT", "what the child process receives", environment()],
	];
	for (const [name, title, aside, lines] of blocks) {
		if (!show(name)) continue;
		console.log(heading(title, aside));
		console.log(lines.join("\n"));
	}
	if (show("boundary")) {
		console.log(
			dim(
				"\n  Egress, connectors, and budgets are not enforced yet: the proxy is not built. " +
					"`allowed_tools` naming a team tool is enforced by denying its read on macOS " +
					"(src/enforcers/filesystem.ts, agents.md §7.1.1); naming a built-in is still advisory " +
					"only (§7.1.2).",
			),
		);
	}
	console.log("");
	return 0;
}
