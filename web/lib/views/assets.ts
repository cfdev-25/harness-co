import type { components } from "@/lib/api.generated";
import { ASSETS, ASSETS_TEXT } from "@/content/screens/assets";
import { WORDS } from "@/content/words";
import { fill } from "./refusals";
import type { Column, Related, Scope } from "./types";
import { type Cell, record, related, str, when } from "./cells";

/** The three words this screen says about *where it is*, which 02 rule 5
 *  keeps out of `page.tsx`: the lede, the empty sentence's id and the count.
 *  Each is one line and each is W5-D9's — one screen, three levels. */
export function assetsLede(scope: Scope): string {
  if (scope.kind === "org") return ASSETS.lede;
  return scope.kind === "me" ? ASSETS_TEXT.ledeMe : ASSETS_TEXT.ledeTeam;
}

export function assetsEmptyId(scope: Scope): "assets.org" | "assets.team" | "assets.me" {
  if (scope.kind === "org") return "assets.org";
  return scope.kind === "me" ? "assets.me" : "assets.team";
}

export function assetsCount(n: number): string {
  return n === 1 ? ASSETS_TEXT.countOne : fill(ASSETS_TEXT.count, { n: String(n) });
}

/** `GET /v1/console/assets` · `/assets/{id}` (00 §4.10). */
export type OrgAssetRow = components["schemas"]["OrgAssetRow"];

/**
 * The listing (W5-D9). Hand-written rather than
 * `components["schemas"]["Page_OrgAssetRow_"]` because `kinds` — the
 * organization's kind vocabulary, which the tabs are — landed with this
 * workstream and `openapi.json` is regenerated once per wave by the
 * coordinator (02 rule 13, and the plan's ground rules). It is the
 * `AssetsPage` model in `backend/app/domain/console_models.py`.
 */
export interface AssetsPage {
  items: OrgAssetRow[];
  next: string | null;
  kinds: string[];
}

export interface AssetDisplay {
  id: string;
  name: Cell;
  description: string;
  loads: string;
  usedBy: Related;
  lastChange: string;
  actions?: Cell;
}

/** W5-D9's row. `type` is not among them: the tabs are the kinds, so every
 *  row on the screen is of the kind the tab names. */
const COLUMN_KEYS = ["name", "description", "loads", "usedBy", "lastChange"] as const;

export function assetColumns(): Column<AssetDisplay>[] {
  return COLUMN_KEYS.map((key) => {
    const entry = ASSETS.columns[key];
    return {
      key,
      heading: entry.heading,
      help: entry.help,
      kind: columnKind(key),
      scale: entry.scale,
      unit: entry.unit,
      // A relationship cell has no order worth sorting on (03 §10).
      sort: key === "usedBy" ? false : undefined,
    };
  });
}

function columnKind(key: (typeof COLUMN_KEYS)[number]): Column<AssetDisplay>["kind"] {
  if (key === "usedBy") return "related";
  if (key === "name") return "fact";
  return "text";
}

/**
 * The kind tabs (W5-D9). One tab per kind the organization declares, in
 * `policy/kinds.json` order, even when nothing on this branch is of that
 * kind — the count reads zero and the tab is quiet rather than absent. A
 * kind the branch holds that the vocabulary does not name is still a tab, at
 * the end: the rows exist and must be reachable.
 */
export interface KindTab {
  id: string;
  label: string;
  count: number;
  current: boolean;
  href: string;
}

export function kindsOf(kinds: string[], rows: OrgAssetRow[]): string[] {
  const extra = rows.map((row) => row.kind).filter((kind) => !kinds.includes(kind));
  return [...kinds, ...[...new Set(extra)].sort()];
}

/**
 * Which tab is open: the one `?kind=` names when it is a kind, else the
 * first kind with rows, else the first kind. A screen is never opened on an
 * empty tab when it has something to show.
 */
export function currentKind(kinds: string[], rows: OrgAssetRow[], asked?: string | null): string {
  const all = kindsOf(kinds, rows);
  if (asked && all.includes(asked)) return asked;
  return all.find((kind) => rows.some((row) => row.kind === kind)) ?? all[0] ?? "";
}

