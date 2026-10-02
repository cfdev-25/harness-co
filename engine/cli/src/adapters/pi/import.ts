import type { Imported } from "@harness/compose/contracts";
import { importSetup } from "../import-common.js";

/** `~/.pi/agent/{AGENTS.md,prompts,skills,settings.json}`, by the same table
    as Claude Code's (07 §4a). The table is shared; only these names differ. */
export function importPi(source: { dir: string; workspace?: string }): Promise<Imported> {
	return importSetup(
		{ provider: "Pi", instructions: ["AGENTS.md"], prompts: "prompts", skills: "skills", settings: "settings.json" },
		source,
	);
}
