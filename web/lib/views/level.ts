import { SHELL } from "@/content/shell";
import { fill } from "@/lib/views/refusals";
import type { Scope, Viewer } from "./types";

/**
 * Where you are, in words (01 §4.3, §7.5): the switcher's rows and the chip
 * every `PageHeader` carries. It is its own module and not `viewer.ts`'s
 * because `viewer.ts` fetches — it reaches `next/headers` through
 * `api.server` — and both the client switcher and the component rig need
 * these functions without that.
 */

export interface Level {
  /** The level's own word — never the dotted path (01 §4.4). */
  label: string;
  /** Whether the viewer may change things here; at *me* always. */
  canEdit: boolean;
  /** What the chip says, built here so `ui/` is given its strings (02 rule 2). */
  sentence: string;
}

/**
 * The one place a scope becomes the words a person reads: the switcher's rows
 * and every `PageHeader`'s level chip (01 §4.3, §7.5). A team's word is its
 * name from `Viewer.teams`, falling back to the last segment of the path,
 * because a path is an address and not a name (`node_label_only_on_paths`).
 */
export function levelOf(scope: Scope, viewer: Viewer): Level {
  return said(levelLabel(scope, viewer), scope.kind === "me" || viewer.adminHere);
}

/** The level's own word, shared by the chip and the switcher's tree. */
export function levelLabel(scope: Scope, viewer: Viewer): string {
  if (scope.kind === "me") return SHELL.levels.me;
  if (scope.kind === "org") return SHELL.levels.org;
  if (scope.kind === "platform") return SHELL.levels.platform;
  const team = viewer.teams.find((entry) => entry.path === scope.path);
  return team?.name ?? scope.path.split(".").slice(-1)[0];
}

function said(label: string, canEdit: boolean): Level {
  const template = canEdit ? SHELL.chip.canEdit : SHELL.chip.readOnly;
  return { label, canEdit, sentence: fill(template, { level: label }) };
}

export interface LevelRow {
  scope: Scope;
  label: string;
  /** How far the row is indented: 0 for *You*, the org and a top team. */
  depth: number;
  current: boolean;
}

/**
 * The one selector (01 §4.3): *You*, then each team with its sub-teams
 * indented under it, then *Organization*. A sub-team's depth is its path's
 * depth below the shallowest team the viewer is on, because the chain always
 * carries a team's ancestors — so the tree is complete without assuming the
 * organization's path is one segment.
 */
export function levelRows(scope: Scope, viewer: Viewer): LevelRow[] {
  const teams = [...viewer.teams].sort((a, b) => a.path.localeCompare(b.path));
  const top = Math.min(...teams.map((team) => team.path.split(".").length));
  const here = (target: Scope) =>
    target.kind === scope.kind &&
    (target.kind !== "team" || (scope.kind === "team" && target.path === scope.path));
  const row = (target: Scope, label: string, depth: number): LevelRow => ({
    scope: target,
    label,
    depth,
    current: here(target),
  });
  return [
    row({ kind: "me" }, SHELL.levels.me, 0),
    ...teams.map((team) =>
      row({ kind: "team", path: team.path }, team.name, team.path.split(".").length - top),
    ),
    row({ kind: "org" }, SHELL.levels.org, 0),
  ];
}
