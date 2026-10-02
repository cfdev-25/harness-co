import type { PreflightReport } from "@harness/compose/contracts";
import { renderReport as render } from "./preflight/report.js";
import { blocker, say } from "./output.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping the escapes style.ts writes
const ANSI = /\x1b\[[\d;]*m/g;

/** A section heading from `style.ts`: an unindented lowercase name, then an
    optional aside two or more spaces along (`identity  <sessionId>`). */
const HEADING = /^([a-z][a-z ]*?)(?:\s{2,}\S.*)?$/;

/**
 * §11.13. The rendered view and `--json` are the same object
 * (`preflight_matches_json`): this chooses between them and narrows to the
 * named sections; 03 §5.10 owns every word of the rendering itself.
 */
export function renderReport(report: PreflightReport, argv: { json?: boolean; sections?: string[] }): void {
	if (argv.json === true) {
		// §12 rule 4: the object and nothing else.
		say(JSON.stringify(report, null, 2));
		return;
	}
	// A boot that failed before Choose has no `Choices`, and 03's renderer reads
	// them unconditionally. The blockers are the whole answer in that case (S8).
	if (report.choices === null) {
		for (const one of report.blockers) blocker(one);
		for (const slot of report.slots) if (slot.blocker !== undefined) blocker(slot.blocker);
		return;
	}
	const text = render(report);
	const wanted = argv.sections ?? [];
	if (wanted.length === 0) {
		say(text);
		return;
	}
	// A section is its heading plus the rows under it, up to the next heading.
	const out: string[] = [];
	let keeping = false;
	for (const line of text.split("\n")) {
		const plain = line.replace(ANSI, "");
		if (plain.trim() !== "" && !plain.startsWith(" ")) {
			const heading = HEADING.exec(plain);
			keeping = heading !== null && wanted.includes(heading[1].trim());
		}
		if (keeping) out.push(line);
	}
	say(out.join("\n"));
}
