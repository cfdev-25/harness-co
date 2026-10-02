// console 05 D50: the sheet crosses to the web as data, not as an import.
import { writeFileSync } from "node:fs";
import { COMMAND_SHEET, GIT_INVOCATION } from "../dist/commands/sheet.js";

writeFileSync(
	new URL("../dist/sheet.json", import.meta.url),
	`${JSON.stringify({ groups: COMMAND_SHEET, git: GIT_INVOCATION }, null, 2)}\n`,
);
