import { HARNESSES_WORDS } from "@/content/screens/harnesses";
import { SHELL } from "@/content/shell";
import type { EffectiveReach } from "./reach";
import { reachLine } from "./reach";
import type { Fact, PixelIcon, Scope, Viewer } from "./types";

/**
 * The harness family's view models (console 00 §4.3), and the pure functions
 * the four screens render with. Nothing here fetches and nothing here is JSX
 * (02 rule 2); every function is V1-tested beside this file.
 *
 * The response shapes are declared rather than imported from
 * `lib/api.generated.ts`: `api`'s Pydantic models type `header`, `versions`,
 * `lastEditor` and `groups` as open `dict[str, Any]`, so the generated types
 * carry `{ [key: string]: unknown }` for each and a screen could not read
 * `header.preflight.value` from them without a cast, which rule 15 forbids.
 * Reported as a contract problem; when 03 narrows those models this file
 * imports `paths[…]` instead.
 */

/** Every `/v1/console` collection answers `{ items, next }` (03 §4). */
export interface Page<Row> {
  items: Row[];
  next: string | null;
  hidden?: Record<string, string> | null;
}

/**
 * W5-D9: another copy of the same harness id on the viewer's chain. The card
 * shows the nearest copy — that is *your* version of it — and names the
 * others so the person can read the one the organization or the team holds.
 * Hand-written like the rest of this file (the header above): the backend's
 * `AlsoAt` model landed with this workstream and `api.generated.ts` is
 * regenerated once per wave by the coordinator.
 */
export interface AlsoAt {
  level: "org" | "team" | "me";
  /** The node's own word — the team's name; the level's word is `alsoAtWord`. */
  label: string;
  href: string;
}

/**
 * W5-D13: a runtime that can start this harness for this viewer — approved
 * for the level, scoped to this harness, and speaking a wire format the
 * routed model exposes. The server decides all three (`console.runners_for`);
 * the card only draws a button per entry. `name` is the word on the button,
 * because `HarnessProvider` carries an id and no display name.
 */
export interface Runner {
  id: string;
  name: string;
}

export interface HarnessCard {
  id: string;
  name: string;
  description: string;
  icon?: PixelIcon | null;
  team: { path: string; name: string };
  fileCount: number;
  alsoAt?: AlsoAt[];
  runners?: Runner[];
  /** W5-D14: the viewer's **own** last session with this harness — where it
   *  ran and on which machine. Absent for everyone else and under `?as`, so
   *  **Resume** is drawn only when `lastWorkspace` is there. `lastHost` is
   *  still sent and the card no longer draws it (D107): naming the machine
   *  helps nobody who owns one, and it was the longest word in the row. */
  lastWorkspace?: string | null;
  lastHost?: string | null;
}

/**
 * W5-D13's link (engine 08 §11.24). The one shape the CLI answers to:
 * `harness://run?harness=<id>&provider=<id>[&workspace=<absolute path>]`.
 * `encodeURIComponent` and not `URLSearchParams`, which spells a space `+`:
 * `parseLink` reads the query with `URL.searchParams`, so a `+` would come
 * back as a space and name a folder nobody has.
 */
export function runHref(harnessId: string, providerId: string, workspace?: string | null): string {
  const link = `harness://run?harness=${encodeURIComponent(harnessId)}`
    + `&provider=${encodeURIComponent(providerId)}`;
  return workspace ? `${link}&workspace=${encodeURIComponent(workspace)}` : link;
}

/** A home-like prefix reads `~` **to a person** (04 §4). Display only: the
 *  link carries the absolute path, because the CLI refuses anything else. */
const HOME_LIKE = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[/\\]|$)/;

export function shortPath(path: string): string {
  return path.replace(HOME_LIKE, "~");
}

/** What an *also at* link reads: the level's own word for the organization
 *  and for a person, and the team's name for a team — never a dotted path
 *  (01 §4.4, the rule `levelLabel` follows). */
