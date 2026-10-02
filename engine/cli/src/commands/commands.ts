import { say } from "../output.js";
import { bold, dim } from "../style.js";
import { COMMAND_SHEET, GIT_INVOCATION } from "./sheet.js";

/** §11.17. The same headings and rows as the console's *Commands* modal. */
export function commands(): number {
	for (const group of COMMAND_SHEET) {
		say("");
		say(bold(group.group));
		for (const row of group.rows) {
			say(`  ${row.what}`);
			say(`    ${row.run}${row.note === undefined ? "" : dim(`  — ${row.note}`)}`);
		}
	}
	say("");
	say(dim(`  ${GIT_INVOCATION}`));
	return 0;
}
