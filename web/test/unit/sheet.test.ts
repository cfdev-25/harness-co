import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOURCE, TARGET, render } from "../../scripts/sheet.mjs";

/** 05 §6 `sheet_matches_cli` (V1): the checked-in copy is exactly what the
 *  CLI's build emits. Needs `npm run build -w engine/cli` first. */
describe("command sheet", () => {
  it.skipIf(!existsSync(fileURLToPath(SOURCE)))("sheet_matches_cli", () => {
    expect(readFileSync(TARGET, "utf8")).toBe(render(readFileSync(SOURCE, "utf8")));
  });
});