export function alsoAtWord(entry: AlsoAt): string {
  if (entry.level === "org") return SHELL.levels.org;
  if (entry.level === "me") return SHELL.levels.me;
  return entry.label;
}

export type FileOwner = "org" | "team" | "you" | `member:${string}`;
export type Differs = "yours-only" | "theirs-only" | "both" | "conflict";

export interface HarnessFileRow {
  /** W5-D10. `required`: loaded into every session by the organization, not
   *  chosen by the harness, and it cannot be taken out. `recommended`: what a
   *  new harness starts with. `on-request`: this harness asked for it. */
  loads?: "required" | "recommended" | "on-request";
  assetId: string;
  kind: string;
  name: string;
  path: string;
  owner: FileOwner;
  lastEditor: { name: string; at: string; note: string } | null;
  tree: string;
  differs?: Differs | null;
}

export interface HarnessVersion {
  id: "mine" | "team" | `member:${string}` | typeof DIFFERENCES;
  label: string;
}

export interface HarnessView {
  def: { id: string; name: string; description: string; icon?: PixelIcon; assets: string[] };
  team: { path: string; name: string };
  header: {
    preflight: Fact<"passing" | "failing">;
    modelProvider: Fact<string | null>;
    groups: Fact<string[]>;
    fileCount: number;
  };
  /**
   * D131, W5-D7: how far a session of this harness may reach — the chain's
   * walk, narrowed by the harness's own step. It replaces the header's
   * outside-endpoints cell, which read the grant W5-D1b retired and had
   * become a constant. Declared here like the rest of this interface, for the
   * reason the header above gives; `api.generated.ts` carries the same field
   * as `HarnessView.reach: EffectiveReach`.
   */
  reach: EffectiveReach;
  versions: HarnessVersion[];
  files: HarnessFileRow[];
  groups: Array<{ name: string; grant: string }>;
  boundaries: BoundaryRow[];
  hidden?: Record<string, string> | null;
}

/** console 00 §4.7's `BoundaryRow`, listed in full in the sidebar (P17). */
export interface BoundaryRow {
  id: string;
  kind: string;
  value: string;
  holds: string;
  reason?: string;
  setBy?: { path?: string; kind?: string } | null;
  /** W7-D8: the scope's harnesses half, which is what tells *Applies here*
   *  whether a row reaches **this** harness. `HarnessView.boundaries` is every
   *  boundary on the chain, so without it a boundary bound to one harness
   *  would be listed on the page of every other. */
  scope?: { harnesses?: string[] | null } | null;
}

export interface FileView {
  row: HarnessFileRow;
  content: { mine: string | null; team: string | null };
  diff?: Array<{ header: string; lines: Array<{ kind: "ctx" | "add" | "del"; text: string }> }> | null;
  history: Array<{ commit: string; branch: "mine" | "team"; who: string; at: string; message: string }>;
  request?: { id: string; state: "open" | "closed" } | null;
}

/**
 * D2: a scope segment is `org`, `me` or a dotted team path, so the node a
 * harness sits on is the organization when its path has no dot. A card's team
 * cell links through this rather than assuming every node is a team.
 */
export function scopeOfPath(path: string): Scope {
  return path.includes(".") ? { kind: "team", path } : { kind: "org" };
}

/* ---- the compare control (04 §18) -------------------------------------- */

/** `differences` is the client-side option (03 D32); it is not in `versions`. */
export const DIFFERENCES = "differences";
export type VersionId = HarnessVersion["id"];

/** 04 §5: `mine` at `me`, the team's elsewhere; an unknown value falls back. */
export function defaultVersion(scope: Scope): VersionId {
  return scope.kind === "me" ? "mine" : "team";
}