export function kindTabs(
  kinds: string[],
  rows: OrgAssetRow[],
  current: string,
  base: string,
): KindTab[] {
  return kindsOf(kinds, rows).map((kind) => ({
    id: kind,
    label: kind.replace(/_/g, " "),
    count: rows.filter((row) => row.kind === kind).length,
    current: kind === current,
    href: `${base}?kind=${encodeURIComponent(kind)}`,
  }));
}

export function ofKind(rows: OrgAssetRow[], kind: string): OrgAssetRow[] {
  return rows.filter((row) => row.kind === kind);
}

/** The sidecar's `description` (WS3a put it there), or nothing. */
export function description(row: OrgAssetRow): string {
  return str(record(row.sidecar).description);
}

/**
 * The one place the *Loads* word is written (W5-D9, W5-D10). Three states,
 * not two: `required` is in every session's load set and cannot be taken out
 * of a harness or deleted; `recommended` seeds every new harness and is an
 * ordinary entry after that; `on-request` is neither. One line each, and
 * every screen that reads a loads cell says the same thing.
 */
export const LOADS: readonly LoadsState[] = ["required", "recommended", "on-request"] as const;

export type LoadsState = "required" | "recommended" | "on-request";

const LOADS_WORDS: Record<LoadsState, string> = {
  required: ASSETS_TEXT.loadsRequired,
  recommended: ASSETS_TEXT.loadsRecommended,
  "on-request": ASSETS_TEXT.loadsOnRequest,
};

export function loadsLabel(row: OrgAssetRow): string {
  return LOADS_WORDS[loadsValue(row)];
}

export function loadsWord(state: LoadsState): string {
  return LOADS_WORDS[state];
}

/** What a delete would take the asset out of (02 rule 22): the harnesses of
 *  the row's *used by*, or the *all harnesses* case an always-loaded asset
 *  is in. */
export function usedBy(row: OrgAssetRow): { all: boolean; labels: string[] } {
  const links = related(row.harnesses, "harnesses");
  return { all: links.all === true, labels: links.items.map((item) => item.label) };
}

/** A kind is data, not a scale (01 D68) — a `Chip`, in a `Word` when the
 *  vocabulary explains it and plain when it does not. */
export function kindWord(kind: string): WordId | null {
  return WORD_IDS.find((word) => word === kind) ?? null;
}

type WordId = keyof typeof WORDS;
const WORD_IDS: WordId[] = Object.keys(WORDS).filter(isWordId);

function isWordId(value: string): value is WordId {
  return value in WORDS;
}

/**
 * The state the server sent, in W5-D10's vocabulary. `always` and `chosen`
 * are the two words the route took before the split and are read as the state
 * they mean for one release — an organization indexed before WS4 still holds
 * them. Nothing here *sends* them any more.
 */
export function loadsValue(row: OrgAssetRow): LoadsState {
  const said = str(record(row.loads).value);
  if (said === "always") return "required";
  if (said === "chosen" || said === "when-chosen") return "on-request";
  return LOADS.find((state) => state === said) ?? "on-request";
}

/** Required is the state that decides for everyone: every session loads it,
 *  no harness may leave it out, and it cannot be deleted. */
export function isRequired(row: OrgAssetRow): boolean {
  return loadsValue(row) === "required";
}

export function lastChange(row: OrgAssetRow): string {
  return when(record(row.sidecar).at ?? row.at);
}

/** 04 §12's asset page: the sidecar as plain key/values, nothing invented. */
export function sidecarFacts(row: OrgAssetRow): Array<{ k: string; v: string }> {
  return Object.entries(record(row.sidecar))
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => ({ k: key, v: String(value) }));
}

export function assetRelated(row: OrgAssetRow): {
  harnesses: Related;
  teams: Related;
  groups: Related;
} {
  return {
    harnesses: related(row.harnesses, "harnesses"),
    teams: related(row.teams, "teams"),
    groups: related(row.groups, "groups"),
  };
}

/** `EdgeWalk`, directed and never merged (P1, 04 §18). */
export function edges(row: OrgAssetRow): {
  restsOn: Array<{ kind: string; id: string; label: string; via: string }>;
  restedOnBy: Array<{ kind: string; id: string; label: string; via: string }>;
} {
  const walk = record(row.edges);
  return { restsOn: edgeList(walk.restsOn), restedOnBy: edgeList(walk.restedOnBy) };
}

