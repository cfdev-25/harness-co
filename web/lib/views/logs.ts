import type { components } from "@/lib/api.generated";
import { LOGS, LOGS_TEXT } from "@/content/screens/logs";
import { fill } from "./refusals";
import type { Column, Related } from "./types";
import { type Cell, bool, record, related, str, when } from "./cells";

/** `GET /v1/console/logs/{category}` · `/endpoints` (00 §4.10). */
export type LogRow = components["schemas"]["LogRow"];
export type EndpointRow = components["schemas"]["EndpointRow"];

export type LogCategory = "harness" | "permission" | "provider" | "people";

export const CATEGORIES: LogCategory[] = ["harness", "permission", "provider", "people"];

export function isCategory(value: string): value is LogCategory {
  return CATEGORIES.some((category) => category === value);
}

/**
 * The tabs are routes (04 §14), and a route is named for what a person reads
 * there, not for the audit category behind it: the harness log is **Changes**
 * — pushes and pulls on branches you can see. `harness` stays the category
 * `api` answers to, and `/logs/harness` redirects onto `/logs/changes`.
 */
export const CHANGES = "changes";

/** The three admin categories, which only an admin of the level may read. */
export const ADMIN_CATEGORIES: LogCategory[] = ["permission", "provider", "people"];

export function categoryOf(route: string): LogCategory | null {
  if (route === CHANGES) return "harness";
  return isCategory(route) && route !== "harness" ? route : null;
}

export function routeOf(category: LogCategory): string {
  return category === "harness" ? CHANGES : category;
}

export interface LogDisplay {
  id: string;
  when: string;
  who: string;
  team: string;
  what: string;
  action: Cell;
  diff: Cell;
}

/**
 * W5-D4: the Endpoints tab is an attempts log, one row per
 * (host, outcome, reason, setBy) — the same host refused for two reasons is
 * two things to do something about (engine 05 §8). `allow` is the row's own
 * verb and is rendered by the table, so the display carries the action, not
 * a button.
 */
export interface AttemptDisplay {
  key: string;
  host: Cell;
  outcome: Cell;
  reason: string;
  setBy: string;
  count: number;
  first: string;
  last: string;
  sessions: Cell;
  allow: Cell;
}

const LOG_KEYS = ["when", "who", "team", "what", "action", "diff"] as const;
const ATTEMPT_KEYS = [
  "host", "outcome", "reason", "setBy", "count", "first", "last", "sessions", "allow",
] as const;

/**
 * 04 §14: `Action` is the audit string and is not a column at `me` — a person
 * reading their own log reads the sentence, not the machine's word for it.
 */
export function logColumns(atMe: boolean): Column<LogDisplay>[] {
  return LOG_KEYS.filter((key) => !(atMe && key === "action")).map((key) => {
    const entry = LOGS.columns[key];
    return {
      key,
      heading: entry.heading,
      help: entry.help,
      kind: key === "action" || key === "diff" ? "fact" : key === "when" ? "time" : "text",
      sort: key === "diff" || key === "what" ? false : undefined,
    };
  });
}

export function attemptColumns(): Column<AttemptDisplay>[] {
  return ATTEMPT_KEYS.map((key) => {
    const entry = LOGS.columns[key];
    return {
      key,
      heading: entry.heading,
      help: entry.help,
      kind: attemptKind(key),
      sort: key === "allow" || key === "reason" ? false : undefined,
    };
  });
}

function attemptKind(key: (typeof ATTEMPT_KEYS)[number]): Column<AttemptDisplay>["kind"] {
  if (key === "host" || key === "outcome" || key === "sessions" || key === "allow") return "fact";
  if (key === "count") return "number";
  if (key === "first" || key === "last") return "time";
  return "text";
}

/**
 * `EndpointEvent.reason` in the words 05 §6a's table gives it. `stripped:a,b`
 * names what was taken out; a reason this list does not know prints as it
 * came, because a sentence invented for it would be a claim (K2).
 */
