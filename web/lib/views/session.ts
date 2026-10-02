import type { Blocker, Fact, Viewer } from "./types";
import { when } from "./cells";
import { levelLabel } from "./level";
import { type EffectiveReach, reachSaid, scopeOfNode, setByLabel } from "./reach";

/**
 * Sessions' view models (console 00 §4.5, engine 00 §4.6–§4.7) and the pure
 * functions the list and the session page render with. Nothing here fetches;
 * every function is V1-tested beside this file.
 *
 * As in `harness.ts`, the shapes are declared rather than imported from
 * `lib/api.generated.ts`, whose `slots`, `preflight` and `endpointsTally` are
 * open `dict[str, Any]`.
 */

export interface SessionRow {
  id: string;
  person: { id: string; name: string };
  harness: { id: string; name: string } | null;
  provider: { id: string; version: string };
  model: { provider: string; model: string };
  status: "active" | "revoked" | "closed";
  startedAt: string;
  lastActiveAt: string;
  closedAt?: string | null;
  endpoints: { reached: number; refused: number };
}

export type SlotState = "satisfied" | "unsatisfied" | "deferred";
export type Evidence = "verified" | "harness-reported" | "declared";

export type ResolvedFrom =
  | { source: "vault"; vault: string; group: string; grant: string }
  | { source: "local"; tool: string }
  | null;

export interface Slot {
  need: { kind: "credential" | "asset" | "login"; alias?: string; name?: string; tool?: string };
  state: SlotState;
  evidence: Evidence;
  resolvedFrom: ResolvedFrom;
  via?: { grant: string; group: string; sources: string };
  blocker?: Blocker;
}

export interface Drift {
  file: string;
  expected: unknown;
  actual: unknown;
}

export interface PreflightReport {
  sessionId: string;
  at: string;
  composed?: { commit: Record<string, string>; tree: string; conflicts: unknown[] };
  choices?: {
    provider?: { id: string; approval?: string; pin?: { repo?: string; commit?: string } };
    harness?: { id: string; name: string } | null;
    model?: { provider: string; model: string; wireFormat?: string; endpoint?: string };
    grants?: Array<{ id: string; group?: string }>;
    native?: boolean;
    view?: string;
  };
  slots: Slot[];
  drift: Drift[];
  passing: boolean;
  blockers: Blocker[];
  /** engine 00 §4.5's `SpawnPlan`, when the CLI put it in the report. It is
   *  the only source of the session's reach, its credentialed hosts and its
   *  deny rows; `SessionView` (console 00 §4.5) carries none of them.
   *  Reported. `reach` is D131's composed answer; the report's old
   *  outside-endpoints boolean is retired with the grant it derived from
   *  (W5-D1b). */
  plan?: { hosts?: string[] | "any"; deny?: string[]; reach?: EffectiveReach };
}

export interface EndpointTally {
  host: string;
  port: number;
  alias?: string;
  count: number;
  refused: number;
  firstAt: string;
  lastAt: string;
}

export interface SessionView extends SessionRow {
  commits: Record<string, string>;
  slots: Slot[];
  preflight: PreflightReport | null;
  endpointsTally: EndpointTally[];
  revokedReason?: string | null;
  hidden?: Record<string, string> | null;
  /** W6-D9. Hand-written here with `Refusal`, until the coordinator
   *  regenerates `api.generated.ts`. */
  refusals?: Refusal[];
}

/* ---- the list ----------------------------------------------------------- */

/** P16, engine C22: a native session is not metered; it never reads `0`. */
export function isNative(session: SessionRow): boolean {
  return !session.model.provider;
}

export function modelCell(session: SessionRow, notMetered: string): string {
  if (isNative(session)) return notMetered;
  return `${session.model.provider} ${session.model.model}`.trim();
}

export function providerCell(session: SessionRow): string {
  return `${session.provider.id} ${session.provider.version}`.trim();
}

/** 04 §13's Endpoints column: *reached n · refused m*, in the screen's words. */
export function endpointsCell(session: SessionRow, words: { reached: string; refused: string }): string {
  return `${words.reached} ${session.endpoints.reached} · ${words.refused} ${session.endpoints.refused}`;
}

