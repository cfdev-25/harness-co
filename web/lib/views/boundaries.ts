import type { components } from "@/lib/api.generated";
import { BOUNDARIES, BOUNDARIES_TEXT } from "@/content/screens/boundaries";
import type { Column, Related, Scope } from "./types";
import { type Cell, record, str } from "./cells";

/** `GET /v1/console/boundaries` (00 §4.10); `BoundaryRow` is 00 §4.7's. */
export type BoundaryRow = components["schemas"]["BoundaryRow"];

/** What `ui/table` is handed. `value` and `setBy` are `Cell`s because a `Mono`
 *  and a link are not column kinds the library has (see `cells.ts`). */
export interface BoundaryDisplay {
  id: string;
  kind: string;
  value: Cell;
  holds: string;
  appliesTo: Related;
  onlyFor: Related;
  setBy: Cell;
  reason: string;
  when: string;
}

const COLUMN_KEYS = [
  "kind", "value", "holds", "appliesTo", "onlyFor", "setBy", "reason", "when",
] as const;

/**
 * 07 §3: at *n* = 0 the node that set a boundary is always the person, so the
 * column is absent rather than repeated. Everything else is identical (K9).
 */
export function boundaryColumns(personal: boolean): Column<BoundaryDisplay>[] {
  return COLUMN_KEYS.filter((key) => !(personal && key === "setBy")).map((key) => {
    const entry = BOUNDARIES.columns[key];
    return {
      key,
      heading: entry.heading,
      help: entry.help,
      kind: kindOf(key),
      scale: entry.scale,
      unit: entry.unit,
      sort: key === "onlyFor" || key === "reason" ? false : undefined,
    };
  });
}

function kindOf(key: (typeof COLUMN_KEYS)[number]): Column<BoundaryDisplay>["kind"] {
  if (key === "holds") return "scale";
  if (key === "appliesTo" || key === "onlyFor") return "related";
  if (key === "value" || key === "setBy") return "fact";
  return "text";
}

/** The node that set a row, as its own path (`BoundaryRow.setBy` is a
 *  `ChainNode`; only `kind` and `path` are filled by `api` today). */
export function setByPath(row: BoundaryRow): string {
  return str(record(row.setBy).path);
}

export function setByKind(row: BoundaryRow): string {
  return str(record(row.setBy).kind) || "org";
}

/** The teams and harnesses a boundary is scoped to (prd-v2 §7: org-wide,
 *  named teams, named harnesses — one scoping model for every policy object). */
export function appliesTo(row: BoundaryRow): Related {
  const teams = record(row.scope).teams;
  if (teams === "all" || teams === undefined) return { unit: "teams", items: [], all: true };
  const list = Array.isArray(teams) ? teams.filter((item) => typeof item === "string") : [];
  return {
    unit: "teams",
    items: list.map((path) => ({ id: path, label: leaf(path), href: `/console/${path}` })),
  };
}

export function onlyFor(row: BoundaryRow): Related {
  const harnesses = record(row.scope).harnesses;
  const list = Array.isArray(harnesses) ? harnesses.filter((item) => typeof item === "string") : [];
  return {
    unit: "harnesses",
    items: list.map((id) => ({ id, label: id, href: `/console/org/harnesses/${id}` })),
  };
}

export function leaf(path: string): string {
  return path.split(".").slice(-1)[0] ?? path;
}

/** P17: the list is never summarised, so the org's rows are shown to a team
 *  in their own block rather than filtered away (04 §9). */
export function splitByOrigin(
  rows: BoundaryRow[],
  orgPath: string,
): { own: BoundaryRow[]; fromOrg: BoundaryRow[] } {
  const fromOrg = rows.filter((row) => setByPath(row) === orgPath);
  return { own: rows.filter((row) => setByPath(row) !== orgPath), fromOrg };
}

/* ---- W6-D8: three tabs, two blocks each -------------------------------- */

export type BoundaryTab = "reach" | "commands" | "files";
export const BOUNDARY_TABS: BoundaryTab[] = ["reach", "commands", "files"];

/**
 * Which tab a row belongs under (04 §9, W6-D8).
 *
 * The three deny kinds place themselves: an endpoint is reach, a command is
 * Commands, a path is Files. A **capability** is the awkward one — it names a
 * built-in rather than a thing — so it goes under the tab whose vocabulary its
 * value is in: a value that names a path (`/…`, `~/…`, `./…`) is a file
 * boundary by another name, a value that names running a command
 * (`process.exec`, `tool.<name>`, or anything whose last segment is a shell
 * word we know) is a command one, and everything else falls to Reach, which is
 * where the screen opens.
 *
 * It is a placement rule and not a taxonomy: the plan says *until it has a
 * better home*, and this function is the one place to change when it does.
 */
