/**
 * Logs — console 04 §14 (`LogRow` columns) plus `/logs/endpoints`
 * (`EndpointRow` columns), one module for every tab of the one page.
 */
import type { ScreenContent } from "../types";

export type LogsColumn =
  | "when"
  | "who"
  | "team"
  | "what"
  | "action"
  | "diff"
  | "host"
  | "outcome"
  | "reason"
  | "setBy"
  | "count"
  | "port"
  | "viaAlias"
  | "first"
  | "last"
  | "sessions"
  | "harnesses"
  | "allow";
export type LogsVerb = "viewAsGit" | "allow";

export const LOGS: ScreenContent<LogsColumn, LogsVerb, "logs" | "endpoints"> = {
  title: "Logs",
  lede: "Every log is the plain-words sentence first, with the underlying git change on demand.",
  /** The tabs' own sentences, which used to be the lede of whichever tab was
   *  open. One page, one readme: the three say what each tab holds. */
  about: [
    "Changes: pushes and pulls on the branches you can see.",
    "Sessions: a session is one run of an assistant under a harness.",
    "Endpoints: every attempt a session made, what came of it, and which rule decided.",
  ],
  columns: {
    when: { heading: "When", help: "When this event happened." },
    who: { heading: "Who", help: "Who did it." },
    team: { heading: "Team", help: "Which team the actor was on." },
    what: { heading: "What", help: "A plain sentence describing what happened." },
    action: { heading: "Action", help: "The exact audit action recorded, shown to admins only." },
    diff: { heading: "Diff", help: "The exact change, for events backed by a commit." },
    host: { heading: "Host", help: "The host a session tried to reach." },
    outcome: { heading: "Outcome", help: "Whether the attempt was reached, refused, or went with a capability stripped out of it." },
    reason: { heading: "Reason", help: "Which rule decided this attempt, in plain words." },
    setBy: { heading: "Set by", help: "The level whose policy decided it, and the one an Allow writes against." },
    count: { heading: "Count", help: "How many attempts this row groups." },
    port: { heading: "Port", help: "The port that was tried." },
    viaAlias: { heading: "Via alias", help: "The credential alias used to reach it, when one applied." },
    first: { heading: "First", help: "The first attempt in this row." },
    last: { heading: "Last", help: "The most recent attempt in this row." },
    sessions: { heading: "Sessions", help: "How many sessions this row groups." },
    harnesses: { heading: "Harnesses", unit: "harnesses", help: "Which harnesses made these attempts." },
    allow: { heading: "Allow", help: "Lets this host through at the level that refused it, from the next session on." },
  },
  verbs: {
    viewAsGit: { label: "View as git", explain: "Shows the underlying commit for this event." },
    allow: { label: "Allow", explain: "Adds this host to the reach of the level that refused it, from the next session on." },
  },
  empty: "logs",
};

/**
 * The rest of the Logs screen's words (04 §14). Logs is one page with tabs
 * and the tabs are routes; the diff arrives on demand from
 * `/logs/{category}/{id}/diff` (P9). A personal account reads the same page
 * under the same name: it has Changes, Sessions and Endpoints like
 * anyone else (07 §3 is about the four audit categories, of which it sees
 * one), and a title that changed between tabs would be the odd thing.
 */
export const LOGS_TEXT = {
  categories: {
    harness: "Changes",
    permission: "Permissions",
    provider: "Providers",
    people: "People",
  },
  /** The whole page's own title; each tab's own words are above and below. */
  title: "Logs",
  sessionsTitle: "Sessions",
  /** *Endpoints*, not *Endpoints reached*: the table under it is every
   *  attempt — reached, refused and stripped alike (W5-D4) — and a tab that
   *  promised only the reached ones was wrong about its own contents. The
   *  tab's own sentence is `LOGS.about`'s third paragraph (01 §7.5). */
  endpointsTitle: "Endpoints",
  viewAsGit: "View as git",
  noDiff: "This event is not backed by a commit.",
  searchPlaceholder: "Filter these rows",
  reachedBy: "Reached by",
  ledeFor: "Everything recorded about {scope}, in plain words, with the git change on demand.",

  /* --- the Endpoints tab, as an attempts log (W5-D4, engine 05 §6a) ------ */

  /** The three outcomes. A request that went with a provider-side capability
   *  taken out of it is neither reached nor refused (D134). */
  outcomes: {
    reached: "reached",
    refused: "refused",
    stripped: "stripped",
  },
  /** `EndpointEvent.reason` in words (05 §6a.1's four, plus the boundary and
   *  the bad secret). A reason this list does not know prints as it came:
   *  inventing a sentence for it would be worse than showing the word. */
  reasons: {
    "reach.off": "Reach is off here, so only credentialed hosts resolve.",
    "reach.not-listed": "It is not on the allow-list.",
    "reach.denied": "It is on the deny-list.",
    port: "Only port 443 is open.",
    boundary: "A boundary denies it.",
    "bad-secret": "Something tried the proxy without the session secret.",
  },
  /** `reason: "stripped:<comma-separated names>"` (D134). */
  strippedReason: "{names} not sent: the provider may not browse on its own side either.",
  noReason: "—",
  viaAliasIs: "via alias",
  portIs: "port",
  allowedNext: "allowed for the next session",
} as const;
