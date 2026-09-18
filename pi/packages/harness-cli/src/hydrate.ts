import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assetsRoot, type Manifest, type ManifestAsset, type Shadowed, safeName, safeRelative } from "./core.js";
import { differs, ensureRepo, g, gAt, withIndex, worktreeTree } from "./git.js";

const REMOTE = "refs/harness/remote";
const VERSIONS = "versions.json";

/** What the server delivered, recorded alongside the files it delivered. */
export interface DeliveredVersion {
	asset_id?: string;
	version_id?: string;
	seq?: number;
	shadows?: Shadowed | null;
}

type Versions = Record<string, DeliveredVersion>;

/** Every asset the manifest delivered, keyed `<kind>/<name>`. */
function delivered(manifest: Manifest): Map<string, ManifestAsset> {
	const out = new Map<string, ManifestAsset>();
	for (const asset of manifest.assets ?? []) {
		if (!asset.files) continue;
		out.set(`${asset.kind}/${safeName(asset.name)}`, asset);
	}
	return out;
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}

async function revision(ref: string): Promise<string | undefined> {
	return g("rev-parse", "--verify", "--quiet", `${ref}^{commit}`).catch(() => undefined);
}

async function readVersions(commit: string | undefined): Promise<Versions> {
	if (!commit) return {};
	return g("show", `${commit}:${VERSIONS}`)
		.then((text) => JSON.parse(text) as Versions)
		.catch(() => ({}));
}

/** Commits the delivered tree into the object store without touching the work tree. */
async function buildIncoming(assets: Map<string, ManifestAsset>): Promise<string> {
	const scratch = await mkdtemp(join(tmpdir(), "harness-incoming-"));
	try {
		const versions: Versions = {};
		for (const [key, asset] of assets) {
			versions[key] = {
				asset_id: asset.asset_id,
				version_id: asset.version_id,
				seq: asset.version_seq,
				shadows: asset.shadows ?? null,
			};
			for (const file of asset.files) {
				const target = join(scratch, key, safeRelative(file.path));
				await mkdir(dirname(target), { recursive: true });
				await writeFile(target, Buffer.from(file.content_b64, "base64"));
			}
		}
		await writeFile(join(scratch, VERSIONS), `${JSON.stringify(versions, null, 2)}\n`);
		const index = join(scratch, ".harness-index");
		await withIndex(index, () => gAt(scratch, "add", "--all", "--force", "--", "."));
		const tree = await withIndex(index, () => gAt(scratch, "write-tree"));
		return await g("commit-tree", tree, "-m", "hydrate");
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/** Replaces one asset directory with the delivered copy. */
async function take(incoming: string, key: string): Promise<void> {
	const scratch = await mkdtemp(join(tmpdir(), "harness-co-"));
	try {
		await rm(join(assetsRoot(), key), { recursive: true, force: true });
		await withIndex(join(scratch, "index"), () => g("checkout", incoming, "--", key));
		// A tool is "a directory containing an executable named run", and the
		// delivered bytes carry no mode, so the convention is restored here.
		await chmod(join(assetsRoot(), key, "run"), 0o755).catch(() => undefined);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/**
 * Brings the work tree up to date with what the server delivered, without ever
 * writing over a path the user changed. See docs/asset-sync.md §4; the row
 * numbers in the comments below are that table's.
 */
export async function hydrate(manifest: Manifest, notify: (message: string) => void): Promise<void> {
	await ensureRepo();
	const assets = delivered(manifest);
	const incoming = await buildIncoming(assets);
	const work = await worktreeTree();
	const remote = await revision(REMOTE);

	const previous = await readVersions(remote);
	const keys = new Set([...assets.keys(), ...Object.keys(previous)]);

	for (const key of [...keys].sort()) {
		const asset = assets.get(key);
		const seq = asset?.version_seq;

		// Row 1: the user already has exactly what was delivered. Converges an
		// adopted directory or a push that has just been approved.
		if (!(await differs(work, incoming, key))) continue;

		if (!remote) {
			// Rows 2 / 2b: first hydration, so there is no base to compare to.
			if (await exists(join(assetsRoot(), key))) {
				notify(
					`${key} exists locally but was never delivered. \`harness push\` to keep yours, \`harness reset ${key}\` to take the team's.`,
				);
			} else {
				await take(incoming, key);
			}
			continue;
		}

		const localChanged = await differs(work, remote, key);
		const teamChanged = await differs(remote, incoming, key);

		if (!localChanged) {
			// Row 3: the only row that writes, and only where the work tree still
			// matches the previous delivery.
			if (asset) {
				await take(incoming, key);
				notify(`Updated ${key}${seq === undefined ? "" : ` to v${seq}`}.`);
			} else {
				await rm(join(assetsRoot(), key), { recursive: true, force: true });
				notify(`${key} is no longer provided by your team.`);
			}
			continue;
		}

		if (!teamChanged) continue; // Row 4: local edits, team unchanged.

		// Row 5: both moved. Surfaced, never resolved for them.
		notify(
			asset
				? `${key}: you changed it and the team changed it. \`harness push\` keeps yours, \`harness reset ${key}\` takes theirs.`
				: `${key} is no longer provided by your team; your local copy is kept.`,
		);
	}

	await g("update-ref", REMOTE, incoming);

	// A personal override shadows the team's asset indefinitely, so say so when
	// the version behind the override moves.
	for (const [key, asset] of assets) {
		const now = asset.shadows;
		const before = previous[key]?.shadows;
		if (now && before && now.version_id !== before.version_id) {
			notify(
				`The team's ${key} advanced to v${now.seq} but your personal override is in effect. \`harness reset ${key}\` to take theirs.`,
			);
		}
	}
}
