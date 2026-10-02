import type { components } from "@/lib/api.generated";
import { REACH_TEXT } from "@/content/screens/boundaries";
import { fill } from "./refusals";
import { levelLabel } from "./level";
import type { Scope, Viewer } from "./types";

/**
 * Reach's view model (engine 00 §4.10, D131/D136) and the pure functions the
 * four places that say it render with: the Boundaries screen's Reach section,
 * the Endpoints tab's *set by* column, the harness header and its *Applies
 * here* line, and the session report's reach line.
 *
 * The sentences come from `content/screens/boundaries.ts`, which is where
 * Reach's own screen keeps them — one sentence, four readers, rather than the
 * same words written four times (05 R8).
 */
export type ReachView = components["schemas"]["ReachView"];
export type ReachStep = components["schemas"]["ReachStep"];
export type EffectiveReach = components["schemas"]["EffectiveReach"];

export type ReachMode = "off" | "allow" | "on";

/** `mode` is an open string on the wire; a value that is none of the three is
 *  read as `off`, the narrowest, because guessing wider would be a claim. */
export function modeOf(value: string | undefined | null): ReachMode {
  return value === "allow" || value === "on" ? value : "off";
}

/** *allow-list, 3 hosts* · *on, except 1 host* · *off* — the composed answer
 *  in the words the person reads, singular and empty forms included. */
export function reachSaid(reach: { mode: string; hosts?: string[] | null }): string {
  const hosts = reach.hosts ?? [];
  const n = String(hosts.length);
  const mode = modeOf(reach.mode);
  if (mode === "off") return REACH_TEXT.off;
  if (mode === "allow") {
    if (hosts.length === 0) return REACH_TEXT.allowNone;
    return hosts.length === 1 ? REACH_TEXT.allowOne : fill(REACH_TEXT.allow, { n });
  }
  if (hosts.length === 0) return REACH_TEXT.onNone;
  return hosts.length === 1 ? REACH_TEXT.onOne : fill(REACH_TEXT.on, { n });
}

/**
 * `setBy` is a node path or `harness:<id>` (D131) — never a word a person
 * reads. A node path becomes the level's own word, which is `lib/views/level`'s
 * one rule (01 §4.4); a harness becomes its name where the row knows it, and
 * the id where it does not, because inventing one would be worse.
 */
export function setByLabel(
  setBy: string | null | undefined,
  viewer: Viewer,
  harnessNames: Record<string, string> = {},
): string {
  if (!setBy) return "";
  if (setBy.startsWith("harness:")) {
    const id = setBy.slice("harness:".length);
    return harnessNames[id] ?? id;
  }
  return levelLabel(scopeOfNode(setBy), viewer);
}

/** D2: a node path with a dot is a team; the organization's has none. */
export function scopeOfNode(path: string): Scope {
  return path.includes(".") ? { kind: "team", path } : { kind: "org" };
}

/** *set by Organization*, on its own, for a cell with room for one line and a
 *  note under it. Empty when nothing has decided yet. */
export function reachSetByNote(
  reach: EffectiveReach | null | undefined,
  viewer: Viewer,
  harnessNames: Record<string, string> = {},
): string {
  const node = reach ? setByLabel(reach.setBy, viewer, harnessNames) : "";
  return node ? fill(REACH_TEXT.setBy, { node }) : "";
}

/** *allow-list, 3 hosts · set by Organization* — the whole answer on one line,
 *  for the harness header cell and the session report, which have the width
 *  for it. A narrow column takes `reachSaid` and `reachSetByNote` instead. */
export function reachLine(
  reach: EffectiveReach | null | undefined,
  viewer: Viewer,
  harnessNames: Record<string, string> = {},
): string {
  if (!reach) return REACH_TEXT.notSet;
  const note = reachSetByNote(reach, viewer, harnessNames);
  const said = reachSaid(reach);
  return note ? `${said} · ${note}` : said;
}

export interface ChainLine {
  node: string;
  /** *Organization: allow-list, 3 hosts* */
  text: string;
}

/**
 * The walk above this level, one line per node that holds a file (the server
 * sends the walk root first, so *inherited* sits above *yours*). The scope's
 * own step is not in it: it is the setting the section edits, below.
 */
export function inheritedLines(view: ReachView, viewer: Viewer): ChainLine[] {
  return view.chain
    .filter((step) => step.node !== view.scope)
    .map((step) => ({
      node: step.node,
      text: fill(REACH_TEXT.chainLine, {
        level: levelLabel(scopeOfNode(step.node), viewer),
        what: reachSaid(step),
      }),
    }));
}

/**
 * This level's own setting — the file on this node, and `null` where the node
 * holds none (C32: absent is not `off` written down, and the section says
 * which it is).
 *
 * It is deliberately not the inherited answer: the three writes all act on
 * *this* node's file, so a host list drawn from what was inherited would
 * offer a **Remove** that removes nothing. A node with no file of its own
 * shows no list and no mode chosen, and picking a mode is what starts one.
 */
export function ownStep(view: ReachView): { mode: ReachMode; hosts: string[] } | null {
  const own = view.chain.find((step) => step.node === view.scope);
  return own ? { mode: modeOf(own.mode), hosts: [...(own.hosts ?? [])] } : null;
}

export interface Suggestion {
  host: string;
  /** Already on this level's allow-list, so the click is not offered. */
  present: boolean;
}

/** W5-D5's one-click adds, offered under `allow` only: an allow-list is the
 *  only mode in which naming a host is what a person wants to do here. */
export function suggestions(view: ReachView): Suggestion[] {
  const own = ownStep(view);
  if (own?.mode !== "allow") return [];
  const have = new Set(own.hosts);
  return view.suggested.map((host) => ({ host, present: have.has(host) }));
}
