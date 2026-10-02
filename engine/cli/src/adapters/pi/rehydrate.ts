import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Blocker, Rehydrated, RenderContext } from "@harness/compose/contracts";
import { readRendered, recompute } from "../layout.js";

const read = async <T>(path: string): Promise<T | null> => {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch {
		return null;
	}
};

/** Reads back what `render` wrote — the files' hashes, the links' targets and
    Pi's own JSON — so 03 can compare it to the plan. Markdown is never
    parsed: `rendered.json` says where one concern ends (D92). */
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
	const models = await read<{ providers?: Record<string, { baseUrl?: string; models?: Array<{ id: string }> }> }>(
		join(ctx.agentDir, "models.json"),
	);
	const harness = models?.providers?.harness;
	const policy = await read<{ denies?: string[] }>(join(ctx.agentDir, "policy.json"));
	return {
		skills: rendered.concerns.skill,
		prompts: rendered.concerns.prompt,
		instructions: { system_prompt: rendered.concerns.system_prompt, memory: rendered.concerns.memory },
		model: harness?.baseUrl ? { endpoint: harness.baseUrl, model: harness.models?.[0]?.id ?? "" } : null,
		// Pi's audit line comes from the extension's `tool_result`, not a hook
		// command, so there is no hook set on disk to read back.
		hooks: [],
		denies: policy?.denies ?? [],
		files,
	};
}
