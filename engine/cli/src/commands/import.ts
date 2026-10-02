import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { adapters } from "../adapters/registry.js";
import { refuse, say, table } from "../output.js";
import { assetsRoot, harnessHome } from "../selection.js";

const DEFAULT_SOURCE: Record<string, string> = { claude: ".claude", pi: ".pi" };

/**
 * §11.19 / 07 §4a — the acquisition test. What a person built before they had
 * us becomes assets and a harness on their own branch. Nothing is pushed: the
 * exit review or `push` does that. Exit 0 even when things were dropped — the
 * table is the answer — and 1 only when nothing at all could be read.
 */
export async function importSetup(provider: string, from: string | undefined, workspace: string | undefined): Promise<number> {
	const adapter = adapters[provider];
	// §11.19's last paragraph: a word with no importer is not a typo to correct
	// but a remit to hand over — the built-in `harness-authoring` skill (D30j)
	// extracts the setups no adapter reads.
	if (adapter === undefined) {
		refuse(
			"cli.import_unknown_provider",
			`No importer for ${provider}. Harness reads Claude Code and Pi setups itself; for anything else the assistant can do it.`,
			`\`harness run pi\`, then: Extract my ${provider} setup into this harness.`,
		);
	}
	const dir = from === undefined ? join(homedir(), DEFAULT_SOURCE[adapter.id] ?? `.${adapter.id}`) : resolve(from);
	const imported = await adapter.import({ dir, workspace: workspace === undefined ? process.cwd() : resolve(workspace) });
	if (imported.assets.length === 0 && imported.harness.assets.length === 0) {
		refuse("adapter.import_empty", `Nothing could be read from ${dir}.`, `Check the path, or pass \`--from <dir>\`.`);
	}

	// Import writes to the work tree only, with the fresh sidecars the adapter
	// minted (D3); the harness definition lands beside them, unpushed.
	for (const asset of imported.assets) {
		const target = join(assetsRoot(), asset.kind, asset.name);
		await mkdir(join(assetsRoot(), asset.kind), { recursive: true, mode: 0o700 });
		if (resolve(asset.path) !== target) await rename(asset.path, target).catch(() => undefined);
	}
	await mkdir(join(harnessHome(), "harnesses"), { recursive: true, mode: 0o700 });
	await writeFile(join(harnessHome(), "harnesses", `${imported.harness.id}.json`), `${JSON.stringify(imported.harness, null, 2)}\n`, { mode: 0o600 });

	const rows: string[][] = [["", "what", "from"]];
	for (const asset of imported.assets) rows.push(["carried", `${asset.kind}/${asset.name}`, asset.from]);
	for (const boundary of imported.boundaries) rows.push(["partial", `${boundary.kind} ${boundary.value}`, boundary.reason]);
	for (const dropped of imported.dropped) rows.push(["dropped", dropped.what, `${dropped.from} — ${dropped.why}`]);
	for (const line of table(rows)) say(line);
	say("");
	say(`\`harness switch ${imported.harness.name}\` then \`harness run ${adapter.id} --${imported.harness.name}\``);
	return 0;
}