/**
 * *Last active* is observed for a running session and declared once it has
 * ended (P2): only a live session is re-read as the screen draws.
 */
export function lastActiveFact(session: SessionRow): Fact<string> {
  return session.status === "active"
    ? { value: session.lastActiveAt, provenance: "observed", at: session.lastActiveAt }
    : { value: session.lastActiveAt, provenance: "declared" };
}

export interface SessionFilters {
  person?: string;
  harness?: string;
  status?: SessionRow["status"];
}

/** The list's three filters are URL state (02 rule 16), read once here. */
export function readFilters(params: Record<string, string | string[] | undefined>): SessionFilters {
  const one = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  const status = one("status");
  return {
    person: one("person"),
    harness: one("harness"),
    status: status === "active" || status === "revoked" || status === "closed" ? status : undefined,
  };
}

export function sessionsQuery(filters: SessionFilters): string {
  const search = new URLSearchParams();
  if (filters.person) search.set("person", filters.person);
  if (filters.harness) search.set("harness", filters.harness);
  if (filters.status) search.set("status", filters.status);
  const query = search.toString();
  return query ? `?${query}` : "";
}

/* ---- the session page --------------------------------------------------- */

/**
 * The slots the table draws. `SessionView.slots` is the record's, and `api`
 * rebuilds each one's `need` as `{ kind: "credential", alias }` from the
 * jsonb's key — the record holds provenance only (engine 04 B6), so a `login`
 * or `asset` slot comes back mislabelled as a credential. The CLI's posted
 * report carries the engine's own `Slot[]` with the real `need`, so it is
 * preferred when present and the record is the fallback. Reported as a
 * contract problem; when `api` keeps the need this reads `session.slots`.
 */
export function slotsOf(session: SessionView): Slot[] {
  const posted = session.preflight?.slots;
  if (posted && posted.length === session.slots.length) return posted;
  return session.slots;
}

/** The slot table's Need cell: `credential:<alias>` · `asset:<name>` · `login:<tool>`. */
export function needCell(slot: Slot): string {
  const what = slot.need.alias ?? slot.need.name ?? slot.need.tool ?? "";
  return what ? `${slot.need.kind}:${what}` : slot.need.kind;
}

/**
 * *Resolved from* is the one field that makes a chain reviewable (engine
 * §4.6), and it never carries a value — only where the value came from and
 * why the person was allowed it.
 */
export function resolvedFromCell(slot: Slot, words: { group: string; via: string; vault: string; local: string }): string {
  const from = slot.resolvedFrom;
  if (!from) return "";
  if (from.source === "local") return `${words.local}: ${from.tool}`;
  return `${words.group} ${from.group} ${words.via} ${from.grant} · ${words.vault} ${from.vault}`;
}

/** `via` is set on a deferred slot the broker chose a grant for (engine D60). */
export function viaCell(slot: Slot): string {
  return slot.via ? `${slot.via.group} · ${slot.via.sources}` : "";
}

export interface SlotRow {
  key: string;
  need: string;
  state: SlotState;
  evidence: Evidence;
  resolvedFrom: string;
  via: string;
  blocker: string;
}

export function slotRows(
  slots: Slot[],
  words: { group: string; via: string; vault: string; local: string },
): SlotRow[] {
  return slots.map((slot, index) => ({
    key: `${needCell(slot)}-${index}`,
    need: needCell(slot),
    state: slot.state,
    evidence: slot.evidence,
    resolvedFrom: resolvedFromCell(slot, words),
    via: viaCell(slot),
    blocker: slot.blocker ? `${slot.blocker.message} ${slot.blocker.remedy}` : "",
  }));
}

/* ---- the reach card (04 §13 (3)) ---------------------------------------- */

/**
 * W6-D9 — one tool call a boundary refused during this session, hand-written
 * until the coordinator regenerates `api.generated.ts` (wave 6's rule).
 *
 * It is the only record there is of an `intercepted` boundary doing its job:
 * the runtime refuses the call as it is made, so nothing the fence or the
 * proxy logs would ever show it.
 */
export interface Refusal {
  tool: string;
  said: string;
  /** The composed boundary id, `<node path>/<id>`. */
  boundary: string;
  at?: string | null;
}

