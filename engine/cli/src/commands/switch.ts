import type { Composed, HarnessDef } from "@harness/compose/contracts";
import { renderIcon } from "../pixels.js";
import { accent, bold, colorMode, dim } from "../style.js";
import { refuse, say } from "../output.js";
import { writeSelection } from "../selection.js";

/**
 * §11.2. Name matching is 03 §5.2 step 4's function, so `switch` and
 * `run --<harness>` cannot disagree: ambiguity lists the qualified forms, no
 * match lists what exists. `--none` deletes the file.
 */
export async function switchHarness(composed: Composed, wanted: string | undefined, team: boolean, none: boolean): Promise<number> {
	if (none) {
		await writeSelection(undefined);
		say("Cleared. Sessions will load everything you have.");
		return 0;
	}
	if (wanted === undefined) {
		for (const one of composed.harnesses) say(`  ${one.name}  ${dim(one.id)}`);
		refuse("preflight.harness_unknown", "Say which harness to switch to.", `harness switch ${composed.harnesses[0]?.name ?? "<name>"}`);
	}
	const matched = composed.harnesses.filter((one) => one.name.toLowerCase() === wanted.toLowerCase() || one.id === wanted);
	if (matched.length === 0) {
		refuse("preflight.harness_unknown", `No harness called \`${wanted}\`. You have: ${composed.harnesses.map((one) => one.name).join(", ") || "none"}.`, "harness switch");
	}
	if (matched.length > 1) {
		refuse("preflight.harness_ambiguous", `\`${wanted}\` names more than one harness: ${matched.map((one) => `${one.name} (${one.id})`).join(", ")}.`, `harness switch ${matched[0].id}`);
	}
	const chosen = matched[0];
	// D102: `switch` persists the version; `run --team` never writes the selection.
	await writeSelection({ harness_id: chosen.id, name: chosen.name, version: team ? "team" : "mine" });
	for (const line of card(chosen)) say(line);
	say(team ? "`harness run` to start on the team version — anything you change still lands on your version." : "`harness run` to start");
	return 0;
}

/** The drawing on the left, what it is on the right. */
function card(harness: HarnessDef): string[] {
	const drawing = renderIcon(harness.icon, colorMode());
	const text = [bold(accent(harness.name)), dim(harness.id), "", harness.description];
	const blank = " ".repeat(harness.icon.rows[0]?.length ?? 16);
	return Array.from({ length: Math.max(drawing.length, text.length) }, (_row, at) => `  ${drawing[at] ?? blank}  ${text[at] ?? ""}`.trimEnd());
}