export function readVersion(raw: string | undefined, scope: Scope, view: ViewId): VersionId {
  const value = raw ?? defaultVersion(scope);
  if (value === DIFFERENCES) return view === "history" ? defaultVersion(scope) : DIFFERENCES;
  if (value === "mine" || value === "team") return value;
  if (value.startsWith("member:")) return value as `member:${string}`;
  return defaultVersion(scope);
}

/** The version a `?version=` maps to on the server: `differences` reads both. */
export function fetchedVersion(version: VersionId): HarnessVersion["id"] {
  return version === DIFFERENCES ? "mine" : version;
}

/** `?as` follows a `member:` selection onto every child route (04 §18). */
export function asOf(version: VersionId): string | null {
  return version.startsWith("member:") ? version.slice("member:".length) : null;
}

/**
 * 04 §18: a member's options are exactly mine · team · differences; a team
 * admin's add one per member, labelled by name. The server sizes `versions`
 * by role (K8, `console.versions_for`), so this only adds the client-side
 * option and applies 07 §3 — at `edition: "personal"` there is no team
 * version, and a control with one option is hidden, not rendered.
 */
export function compareOptions(
  view: HarnessView,
  viewer: Viewer,
  panel: ViewId,
  labels: { differences: string },
): HarnessVersion[] | null {
  const personal = viewer.edition === "personal";
  const options: HarnessVersion[] = personal
    ? view.versions.filter((option) => option.id === "mine")
    : [...view.versions];
  if (!personal && panel !== "history") {
    options.push({ id: DIFFERENCES, label: labels.differences });
  }
  return options.length > 1 ? options : null;
}

/* ---- the Files / History / Requests control ---------------------------- */

export type ViewId = "files" | "history" | "requests";

export function readView(raw: string | undefined, viewer: Viewer): ViewId {
  if (raw === "history") return "history";
  // 07 §3: a personal account has no team to offer to, so no Requests view.
  if (raw === "requests" && viewer.edition !== "personal") return "requests";
  return "files";
}

export function viewOptions(viewer: Viewer, labels: Record<ViewId, string>): Array<{ id: ViewId; label: string }> {
  const ids: ViewId[] = viewer.edition === "personal" ? ["files", "history"] : ["files", "history", "requests"];
  return ids.map((id) => ({ id, label: labels[id] }));
}

/* ---- the header's two-by-three grid (04 §5) ---------------------------- */

export interface HeaderFact {
  key: string;
  label: string;
  fact: Fact<string[] | string | number | null>;
  /** Preflight is the only header cell that is a registered scale; reach is
   *  three modes and a host count, which is a sentence, not a pill. */
  scale?: "preflight";
}

/**
 * Six cells at `enterprise`, four at `personal` — 07 §3 drops *team* and
 * relabels *security groups* as *keys*, so the grid becomes preflight, model,
 * keys, files. The labels arrive from `content/` (05 R8).
 */
export function headerFacts(
  view: HarnessView,
  viewer: Viewer,
  labels: Record<"team" | "preflight" | "model" | "groups" | "keys" | "reach" | "files", string>,
): HeaderFact[] {
  const declared = <T,>(value: T): Fact<T> => ({ value, provenance: "declared" });
  const personal = viewer.edition === "personal";
  const cells: HeaderFact[] = [];
  if (!personal) cells.push({ key: "team", label: labels.team, fact: declared(view.team.name) });
  cells.push({ key: "preflight", label: labels.preflight, fact: view.header.preflight, scale: "preflight" });
  cells.push({ key: "model", label: labels.model, fact: view.header.modelProvider });
  cells.push({ key: "groups", label: personal ? labels.keys : labels.groups, fact: view.header.groups });
  // W5-D7: the same words as the *Applies here* line, because they are the
  // same fact read twice on one screen, and two spellings of one fact is how
  // a person stops trusting either.
  if (!personal) {
    cells.push({
      key: "reach",
      label: labels.reach,
      fact: declared(reachLine(view.reach, viewer, { [view.def.id]: view.def.name })),
    });
  }
  cells.push({ key: "files", label: labels.files, fact: declared(view.header.fileCount) });
  return cells;
}

