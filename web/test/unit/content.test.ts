import { describe, expect, it } from "vitest";
import { SCALES, type ScaleId } from "@/content/scales";
import { WORDS } from "@/content/words";
import { ASKING_REFUSALS, REFUSALS, type Refusal } from "@/content/refusals";
import { EMPTY, HIDDEN } from "@/content/empty";
import { COMMAND_SHEET } from "@/content/commands.generated";
import * as harnesses from "@/content/screens/harnesses";
import * as harness from "@/content/screens/harness";
import * as file from "@/content/screens/file";
import * as requests from "@/content/screens/requests";
import * as groups from "@/content/screens/groups";
import * as boundaries from "@/content/screens/boundaries";
import * as providers from "@/content/screens/providers";
import * as vaults from "@/content/screens/vaults";
import * as assets from "@/content/screens/assets";
import * as sessions from "@/content/screens/sessions";
import * as logs from "@/content/screens/logs";
import * as people from "@/content/screens/people";
import * as account from "@/content/screens/account";
import * as how from "@/content/screens/how";

/**
 * V1 tests for `web/content/` (docs/console/05-in-platform-docs.md, per the
 * task's own spec) — the pure content source, no rendering.
 */

// Every `ScaleId` the type declares, used to prove `SCALES` is exhaustive
// without hand-typing the list a second time.
const SCALE_IDS = Object.keys(SCALES) as ScaleId[];

