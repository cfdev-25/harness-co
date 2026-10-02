import type { components } from "@/lib/api.generated";
import { COMMAND_SHEET } from "@/content/commands.generated";
import { PEOPLE } from "@/content/screens/people";
import type { Column, Related } from "./types";
import { num, record, records, related, str, when } from "./cells";

/** `GET /v1/console/people` · `/people/{id}` · `/people/{id}/removal` · `/teams`. */
export type PersonRow = components["schemas"]["PersonRow"];
export type TeamRow = components["schemas"]["TeamRow"];
export type RemovalPreview = components["schemas"]["RemovalPreview"];

export interface PersonDisplay {
  id: string;
  /** `org_invites.id` on an invited row, `null` otherwise (03 §4.8). */
  invite: string | null;
  name: string;
  email: string;
  teams: Related;
  role: string;
  state: string;
  lastActive: string;
}

export interface TeamDisplay {
  path: string;
  team: string;
  inside: string;
  contains: Related;
  teamsPeople: number;
  groups: Related;
  admins: Related;
}

const PERSON_KEYS = ["name", "email", "teams", "role", "state", "lastActive"] as const;
const TEAM_KEYS = ["team", "inside", "contains", "teamsPeople", "groups", "admins"] as const;

export function personColumns(): Column<PersonDisplay>[] {
  return PERSON_KEYS.map((key) => {
    const entry = PEOPLE.columns[key];
    return {
      key,
      heading: entry.heading,
      help: entry.help,
      kind: key === "teams" ? "related" : key === "role" ? "scale" : key === "lastActive" ? "time" : "text",
      scale: entry.scale,
      unit: entry.unit,
      sort: key === "teams" ? false : undefined,
    };
  });
}

export function teamColumns(): Column<TeamDisplay>[] {
  return TEAM_KEYS.map((key) => {
    const entry = PEOPLE.columns[key];
    return {
      key,
      heading: entry.heading,
      help: entry.help,
      kind:
        key === "contains" || key === "groups" || key === "admins"
          ? "related"
          : key === "teamsPeople"
            ? "number"
            : "text",
      unit: entry.unit,
      sort: key === "contains" || key === "groups" || key === "admins" ? false : undefined,
    };
  });
}

/** `api` fills `name` from the person's email; an empty one reads as the
 *  email rather than as a blank cell nobody can act on. */
export function personName(row: PersonRow): string {
  return row.name || row.email || row.id;
}

export function roleOf(row: PersonRow): string {
  return str(record(row.role).value) || "member";
}

export function lastActive(row: PersonRow): string {
  return when(row.lastActive);
}

export function personTeams(row: PersonRow): Related {
  return related(row.teams, "teams");
}

/**
 * PRD §12: the tree, **collapsed to the top level**. A team whose parent is
 * another team in the same list is not a row; it is that row's *Contains*.
 */
export function topLevel(rows: TeamRow[]): TeamRow[] {
  const paths = new Set(rows.map((row) => row.path));
  return rows.filter((row) => !row.parent || !paths.has(row.parent));
}

export function teamDisplay(row: TeamRow): TeamDisplay {
  return {
    path: row.path,
    team: row.name || row.path,
    inside: row.parent ?? "—",
    contains: related(row.children, "teams"),
    teamsPeople: num(row.people),
    groups: related(row.groups, "groups"),
    admins: related(row.admins, "people"),
  };
}

/** The person page's extra fields (`person_detail` adds them beyond
 *  `PersonRow`); each is narrowed rather than assumed. */
export function personDetail(row: PersonRow): {
  sessions: number;
  groups: Related;
  readableBy: Related;
  /** 03 §4.8: **this person's** two switches, read up their own chain. The
   *  switch on their page sets theirs, so the viewer's are never the default. */
  visibility: { boundaries: boolean; logs: boolean };
} {
  const visibility = record(row.visibility);
  return {
    sessions: num(row.sessions),
    groups: related(row.groups, "groups"),
    readableBy: related(row.readableBy, "people"),
    visibility: { boundaries: visibility.boundaries !== false, logs: visibility.logs !== false },
  };
}

/** What removing a person takes with them (00 §4.9, PRD §18) — computed by
 *  the server so the confirmation is the preview, never *Are you sure?* */
export function removalLists(preview: RemovalPreview): {
  loses: Array<{ group: string; via: string }>;
  rotate: Array<{ ref: string; group: string }>;
} {
  return {
    loses: records(preview.loses).map((item) => ({ group: str(item.group), via: str(item.via) })),
    rotate: records(preview.sharedKeysToRotate).map((item) => ({
      ref: str(item.ref),
      group: str(item.group),
    })),
  };
}

/* ---- the Account screen (04 §17) — the `me` rendering of this screen ----- */

export type SessionRow = components["schemas"]["SessionRow"];
export type SessionView = components["schemas"]["SessionView"];

export interface Login {
  tool: string;
  present: string;
  asOf: string;
  command: string;
}

/**
 * D45: the console cannot probe a machine, so the logins come from the last
 * session's `login` slots, labelled *as of*. One row per `login` need, with
 * the command that creates a missing one taken from the shared sheet (P14).
 */
export function loginsOf(session: SessionView | null): Login[] {
  if (!session) return [];
  const at = when(session.lastActiveAt);
  return records(session.slots)
    .map((slot) => ({ slot, need: str(slot.need) }))
    .filter((entry) => entry.need.startsWith("login:"))
    .map((entry) => ({
      tool: entry.need.slice("login:".length),
      present: str(entry.slot.state) || "unsatisfied",
      asOf: at,
      command: signInCommand(entry.need.slice("login:".length)),
    }));
}

/** The sheet's own row for signing a runtime in; never a command typed here. */
export function signInCommand(tool: string): string {
  const rows = COMMAND_SHEET.flatMap((group) => group.rows);
  const exact = rows.find((row) => row.run === `harness auth ${tool}`);
  if (exact) return exact.run;
  const family = rows.find((row) => row.run.startsWith("harness auth "));
  return family ? family.run.replace(/ [^ ]+$/, ` ${tool}`) : `harness auth ${tool}`;
}

/** D40: `harness login` is a row on the shared sheet, not a command typed
 *  here — the console shows the sheet's own words. */
export function loginCommand(): string {
  const rows = COMMAND_SHEET.flatMap((group) => group.rows);
  return rows.find((row) => row.run.startsWith("harness login"))?.run ?? "harness login";
}

export function lastSessionId(rows: SessionRow[]): string | null {
  return rows[0]?.id ?? null;
}
