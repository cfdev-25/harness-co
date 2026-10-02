/**
 * Sessions — console 04 §13 (engine 04 §6, 00 D7). One module for the
 * `SessionRow` list columns and the `Slot` table columns on the session
 * page — `slot*` prefixes the latter so both live in one `Column` union.
 *
 * Personal edition (07 §3): the person is the admin, so `revoke` renders as
 * `endSession` ("end session remains") rather than `PermissionNotCleared`.
 */
import type { ScreenContent } from "../types";

export type SessionsColumn =
  | "person"
  | "harness"
  | "provider"
  | "model"
  | "status"
  | "started"
  | "lastActive"
  | "endpoints"
  | "slotNeed"
  | "slotState"
  | "slotEvidence"
  | "resolvedFrom"
  | "via"
  | "blocker"
  | "refusedTool"
  | "refusedSaid"
  | "refusedBoundary"
  | "refusedSetBy"
  | "refusedWhen";
export type SessionsVerb = "revoke" | "endSession";

export const SESSIONS: ScreenContent<SessionsColumn, SessionsVerb, "sessions" | "session.endpoints"> = {
  title: "Sessions",
  lede: "A session is one run of an assistant under a harness.",
  columns: {
    person: { heading: "Person", help: "Who ran this session." },
    harness: { heading: "Harness", help: "Which harness the session ran under, if any." },
    provider: { heading: "Provider", help: "The runtime and version the session ran in." },
    model: { heading: "Model", help: "The model provider and model the session used." },
    status: { heading: "Status", scale: "session", help: "Whether the session is running, was revoked, or was closed." },
    started: { heading: "Started", help: "When the session began." },
    lastActive: { heading: "Last active", help: "The last time this session did anything, checked just now while it runs." },
    endpoints: { heading: "Endpoints", help: "How many hosts this session reached, and how many it was refused." },
    // W6-D9: the tool calls a boundary refused. An `intercepted` boundary is
    // held by the runtime at the moment of the call, so this is the only
    // record there is that it did its job.
    refusedTool: { heading: "Tool", help: "The tool whose call the boundary refused." },
    refusedSaid: { heading: "What was attempted", help: "What the session said it was about to do." },
    refusedBoundary: { heading: "Boundary", help: "The boundary that refused it. Its pattern and its reason are on Boundaries." },
    refusedSetBy: { heading: "Set by", help: "The level that set the boundary, and the only one that can lift it." },
    refusedWhen: { heading: "When", help: "When the call was refused." },
    slotNeed: { heading: "Need", help: "What this slot supplies — a credential, an asset, or a login." },
    slotState: { heading: "State", scale: "slot", help: "Whether this need was met before the session started." },
    slotEvidence: { heading: "Evidence", scale: "evidence", help: "How we know this slot's state is true." },
    resolvedFrom: { heading: "Resolved from", help: "Which source actually supplied this slot for this session." },
    via: { heading: "Via", help: "The group and sources rule that allowed a deferred slot to be checked locally." },
    blocker: { heading: "Blocker", help: "What stopped this slot resolving, and what to do about it." },
  },
  verbs: {
    revoke: {
      label: "Revoke",
      explain: "Ends this session at once: its credentials are refused and its provider is stopped within one tick.",
    },
    endSession: {
      label: "End session",
      explain: "Ends this session at once: its credentials are refused and its provider is stopped within one tick.",
    },
  },
  empty: "sessions",
};

/** 05 R8's strings for the list and the session page. */
export const SESSIONS_WORDS = {
  filters: { person: "Person", harness: "Harness", status: "Status", any: "Any", apply: "Filter" },
  notMetered: "not metered",
  countOne: "1 session",
  countMany: "{n} sessions",
  reached: "reached",
  refused: "refused",
  cards: {
    preflight: "Preflight report",
    slots: "Slots",
    reach: "Reach",
    endpoints: "Endpoints reached",
    /** W6-D9. Shown only when there is one: a session with nothing refused
     *  says nothing, because an empty card reads like a feature that failed. */
    refusals: "Refused by a boundary",
    definitions: "Definitions",
    revoked: "Revoked",
  },
  resolved: { group: "group", via: "via grant", vault: "vault", local: "local" },
  refusalsLede:
    "A command boundary is held by the runtime as the call is made, so this is the whole record of it. The pattern and the reason are on Boundaries → Commands.",
  reach: {
    /** D131: the composed reach the plan carried. A report written before
     *  Plan has none, and says so rather than guessing at `off` — the same
     *  words the CLI's own report prints. */
    reach: "Reach",
    notDecided: "not decided yet",
    model: "Model endpoint",
    deny: "Denied",
    host: "Host",
    provider: "provider",
    what: "What",
    decidedBy: "Decided by",
    heading: "Reach",
    /** Was *They are not enforced yet* (06 K-M3). Engine D133 made every row
     *  on this card enforced: `routable()` holds the session to `plan.hosts`
     *  and `plan.reach`, `denied()` to `plan.deny`, and a refusal is a row in
     *  Endpoints. The old sentence had become the one false thing on the
     *  card. 06's K-M4 clause for the reach table is reached; the rest of
     *  K-M4 (the sandbox facts) is not. */
    enforced: "These are what the session was given, and the proxy held it to them.",
  },
  report: {
    none: "This session's CLI did not post its preflight report; slots and endpoints are still recorded.",
    blockers: "Blockers",
    drift: "Drift",
    choices: "Choices",
    driftFile: "File",
    driftExpected: "Expected",
    driftActual: "Actual",
    provider: "Runtime",
    harness: "Harness",
    model: "Model",
    grants: "Grants",
    reach: "Reach",
    openLink: "Open",
  },
  endpointsColumns: {
    host: "Host",
    port: "Port",
    alias: "Alias",
    count: "Reached",
    refused: "Refused",
    firstAt: "First",
    lastAt: "Last",
  },
  commits: { ref: "Ref", commit: "Commit" },
  head: { started: "Started", lastActive: "Last active", closed: "Closed" },
  revoke: {
    title: "Revoke this session",
    reason: "Why you are revoking it",
    takes: "The session's proxy will refuse every credential and the provider will be stopped within one tick.",
    confirm: "Revoke",
    cancel: "Cancel",
  },
  // 04 §13's refusal, verbatim.
  refusal: "Revoking a session is a team admin's decision. Close it yourself with Ctrl-C.",
} as const;
