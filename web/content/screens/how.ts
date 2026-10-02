/**
 * How this works — console 04 §16 (05 §9). Scope-independent; no verbs.
 *
 * `seenOn`'s column has no `unit`: console 04 §16 calls it `Related` of
 * screens, but `RelatedUnit` (console 00 §4.7) has no `"screens"` member —
 * teams, harnesses, groups, secrets, assets, providers and people are the
 * only units. Reported as a gap rather than inventing a unit 00 §4 doesn't
 * declare.
 *
 * `empty` is `"how"`, added to `content/empty.ts` only to satisfy the
 * required field — 05 §16 says this screen's empty state is "impossible".
 */
import type { ScreenContent } from "../types";

export type HowColumn = "value" | "means" | "seenOn";
export type HowVerb = "generateToken";

export const HOW: ScreenContent<HowColumn, HowVerb, "how"> = {
  title: "How this works",
  lede: "Every scale and every word the console uses, once, in one place.",
  columns: {
    value: { heading: "Value", help: "The value, shown in its tone." },
    means: { heading: "Means", help: "What this value means." },
    seenOn: { heading: "Seen on", help: "Which screens show this value." },
  },
  verbs: {
    generateToken: {
      label: "Generate a token",
      explain: "Mints an access token and writes it into the sign-in line. It is shown once.",
    },
  },
  empty: "how",
};

/**
 * *Set up* — the one dynamic thing on this page (console D105, 04 §16.1). It
 * sits above the filter box because it is the first thing a person who has
 * just signed up needs and the rest of the page is a reference they will come
 * back to. The three steps are numbered on their blocks; `then` is the one
 * line after them, and it names a screen, not a command.
 */
export const HOW_SETUP = {
  title: "Set up",
  steps: {
    install: "Install the command line",
    login: "Sign in from that machine",
    register: "Register the harness:// link",
  },
  then: "Then open a harness from the Harnesses page.",
  tokenOnce: "This is the only time it is shown; generate another if you lose it.",
} as const;

/**
 * The rest of *How this works* (05 §9): the filter box, the three sections,
 * and nothing between them — there is no prose on this page (05 D54).
 */
export const HOW_TEXT = {
  filterLabel: "Filter",
  filterPlaceholder: "A word or a value",
  scalesHeading: "Scales",
  wordsHeading: "Words",
  commandsHeading: "Commands",
  noMatch: "No scale or word matches that.",
  copy: "Copy",
  copied: "Copied",
} as const;
