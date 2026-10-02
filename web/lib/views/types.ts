/**
 * The one hand-written type file (02 rule 14). It composes console 00 §4's
 * view models; when `@harness/compose/contracts` is published the engine
 * types marked below are imported by name from it instead of declared here.
 */

/* ---- console 00 §4.1 — scope and viewer ------------------------------- */

export type Scope =
  | { kind: "org" }
  | { kind: "team"; path: string }
  | { kind: "me" }
  | { kind: "platform" };

export type NavKey =
  | "harnesses"
  | "assets"
  | "groups"
  | "boundaries"
  | "providers"
  | "vaults"
  | "sessions"
  | "logs"
  | "endpoints"
  | "people"
  | "teams"
  | "account"
  | "how";

export interface Viewer {
  user: { id: string; email: string; name: string };
  role: { level: "member" | "team-admin" | "org-admin"; at: string | null };
  edition: "personal" | "enterprise";
  staff: boolean;
  teams: Array<{ path: string; name: string; admin: boolean }>;
  /** W5-D15 adds `store`: an organisation may turn the Assets screen's
   *  *Browse* tab off. Default true, and on for a personal account. */
  visibility: { boundaries: boolean; logs: boolean; store?: boolean };
  waiting: Partial<Record<NavKey, number>>;
  /**
   * Whether the viewer administers **the scope this viewer was fetched for**
   * (01 §4.2): what the sidebar (01 §4.4) and the level chip read. It is
   * `ctx.admin_here` on `/v1/console/me?scope=`, so `loadViewer` must pass
   * the scope — a viewer fetched with none is computed for *me*, where it is
   * always true. Hand-written here, not generated: `openapi.json` and
   * `api.generated.ts` are regenerated once per wave by the coordinator.
   */
  adminHere: boolean;
  /**
   * W7-D5: the *Getting started* list's live state, derived per read. A fact
   * about the person, not the scope. `model` is W7-D2's: `key` when a security
   * group holds the default provider's key, `sign-in` when no key is held and
   * a runtime this organisation lists signs in to that provider itself, `null`
   * when there is no default or it is neither — which is when the list still
   * has something to ask for. Optional here: a server one deploy behind sends
   * no `setup` and the list reads *nothing done yet*, which is the safe half.
   * Hand-written, like `adminHere`: the coordinator regenerates OpenAPI.
   */
  setup?: {
    installed: boolean;
    loggedIn: boolean;
    model: "key" | "sign-in" | null;
    harness: boolean;
  };
}

/* ---- console 00 §4.2 — provenance, hiding, columns --------------------- */

export type Provenance = "declared" | "observed" | "derived";

export interface Fact<T> {
  value: T;
  provenance: Provenance;
  at?: string;
  by?: string;
}

export type Hidden = Record<string, string>;

export interface Column<Row> {
  key: keyof Row & string;
  heading: string;
  kind: "text" | "number" | "time" | "scale" | "related" | "fact";
  unit?: Related["unit"];
  scale?: ScaleId;
  help?: string;
  sort?: "asc" | "desc" | false;
  width?: string;
}

/* ---- console 00 §4.4, §4.6, §4.7 --------------------------------------- */

export interface DiffHunk {
  header: string;
  lines: Array<{ kind: "ctx" | "add" | "del"; text: string }>;
}

export type ScaleId =
  | "approval"
  | "source"
  | "evidence"
  | "slot"
  | "reach"
  | "holds"
  | "loads"
  | "role"
  | "request"
  | "session"
  | "preflight"
  /** W6-D6: the Model providers table's *Status*. */
  | "providerStatus"
  | "provenance";

export type Tone = "ok" | "hold" | "warn" | "accent" | "neutral";

export interface ScaleTag {
  scale: ScaleId;
  value: string;
}

export type ScaleRegistry = Record<
  ScaleId,
  {
    label: string;
    values: Array<{ value: string; tone: Tone; meaning: string }>;
    href: `/console/how#${ScaleId}`;
  }
>;

export interface Related {
  unit: "teams" | "harnesses" | "groups" | "secrets" | "assets" | "providers" | "people";
  items: Array<{ id: string; label: string; href: string }>;
  all?: true;
}

/* ---- engine 00 §4 — imported by name once the contracts slice exists --- */

/** engine 00 §4.7. */
export interface Blocker {
  code: string;
  message: string;
  remedy: string;
  link?: string;
}

/** engine 00 §4: `Icon` — a 16×16 drawing. `.` is a transparent pixel. */
export interface PixelIcon {
  palette: string[];
  rows: string[];
}