export function edgeList(value: unknown): Array<{ kind: string; id: string; label: string; via: string }> {
  return (Array.isArray(value) ? value : []).map((item) => {
    const edge = record(item);
    return { kind: str(edge.kind), id: str(edge.id), label: str(edge.label), via: str(edge.via) };
  });
}

// --- the store (W5-D15) -----------------------------------------------------

/**
 * `GET /v1/console/assets/browse?scope=` — one asset the viewer could put in
 * a harness. Hand-written for the reason `AssetsPage` is: the endpoint landed
 * with this workstream and `api.generated.ts` is regenerated once per wave by
 * the coordinator (02 rule 13). It is the `BrowseRow` model in
 * `backend/app/domain/console_models.py`.
 */
export interface BrowseRow {
  id: string;
  kind: string;
  name: string;
  description: string;
  /** `preset` for a bundled asset the organization does not hold yet; else
   *  the level of the node whose copy wins for this viewer. */
  level: "org" | "team" | "me" | "preset";
  /** That node's own name. Empty at `me` and `preset`, whose words are the
   *  console's to write (02 rule 26). */
  from: string;
  /** The asset page for the copy, at the level that holds it. `null` for a
   *  preset, which is on no branch and so has no page. */
  href: string | null;
  /** Whether the viewer's own branch holds a copy. */
  held: boolean;
  preset: boolean;
  /** The environment a tool's sidecar names (engine 01 §5). */
  needsEnvironment: string | null;
}

export interface BrowsePage {
  items: BrowseRow[];
  next: string | null;
}

/** The *from* column: the level's own word where the level is the word
 *  (*you*, *preset*), and the node's own name where it has one. */
export function fromLabel(row: BrowseRow): string {
  if (row.level === "preset") return ASSETS_TEXT.browsePreset;
  if (row.level === "me") return ASSETS_TEXT.browseYou;
  return row.from;
}

/** The kind filter inside Browse. `""` is *all kinds*, which is where Browse
 *  opens: the store spans the vocabulary and a person looking for something
 *  does not know its kind yet. */
export function browseKinds(rows: BrowseRow[]): string[] {
  return [...new Set(rows.map((row) => row.kind))].sort();
}

export function browseFilter(rows: BrowseRow[], kind: string, query: string): BrowseRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (kind === "" || row.kind === kind) &&
      (needle === "" ||
        `${row.kind} ${row.name} ${row.description}`.toLowerCase().includes(needle)),
  );
}

/**
 * W5-D15. Ticking a tool that names an environment ticks that environment
 * too. The same rule runs in `routes_writes._with_environments`, because the
 * CLI reaches the same write; this one exists so the person is told *before*
 * they press the button, which is the half a route cannot do.
 */
export interface Brought {
  /** `<kind>/<name>` of the environment added. */
  environment: string;
  /** `<kind>/<name>` of the tool that needs it. */
  tool: string;
  id: string;
}

export function withEnvironments(
  ids: string[],
  rows: BrowseRow[],
): { ids: string[]; brought: Brought[] } {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const byName = new Map(rows.map((row) => [`${row.kind}/${row.name}`, row]));
  const out = [...new Set(ids)];
  const brought: Brought[] = [];
  for (const id of [...out]) {
    const row = byId.get(id);
    if (!row?.needsEnvironment) continue;
    const environment = byName.get(`environment/${row.needsEnvironment}`);
    if (!environment || out.includes(environment.id)) continue;
    out.push(environment.id);
    brought.push({
      environment: `environment/${environment.name}`,
      tool: `${row.kind}/${row.name}`,
      id: environment.id,
    });
  }
  return { ids: out, brought };
}

/** *adds `environment/python-data` because `tool/csv-summary` needs it* —
 *  one line per environment the selection brought along. */
export function broughtSentence(brought: Brought): string {
  return ASSETS_TEXT.browseBrings
    .replace("{environment}", brought.environment)
    .replace("{tool}", brought.tool);
}
