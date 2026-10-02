import type { Imported } from "@harness/compose/contracts";
import { importSetup } from "../import-common.js";

/** The acquisition test (D30c): what a person built before they had us runs,
    unchanged where it can, under Pi — `imported_claude_harness_runs_on_pi`. */
export function importClaude(source: { dir: string; workspace?: string }): Promise<Imported> {
	return importSetup(
		{
			provider: "Claude Code",
			instructions: ["CLAUDE.md"],
			workspaceInstructions: ["CLAUDE.md", ".claude/CLAUDE.md"],
			prompts: "commands",
			skills: "skills",
			settings: "settings.json",
			mcp: ".mcp.json",
		},
		source,
	);
}