export function tabOf(row: BoundaryRow): BoundaryTab {
  if (row.kind === "endpoint") return "reach";
  if (row.kind === "command") return "commands";
  if (row.kind === "filesystem") return "files";
  return capabilityTab(row.value);
}

const COMMAND_CAPABILITIES = ["process.exec", "process.spawn", "shell"];

function capabilityTab(value: string): BoundaryTab {
  const name = value.startsWith("require:") ? value.slice("require:".length) : value;
  if (name.startsWith("/") || name.startsWith("~/") || name.startsWith("./")) return "files";
  if (name.startsWith("filesystem.")) return "files";
  if (name.startsWith("tool.") || COMMAND_CAPABILITIES.includes(name)) return "commands";
  return "reach";
}

/**
 * The two blocks (W6-D8): what this level set, and what reaches it from above.
 *
 * `here` is the node this level writes to — the team's path at a team, the
 * organization's at the organization, and `null` at *me*, where a person sets
 * no boundary of their own and therefore inherits all of them. Everything the
 * level did not set is *Inherited* and read-only, each row still carrying the
 * level that set it, because a refusal you cannot look up is indistinguishable
 * from a bug (P17).
 */
export function splitByLevel(
  rows: BoundaryRow[],
  here: string | null,
): { here: BoundaryRow[]; inherited: BoundaryRow[] } {
  if (here === null) return { here: [], inherited: rows };
  return {
    here: rows.filter((row) => setByPath(row) === here),
    inherited: rows.filter((row) => setByPath(row) !== here),
  };
}

/**
 * Does Claude Code's `permissions.deny` hold this pattern? The rule measured
 * on 2.1.286 (engine 07 §8): its matcher splits a command line at `|`, `&&`
 * and `;` and matches each subcommand, so a pattern that itself holds one of
 * those can never fire there. Pi's extension reads such a pattern against the
 * whole line and does hold it, and the row says *intercepted by Pi* rather
 * than claiming a refusal nobody measured.
 *
 * It is the browser's copy of `@harness/compose`'s `claudeHolds`, written here
 * because `web` does not depend on the engine packages; one rule, one line,
 * and the compose table test is what keeps it honest.
 */
export function claudeHolds(pattern: string): boolean {
  return !/[|;&\n]/.test(pattern.trim());
}

/**
 * `GET /v1/console/boundaries/suggested?scope=` (W6-D10).
 *
 * Hand-written: wave 6's rule is that the coordinator regenerates
 * `lib/api.generated.ts` once, after every workstream that changed the API is
 * staged, so until then the shape lives here. It is the api's `SuggestedCommands`
 * model, key for key.
 *
 * Its own route and not a field on the boundaries page, because `Page[T]` is
 * the one listing shape every table reads and is not widened for one screen.
 */
export interface SuggestedCommand {
  value: string;
  holds: string;
  reason: string;
  /** Whether this level, or anything above it, already holds the pattern —
   *  the one fact the preset file cannot say about itself. */
  present: boolean;
}

export interface SuggestedCommands {
  suggested: SuggestedCommand[];
  canEdit: boolean;
}

/** Who may remove a row: its own scope only, and the organization's nobody
 *  below the organization (04 §9's verb table). */
export function mayRemove(row: BoundaryRow, scope: Scope, level: string): boolean {
  if (level === "org-admin") return true;
  if (level !== "team-admin") return false;
  return scope.kind === "team" && setByPath(row) === scope.path;
}

/** The scope a team admin may add within: its own subtree and no wider. */
export function addScopeOf(scope: Scope, orgPath: string): string {
  return scope.kind === "team" ? scope.path : orgPath;
}

/**
 * The `Scope` an add written at `here` must carry.
 *
 * At a team it is that team, and `covers()` walks down from it. At the
 * **organization** it is `"all"`, and it has to be: `covers()` compares a
 * scope's `teams` against the *team* nodes of the chain, and the organization
 * node is not one of them — so `{ teams: ["acme"] }` reaches nobody and the
 * boundary is written, listed, and inert. `"all"` is what *this level and
 * everything below it* means at the top (engine 03 §5.1).
 */
export function scopeFor(here: string, orgPath: string): { teams: string[] | "all" } {
  return here === orgPath ? { teams: "all" } : { teams: [here] };
}

/** 04 §9's three tabs, as the bar's rows (01 §7.5, W6-D8). They are routes
 *  (02 rule 16), so the browser's back button means something. */
export function boundaryTabs(base: string, current: BoundaryTab) {
  return BOUNDARY_TABS.map((tab) => ({
    id: tab,
    label: BOUNDARIES_TEXT.tabs[tab],
    href: `${base}/boundaries/${tab}`,
    current: tab === current,
  }));
}