/* ---- the edit and delete verbs (04 §5) -------------------------------- */

/**
 * A member may change their own harnesses, a team admin the team's and their
 * own, an organization admin any (04 §5). The refusal names who decides; the
 * console never renders the verb disabled (P13, S6).
 */
export function mayEdit(view: HarnessView, viewer: Viewer): boolean {
  // 07 §3: at n = 0 the person is the organization admin, so nothing is refused.
  if (viewer.edition === "personal") return true;
  if (viewer.role.level === "org-admin") return true;
  const at = viewer.role.at;
  if (viewer.role.level === "team-admin" && at !== null) {
    return view.team.path === at || view.team.path.startsWith(`${at}.`);
  }
  // A member may change their *own* harnesses, but `HarnessView` (00 §4.3)
  // carries only the team the harness sits on, never whether it is on the
  // viewer's own branch — so the refusal is rendered and the server decides
  // the write. Reported as a gap in the contract.
  return false;
}

/**
 * 04 §18: for an organization file every option renders the same content, and
 * a one-line note says so rather than leaving the reader to compare.
 */
export function allOrgOwned(rows: HarnessFileRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.owner === "org");
}

/* ---- Differences (03 D32) ---------------------------------------------- */

/**
 * The classification the Differences view renders, computed from the two
 * fetches the control makes — `?version=mine` and `?version=team` — by the
 * asset's tree id and nothing else (03 D32). `conflict` is the server's to
 * declare, because only it knows the composed copy; a row the server marked
 * `conflict` keeps that word.
 */
export function differencesRows(mine: HarnessFileRow[], team: HarnessFileRow[]): HarnessFileRow[] {
  const theirs = new Map(team.map((row) => [row.assetId, row]));
  const rows: HarnessFileRow[] = [];
  for (const row of mine) {
    const other = theirs.get(row.assetId);
    if (!other) rows.push({ ...row, differs: "yours-only" });
    else if (other.tree !== row.tree) rows.push({ ...row, differs: row.differs ?? "both" });
  }
  for (const row of team) {
    if (!mine.some((item) => item.assetId === row.assetId)) rows.push({ ...row, differs: "theirs-only" });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** 04 §5: the conflict badge exists in Differences and nowhere else (P12). */
export function hasConflict(rows: HarnessFileRow[]): boolean {
  return rows.some((row) => row.differs === "conflict");
}

/* ---- time in a cell ----------------------------------------------------- */

/**
 * Minutes precision for a timestamp drawn outside a table. `ui/table`'s
 * `kind: "time"` no longer needs it — it takes the instant and reads it in
 * plain words with the absolute on hover (`lib/views/time.ts`) — so this
 * survives only for the `Fact` cells that print a date themselves.
 */
export function shortTime(value: string | null | undefined): string {
  if (!value) return "";
  return value.length >= 16 ? `${value.slice(0, 10)} ${value.slice(11, 16)}` : value;
}

/* ---- the file page (04 §6) --------------------------------------------- */

export type OwnerLineId = "org" | "team" | "you" | "member";

/** The owner line comes first on the file page (PRD §17.1); its sentence is
 *  `content/screens/file.ts`'s, keyed by the owner word the server sent. */
export function ownerLineId(owner: FileOwner): OwnerLineId {
  return owner.startsWith("member:") ? "member" : (owner as OwnerLineId);
}

export function ownerName(owner: FileOwner): string {
  return owner.startsWith("member:") ? owner.slice("member:".length) : owner;
}

/** 04 §6 (a): the two-column compare is the conflict form, and only that. */
export function isConflict(file: FileView): boolean {
  return file.row.differs === "conflict";
}

/** 04 §6: *This id is assigned but nothing answers it on your chain* (C18). */
export function isUnanswered(file: FileView): boolean {
  return file.content.mine === null && file.content.team === null;
}

/** The file's own content, from the copy the compare control selected. */
export function shownContent(file: FileView, version: VersionId): string | null {
  if (version === "team") return file.content.team ?? file.content.mine;
  return file.content.mine ?? file.content.team;
}

/* ---- both controls, as the bar's tabs (01 §7.5) ----------------------- */

export interface HarnessTab {
  id: string;
  label: string;
  href: string;
  current: boolean;
  /** `version` then `view`: two sets on one bar, drawn apart. */
  group: "version" | "view";
}

/**
 * 04 §5's two controls as links rather than radio groups. Both wrote the URL
 * already (02 rule 16) and neither had any other effect, so a link is the
 * honest element: the browser's back button, a middle click and a copied
 * address all work, and the page stops shipping a client component to do
 * what an `<a>` does.
 *
 * A `member:` version carries `?as` onto the child routes (04 §18); a view
 * keeps whatever `?as` is already set. A compare control with one option is
 * hidden (07 §3), which is why `options` may be null.
 */
export function harnessTabs(
  base: string,
  version: VersionId,
  panel: ViewId,
  options: HarnessVersion[] | null,
  views: Array<{ id: ViewId; label: string }>,
  as: string | null,
): HarnessTab[] {
  function href(next: { version?: VersionId; view?: ViewId }): string {
    const chosen = next.version ?? version;
    const view = next.view ?? panel;
    const search = new URLSearchParams({ version: chosen, view });
    const member = asOf(chosen) ?? (next.version ? null : as);
    if (member) search.set("as", member);
    return `${base}?${search.toString()}`;
  }
  return [
    ...(options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      href: href({ version: option.id }),
      current: option.id === version,
      group: "version" as const,
    })),
    ...views.map((view) => ({
      id: view.id,
      label: view.label,
      href: href({ view: view.id }),
      current: view.id === panel,
      group: "view" as const,
    })),
  ];
}

