import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Blocker, Rehydrated, RenderContext } from "@harness/compose/contracts";
import { readRendered, recompute } from "../layout.js";

interface Settings {
	hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
	permissions?: { deny?: string[] };
}

export async function rehydrate(ctx: RenderContext): Promise<Rehydrated> {
	const rendered = await readRendered(ctx.agentDir).catch(() => null);
	if (!rendered) {
		throw {
			code: "adapter.rendered_missing",
			message: "The session directory was altered before launch.",
			remedy: "Re-run the command.",
		} satisfies Blocker;
	}
	// `Rehydrated` carries hashes, and 03 §5.8 leaves `files`/`links` to this
	// comparison (preflight/drift.ts), so the mismatch is raised here — a hand
	// edit and a retargeted link both name the file they happened to.
	const files: Record<string, string> = {};
	for (const [rel, recorded] of Object.entries(rendered.files)) {
		files[rel] = await recompute(ctx.agentDir, rel, recorded);
		if (files[rel] === recorded) continue;
		throw {
			code: "preflight.drift",
			message: `${rel} changed after render.`,
			remedy: "Re-run the command.",
		} satisfies Blocker;
	}
	let settings: Settings = {};
	try {
		settings = JSON.parse(await readFile(join(ctx.agentDir, "settings.json"), "utf8")) as Settings;
	} catch {
		// A missing settings file shows up as a `files` hash of `missing`.
	}
	return {
		skills: rendered.concerns.skill,
		prompts: rendered.concerns.prompt,
		instructions: { system_prompt: rendered.concerns.system_prompt, memory: rendered.concerns.memory },
		// Claude Code takes its endpoint from the environment, which is not on
		// disk; `rendered.json` is the record of what launch will set (D92).
		model: rendered.model,
		hooks: Object.values(settings.hooks ?? {}).flatMap((entries) =>
			entries.flatMap((entry) => (entry.hooks ?? []).map((one) => one.command ?? "")),
		),
		denies: settings.permissions?.deny ?? [],
		files,
	};
}
