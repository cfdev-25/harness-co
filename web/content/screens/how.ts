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
 * *Set up* — the How page's first tab (console D105, 04 §16.1). Five
 * numbered cards, each a title, one sentence and either a command to copy or
 * something to do by hand. The first card is the one step a web page cannot
 * take for the person: opening a terminal. The last is not a command at all,
 * which is why it names a screen.
 */
export const HOW_SETUP = {
  title: "Set up",
  lede: "Once per machine, in this order.",
  steps: {
    terminal: {
      title: "Open a terminal.",
      sentence: "A web page cannot open one for you, so this first step is yours.",
    },
    install: {
      title: "Install the command line.",
      sentence: "One line, pasted into that terminal. The first run takes a few minutes.",
    },
    login: {
      title: "Sign in from that machine.",
      sentence: "This line already carries this console's address; the token goes on the end.",
    },
    register: {
      title: "Register the harness:// link.",
      sentence: "So the Open in buttons on a harness card start a session on this machine.",
    },
    then: {
      title: "Then",
      sentence: "Open a harness from the {link}.",
    },
  },
  /** The word inside step 5's `{link}`. */
  thenLink: "Harnesses page",
  /**
   * Step 1's keystroke, per operating system. Detection is a guess at what
   * machine this is, so the control beside it is how a person corrects it —
   * a wrong keystroke with no way out is worse than asking.
   */
  os: {
    label: "Which machine",
    options: { mac: "macOS", windows: "Windows", linux: "Linux" },
    keys: {
      mac: "Press ⌘ Space, type Terminal, press Enter.",
      windows: "Press Win, type Terminal, press Enter.",
      linux: "Press Ctrl+Alt+T.",
    },
  },
  tokenOnce: "This is the only time it is shown; generate another if you lose it.",
} as const;

/**
 * The rest of *How this works* (05 §9): the filter box, the three sections,
 * and nothing between them — there is no prose on this page (05 D54).
 */
export const HOW_TEXT = {
  /** The two tabs of this screen (04 §16): what a person does once, and the
   *  reference they come back to. */
  tabs: { setUp: "Set up", reference: "Reference" },
  filterLabel: "Filter",
  filterPlaceholder: "A word or a value",
  scalesHeading: "Scales",
  wordsHeading: "Words",
  commandsHeading: "Commands",
  noMatch: "No scale or word matches that.",
  copy: "Copy",
  copied: "Copied",
} as const;