export function reasonWords(reason: string | null | undefined): string {
  if (!reason) return LOGS_TEXT.noReason;
  if (reason.startsWith("stripped:")) {
    const names = reason.slice("stripped:".length).split(",").filter(Boolean).join(", ");
    return fill(LOGS_TEXT.strippedReason, { names });
  }
  const known: Record<string, string> = LOGS_TEXT.reasons;
  return known[reason] ?? reason;
}

/** *reached* · *refused* · *stripped*, in the screen's words. An outcome this
 *  list does not know prints as it came. */
export function outcomeWord(outcome: string): string {
  const known: Record<string, string> = LOGS_TEXT.outcomes;
  return known[outcome] ?? outcome;
}

/** The harness names this row knows, keyed by id, so `setBy: "harness:<id>"`
 *  can be said as a name rather than a uuid (`node_label_only_on_paths`). */
export function harnessNames(row: EndpointRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of related(row.harnesses, "harnesses").items) out[item.id] = item.label;
  return out;
}

/** W5-D4's action, narrowed off the open `Meta` record `api.generated.ts`
 *  gives it: whether this viewer may allow the host, where the write goes,
 *  and, when they may not, the one sentence saying who can. */
export function allowOf(row: EndpointRow): { can: boolean; scope: string; why: string } {
  const allow = record(row.allow);
  return { can: bool(allow.can) === true, scope: str(allow.scope), why: str(allow.why) };
}

export function actorOf(row: LogRow): string {
  const actor = record(row.actor);
  return str(actor.name) || str(actor.id) || "—";
}

export function teamOf(row: LogRow): string {
  const team = record(row.team);
  return str(team.name) || str(team.path) || "—";
}

export function logWhen(row: LogRow): string {
  return when(row.at);
}

/** P9: a row is git-backed when the audit event carries a ref and a commit;
 *  only then is there a diff to fetch on demand. */
export function isGitBacked(row: LogRow): boolean {
  const ref = record(row.ref);
  return str(ref.commit) !== "" || str(ref.ref) !== "";
}

export function commitOf(row: LogRow): string {
  return str(record(row.ref).commit).slice(0, 7);
}

/** The filter box over the rows already read (04 §14's search). It matches the
 *  sentence a person reads, not the action string they do not. */
export function matching(rows: LogRow[], query: string): LogRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return rows;
  return rows.filter((row) =>
    `${row.sentence} ${actorOf(row)} ${teamOf(row)}`.toLowerCase().includes(needle),
  );
}

export function endpointsRelated(row: EndpointRow): Related {
  return related(row.harnesses, "harnesses");
}

export interface LogTab {
  id: string;
  label: string;
  href: string;
  /** Which route is open, so the bar can mark it (01 §7.5). */
  current: boolean;
}

/**
 * Logs is one page with tabs, and the tabs are routes (04 §14). Everyone on
 * the level reads **Changes**, **Sessions** and **Endpoints**; the three
 * audit categories that are about other people — Permissions, Providers,
 * People — belong to whoever administers the level, and a personal account
 * has no one else, so it reads the first three and nothing more (07 §3).
 */
export function tabs(
  base: string,
  viewer: { adminHere: boolean; edition: "personal" | "enterprise" },
  current = "",
): LogTab[] {
  const tab = (id: string, label: string) => ({
    id,
    label,
    href: `${base}/logs/${id}`,
    current: id === current,
  });
  const shared = [
    tab(CHANGES, LOGS_TEXT.categories.harness),
    tab("sessions", LOGS_TEXT.sessionsTitle),
    tab("endpoints", LOGS_TEXT.endpointsTitle),
  ];
  if (viewer.edition === "personal" || !viewer.adminHere) return shared;
  return [...shared, ...ADMIN_CATEGORIES.map((category) =>
    tab(category, LOGS_TEXT.categories[category]))];
}