/** Recursively collects every string value reachable from `value`, so the
 *  denylist and "no exclamation marks" checks run over the whole content
 *  tree without re-listing every field by hand. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
  return out;
}

const ALL_CONTENT = {
  SCALES,
  WORDS,
  REFUSALS,
  EMPTY,
  HIDDEN,
  COMMAND_SHEET,
  harnesses: harnesses.HARNESSES,
  harness: harness.HARNESS,
  file: file.FILE,
  requests: requests.REQUESTS,
  groups: groups.GROUPS,
  boundaries: boundaries.BOUNDARIES,
  providers: providers.PROVIDERS,
  vaults: vaults.VAULTS,
  assets: assets.ASSETS,
  sessions: sessions.SESSIONS,
  logs: logs.LOGS,
  people: people.PEOPLE,
  account: account.ACCOUNT,
  how: how.HOW,
};

describe("scales.ts — the ScaleRegistry (05 §4, 00 §4.6)", () => {
  it("has an entry for every ScaleId with at least two values", () => {
    expect(SCALE_IDS.length).toBeGreaterThan(0);
    for (const id of SCALE_IDS) {
      expect(SCALES[id].values.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives every value a non-empty meaning ending in a full stop", () => {
    for (const id of SCALE_IDS) {
      for (const value of SCALES[id].values) {
        expect(value.meaning.length).toBeGreaterThan(0);
        expect(value.meaning.trim().endsWith(".")).toBe(true);
      }
    }
  });

  it("gives every scale an href matching /console/how#<scale>", () => {
    for (const id of SCALE_IDS) {
      expect(SCALES[id].href).toBe(`/console/how#${id}`);
    }
  });

  it("has thirty-five values across thirteen scales (see scales.ts's header comment on the '13/37' discrepancy)", () => {
    // W6-D6 added `providerStatus`, the thirteenth: the Model providers table's
    // *Reachable* column became a status whose values send a person to a
    // different place each.
    expect(SCALE_IDS.length).toBe(13);
    // W5-D10 split `loads` from two values into three (`required`,
    // `recommended`, `on-request`), which was the thirty-first. W7-D2 added
    // `providerStatus.sign-in`, the thirty-fifth: a keyless provider the
    // runtime logs into itself is not the same problem as one nobody holds a
    // key for, and it is not a problem at all.
    const total = SCALE_IDS.reduce((n, id) => n + SCALES[id].values.length, 0);
    expect(total).toBe(35);
  });
});

describe("words.ts — the vocabulary (05 §5)", () => {
  const ids = Object.keys(WORDS);

  it("has thirty-two words", () => {
    expect(ids.length).toBe(32);
  });

  it("gives every word a short and a more sentence, and a PRD or engine reference", () => {
    for (const id of ids) {
      const entry = WORDS[id as keyof typeof WORDS];
      expect(entry.short.trim().endsWith(".")).toBe(true);
      expect(entry.more.trim().endsWith(".")).toBe(true);
      expect(entry.prd.startsWith("§") || entry.prd.startsWith("engine ")).toBe(true);
    }
  });
});

describe("refusals.ts — Permission not cleared (05 §7, 04)", () => {
  const ids = Object.keys(REFUSALS);

  it("carries at least 05 §7's ten, and every id it names", () => {
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const id of ASKING_REFUSALS) {
      expect(Object.prototype.hasOwnProperty.call(REFUSALS, id), id).toBe(true);
    }
  });

  it("names a role word ('admin') in each of 05 §7's ten", () => {
    for (const id of ASKING_REFUSALS) {
      expect(REFUSALS[id].sentence.toLowerCase()).toMatch(/\badmin\b/);
    }
  });

  it("says who decides in every sentence, 05's and 04's alike", () => {
    for (const id of ids) {
      const entry = REFUSALS[id as keyof typeof REFUSALS];
      expect(entry.sentence.trim().endsWith("."), id).toBe(true);
      // Either a role decides it, or the sentence says nobody below can.
      expect(/admin|organisation|nobody/i.test(entry.sentence), id).toBe(true);
    }
  });

  it("writes every name it substitutes as a placeholder, never a fixture name", () => {
    for (const id of ids) {
      const entry: Refusal = REFUSALS[id as keyof typeof REFUSALS];
      const text = `${entry.sentence} ${entry.ask?.label ?? ""} ${entry.ask?.where ?? ""}`;
      for (const fixture of ["Marketing", "Rae Lindqvist", "Dana Okafor", "Jo Adeyemi"]) {
        expect(text.includes(fixture), `${id} names the fixture "${fixture}"`).toBe(false);
      }
    }
  });

  it("gives a non-empty ask.where wherever ask is set", () => {
    for (const id of ids) {
      const entry = REFUSALS[id as keyof typeof REFUSALS] as (typeof REFUSALS)[keyof typeof REFUSALS] & {
        ask?: { label: string; where: string };
      };
      if (entry.ask) {
        expect(entry.ask.label.length).toBeGreaterThan(0);
        expect(entry.ask.where.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("empty.ts — empty states and hidden views (05 §8)", () => {
  // 05 §8's table is the floor, not the ceiling: a screen with a scope or an
  // edition 05 did not write a row for adds a key here rather than keeping a
  // sentence of its own in `content/screens/`. So the assertion names the keys
  // the documents require and allows the set to grow (05 §8).
  const DOCUMENTED = [
    "harnesses.me", "harnesses.me.personal", "harnesses.team", "harness.files",
    "harness.requests", "harness.history", "requests.closed", "sessions",
    "session.endpoints", "groups.org", "groups.team", "groups.me", "grants",
    "boundaries.org", "boundaries.team", "boundaries.me", "providers",
    "providers.model", "vaults", "vault.secrets", "assets.org", "logs",
    "logs.scope", "endpoints", "people", "teams", "account.logins",
    "file.content", "how",
  ];

  it("defines at least every empty state 05 §8, 07 §2 and 04 name", () => {
    for (const id of DOCUMENTED) {
      expect(Object.prototype.hasOwnProperty.call(EMPTY, id), id).toBe(true);
    }
    expect(Object.keys(EMPTY).length).toBeGreaterThanOrEqual(DOCUMENTED.length);
  });

  it("gives every empty state a non-empty sentence", () => {
    for (const id of Object.keys(EMPTY)) {
      expect(EMPTY[id as keyof typeof EMPTY].sentence.length).toBeGreaterThan(0);
    }
  });

  it("has exactly the three Viewer.visibility-keyed hidden notes", () => {
    // W5-D15 adds `store`: an organisation may turn the Assets screen's
    // *Browse* tab off, and a closed view says so (P10).
    expect(Object.keys(HIDDEN).sort()).toEqual(["boundaries", "logs", "store"]);
    for (const key of Object.keys(HIDDEN)) {
      expect(HIDDEN[key as keyof typeof HIDDEN].length).toBeGreaterThan(0);
    }
  });
});

describe("commands.generated.ts — the command sheet (05 §6, engine 08 §11)", () => {
  it("has every row's what/run non-empty", () => {
    expect(COMMAND_SHEET.length).toBeGreaterThan(0);
    for (const group of COMMAND_SHEET) {
      expect(group.rows.length).toBeGreaterThan(0);
      for (const row of group.rows) {
        expect(row.what.length).toBeGreaterThan(0);
        expect(row.run.startsWith("harness ")).toBe(true);
      }
    }
  });

  // D50: the CLI's `commands/sheet.ts` does not exist yet in this checkout, so
  // there is nothing to diff against. This is the placeholder for
  // `sheet_matches_cli` (05 DoD) once it does.
  it.todo("matches engine/cli/src/commands/sheet.ts exactly (sheet_matches_cli, V1)");
});

describe("screens/ — one module per console 00 §5 row (05 §3, §12)", () => {
  it("gives every column a heading and a non-empty help sentence", () => {
    for (const [name, screen] of Object.entries(ALL_CONTENT).filter(
      ([, value]) => value && typeof value === "object" && "columns" in (value as object),
    )) {
      const columns = (screen as { columns: Record<string, { heading: string; help: string }> }).columns;
      for (const [key, column] of Object.entries(columns)) {
        expect(column.heading.length, `${name}.${key}.heading`).toBeGreaterThan(0);
        expect(column.help.length, `${name}.${key}.help`).toBeGreaterThan(0);
      }
    }
  });

  it("gives every verb a verb-shaped label and an explain sentence", () => {
    for (const [name, screen] of Object.entries(ALL_CONTENT).filter(
      ([, value]) => value && typeof value === "object" && "verbs" in (value as object),
    )) {
      const verbs = (screen as { verbs: Record<string, { label: string; explain: string }> }).verbs;
      for (const [key, verb] of Object.entries(verbs)) {
        expect(verb.label.length, `${name}.${key}.label`).toBeGreaterThan(0);
        expect(verb.explain.length, `${name}.${key}.explain`).toBeGreaterThan(0);
      }
    }
  });

  it("references an empty key that content/empty.ts actually defines", () => {
    for (const [name, screen] of Object.entries(ALL_CONTENT).filter(
      ([, value]) => value && typeof value === "object" && "empty" in (value as object),
    )) {
      const empty = (screen as { empty: string }).empty;
      expect(Object.prototype.hasOwnProperty.call(EMPTY, empty), `${name}.empty = "${empty}"`).toBe(true);
    }
  });
});

describe("R9 / R10 — house style across every string in content/", () => {
  const strings = collectStrings(ALL_CONTENT);

  it("has at least one string to check (sanity)", () => {
    expect(strings.length).toBeGreaterThan(50);
  });

  it("never uses an exclamation mark", () => {
    for (const s of strings) {
      expect(s.includes("!"), s).toBe(false);
    }
  });

  it("never uses an American spelling from the denylist", () => {
    const denylist = [/\borganizations?\b/i, /\bcolors?\b/i, /\bbehaviors?\b/i, /\bauthorize[sd]?\b/i, /\bcatalogs?\b/i];
    for (const s of strings) {
      for (const pattern of denylist) {
        expect(pattern.test(s), `"${s}" matched ${pattern}`).toBe(false);
      }
    }
  });
});
