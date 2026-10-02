import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMAND_SHEET } from "@/content/commands.generated";
import { NAV_LABELS } from "@/app/(console)/shell/nav";

/**
 * V1 for `docs/guide/*.md` (the task's own spec): the guides drift-checked
 * against the two things they promise to match — the command sheet (05 §6)
 * and the sidebar's screen names (`shell/nav.ts` — `web/content/shell.ts`
 * turned out to hold only the `?as` banner strings, not nav labels; `NAV_LABELS`
 * in `app/(console)/shell/nav.ts` is where "the navigation's own nouns" (its
 * own comment) actually live, so this test reads from there instead).
 */

const GUIDES_DIR = fileURLToPath(new URL("../../../docs/guide", import.meta.url));

function guideFiles(): string[] {
  return readdirSync(GUIDES_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(GUIDES_DIR, name));
}

/** Fenced blocks hold printed output and prompts, never a command the reader
 *  types — the three `new` landing lines, an `import` summary, the exit
 *  review's question. Stripped before either scan below. */
function stripFencedBlocks(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "");
}

function inlineCodeSpans(markdown: string): string[] {
  const spans: string[] = [];
  const re = /`([^`\n]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripFencedBlocks(markdown))) !== null) spans.push(match[1]);
  return spans;
}

function boldPhrases(markdown: string): string[] {
  const phrases: string[] = [];
  const re = /\*\*([^*\n]+)\*\*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripFencedBlocks(markdown))) !== null) phrases.push(match[1]);
  return phrases;
}

const SHEET_RUNS = new Set(COMMAND_SHEET.flatMap((group) => group.rows.map((row) => row.run)));

/**
 * Bare verbs the guides may name with no argument, alongside the sheet's own
 * rows. Every sheet row for `switch`/`run`/`pull`/`status`/`login`/`whoami`/
 * `auth` either carries a fixture argument (`campaign-drafts`, `pi`) the
 * guides have no reason to repeat as if it were the one true name, or (for
 * `pull`/`status`/`whoami`) is already bare in the sheet — this list exists
 * so a guide's generic sentence ("switch to it, then run it") is not forced
 * to either invent a fixture-shaped argument or fail the check.
 */
const BARE_VERB_ALLOWLIST = new Set([
  "harness login",
  "harness whoami",
  "harness auth claude",
  "harness run pi",
  "harness run claude",
  "harness switch",
  "harness pull",
  "harness status",
]);

const files = guideFiles();

describe("docs/guide/*.md — commands match the command sheet (05 §6, D50)", () => {
  it("finds the two guides", () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  const commands = files.flatMap((file) =>
    inlineCodeSpans(readFileSync(file, "utf8"))
      .filter((span) => span.startsWith("harness "))
      .map((command) => ({ file, command })),
  );

  it("has at least one `harness …` command to check (sanity)", () => {
    expect(commands.length).toBeGreaterThan(5);
  });

  it("backticks only a sheet row's `run`, or an allowlisted bare verb", () => {
    const failing = commands.filter(({ command }) => !SHEET_RUNS.has(command) && !BARE_VERB_ALLOWLIST.has(command));
    // Expected, for now: the CLI's "Set up" group (engine 08 §11.17,
    // §11.20-11.22) is already in `engine/cli/src/commands/sheet.ts` but has
    // not yet been copied into `web/content/commands.generated.ts` (D50's
    // web-build copy step) — checked directly, absent at the time of
    // writing. Its six rows are exactly the commands this guide names for
    // "See what is left to set up", "Turn a runtime on" and "Connect a model
    // key", so they fail here until that copy lands. Reported to the caller
    // verbatim rather than added to the allowlist above, which exists for
    // bare verbs with no fixture argument, not for rows still missing.
    expect(failing, JSON.stringify(failing, null, 2)).toEqual([]);
  });
});

describe("docs/guide/*.md — bold screen names match the sidebar (shell/nav.ts)", () => {
  const navLower = new Map(Object.values(NAV_LABELS).map((label) => [label.toLowerCase(), label]));

  const bolds = files.flatMap((file) => boldPhrases(readFileSync(file, "utf8")).map((phrase) => ({ file, phrase })));
  const screenBolds = bolds.filter(({ phrase }) => navLower.has(phrase.toLowerCase()));

  it("bolds at least 3 screen names (sanity — this check cannot pass vacuously)", () => {
    expect(screenBolds.length).toBeGreaterThanOrEqual(3);
  });

  it("every bold phrase that names a screen matches the sidebar's exact case", () => {
    for (const { phrase } of screenBolds) {
      expect(phrase).toBe(navLower.get(phrase.toLowerCase()));
    }
  });
});

describe("docs/guide/*.md — group/grant/routing stay out of Connect a model key (04 §10)", () => {
  it("never names them between that heading and the next", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const start = text.indexOf("Connect a model key");
      if (start === -1) continue; // not every guide has this step
      const rest = text.slice(start);
      const nextHeading = rest.search(/\n#{1,6}\s/);
      const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
      expect(/\b(groups?|grants?|routing)\b/i.test(section), `${file}:\n${section}`).toBe(false);
    }
  });
});