export interface RefusalRow {
  key: string;
  tool: string;
  said: string;
  /** The boundary's own id, without the node path it is prefixed with. */
  boundary: string;
  setBy: string;
  when: string;
}

/** The refusals as the table reads them: the composed id split back into the
 *  level that set the boundary and the boundary itself, because *who decides
 *  this* is the question a person has at a refusal (PRD §16). */
export function refusalRows(refusals: Refusal[], viewer: Viewer): RefusalRow[] {
  return refusals.map((one, index) => {
    const at = one.boundary.lastIndexOf("/");
    const node = at === -1 ? "" : one.boundary.slice(0, at);
    return {
      key: `${one.boundary}-${index}`,
      tool: one.tool,
      said: one.said,
      boundary: at === -1 ? one.boundary : one.boundary.slice(at + 1),
      setBy: node ? levelLabel(scopeOfNode(node), viewer) : "",
      when: when(one.at ?? undefined),
    };
  });
}

export interface ReachRow {
  key: string;
  what: string;
  decidedBy: string;
}

/**
 * PRD §7: the union is computed on the harness, and every row names the
 * object that decided it. The first row is D131's composed reach, off
 * `SpawnPlan.reach` — the mode, the host count and the node that last
 * narrowed it — because that is now the whole of how far a session went;
 * the choices' old outside-endpoints boolean was a grant, and the grant is
 * retired (W5-D1b).
 * A report written before Plan carries no reach and says *not decided yet*
 * rather than guessing at `off`, exactly as the CLI's own report does.
 *
 * `SpawnPlan.hosts` and `.deny` are not in `SessionView` (00 §4.5), so the
 * hosts and deny rows are rendered only when the CLI put them in the report.
 * The card's old *not enforced yet* label is gone: engine D133 enforces every
 * row it carries (06 K-M4's reach clause).
 */
export function reachRows(
  report: PreflightReport | null,
  words: { reach: string; notDecided: string; model: string; deny: string; host: string; provider: string },
  viewer: Viewer,
): ReachRow[] {
  if (!report?.choices) return [];
  const choices = report.choices;
  const rows: ReachRow[] = [];
  const reach = report.plan?.reach ?? null;
  rows.push({
    key: "reach",
    what: `${words.reach}: ${reach ? reachSaid(reach) : words.notDecided}`,
    decidedBy: reach ? setByLabel(reach.setBy, viewer) : "",
  });
  if (choices.model?.endpoint) {
    rows.push({
      key: "model",
      what: `${words.host} ${hostOf(choices.model.endpoint)}`,
      decidedBy: `${words.provider} ${providerId(choices.model.provider)}`,
    });
  }
  const plan = report.plan;
  const modelHost = choices.model?.endpoint ? hostOf(choices.model.endpoint) : null;
  for (const host of Array.isArray(plan?.hosts) ? plan.hosts : []) {
    if (host === modelHost) continue; // already the model row above
    rows.push({ key: `host-${host}`, what: `${words.host} ${host}`, decidedBy: "" });
  }
  for (const host of plan?.deny ?? []) {
    rows.push({ key: `deny-${host}`, what: `${words.deny} ${host}`, decidedBy: "" });
  }
  return rows;
}

export function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/* ---- verbs (04 §13) ------------------------------------------------------ */

/**
 * Revoke is a team admin's or an organisation admin's (04 §13). At
 * `edition: "personal"` the person is the admin, so the verb stays and reads
 * *End session* (07 §3) — it is never a refusal against yourself.
 */
export function mayRevoke(session: SessionView, viewer: Viewer): boolean {
  if (session.status !== "active") return false;
  if (viewer.edition === "personal") return true;
  if (viewer.role.level === "org-admin") return true;
  return viewer.role.level === "team-admin" && viewer.role.at !== null;
}

export function revokeLabel(viewer: Viewer, labels: { revoke: string; endSession: string }): string {
  return viewer.edition === "personal" ? labels.endSession : labels.revoke;
}

/** The posted report carries the whole `ModelProvider`; a fixture or an older CLI carries its id. */
export function providerId(provider: unknown): string {
  if (typeof provider === "string") return provider;
  const id = (provider as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : "—";
}