/**
 * W7-D4: what the first-harness modal asks a **personal** viewer, and nothing
 * else about them. Absent is an enterprise viewer and the dialog it has always
 * had, so the whole of the difference between the two forms is this one prop.
 */
export interface PersonalChoices {
  /** The person's security groups, by name (`GET /v1/console/groups?scope=me`).
   *  *None* is first and chosen, so an empty list is a select of one. */
  groups: string[];
  /** `Viewer.setup` verbatim, read defensively by `modelLine`. */
  setup: Viewer["setup"];
  /**
   * W7-D8: the chain's **harness-scoped** boundaries — the ones a harness can
   * be bound to, by their composed id (`<node path>/<id>`). Every other
   * boundary on the chain already applies to every harness the level holds, so
   * it is not a choice and is not offered. Empty is a real answer and the
   * modal says so in one line rather than drawing an empty control.
   */
  boundaries: Array<{ id: string; value: string; kind: string }>;
}

/**
 * W7-D4: the one read-only line under the first-harness modal's two controls —
 * which model will serve this harness.
 *
 * `Viewer.setup.model` is W7-D2's three states and this is the only reading of
 * them the modal needs: a key, the runtime's own sign-in, or neither. `link`
 * is true only in the last case, because that is the only one where the person
 * has something to go and do; the other two are a fact, and a link beside a
 * fact reads as a warning about it.
 *
 * `setup` is optional on `Viewer` (a server one deploy behind sends none), so
 * an absent one reads as *neither* — which asks for a key that may already be
 * there, and is the half that cannot promise a model this harness has not got.
 */
export function modelLine(
  setup: Viewer["setup"] | undefined,
): { text: string; link: boolean } {
  const model = setup?.model ?? null;
  if (model === "key") return { text: HARNESSES_WORDS.newModelKey, link: false };
  if (model === "sign-in") return { text: HARNESSES_WORDS.newModelSignIn, link: false };
  return { text: HARNESSES_WORDS.newModelNone, link: true };
}
