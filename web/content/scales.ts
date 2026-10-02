/**
 * The `ScaleRegistry` — `docs/console/05-in-platform-docs.md` §4.
 *
 * One entry per `ScaleId` (`content/types.ts`, mirroring console 00 §4.6),
 * every value with its tone and a one-sentence meaning, and the anchor into
 * `/console/how`. `ScaleTag` is the only place a value renders (05 §10); a
 * value not listed here is a registry bug, not a rendering choice.
 *
 * Note on 05 §4's own count: the section header there reads "Thirteen
 * scales, thirty-seven values", but `ScaleId` (console 00 §4.6) and 05 §4's
 * own table both have twelve scales, and the table's values sum to thirty
 * (3+2+3+3+2+2+2+3+2+3+2+3). Console 04 D41 explicitly refuses adding a
 * thirteenth (`sources`) scale, so the table — not the header sentence — is
 * the source of truth here; this file has thirteen scales and thirty-five values,
 * built from `ScaleId`'s own keys so an unlisted or misspelled scale is a
 * type error. See the report to the caller for this discrepancy.
 */
import type { ScaleId, ScaleRegistry } from "./types";

export type { ScaleId } from "./types";

function href<S extends ScaleId>(scale: S): `/console/how#${S}` {
  return `/console/how#${scale}`;
}

export const SCALES = {
  approval: {
    label: "Approval",
    href: href("approval"),
    values: [
      {
        value: "approved",
        tone: "ok",
        meaning: "Anyone this runtime is scoped to may run it and be handed credentials with it.",
      },
      {
        value: "beta",
        tone: "hold",
        meaning:
          "Anyone scoped to it may run it, but only an admin is handed credentials with it — the state for trying a build before committing to it.",
      },
      {
        value: "not-approved",
        tone: "warn",
        meaning: "Nobody may run it. A deliberate no, recorded with its reason so the next person sees it was decided.",
      },
    ],
  },
  source: {
    label: "Comes from",
    href: href("source"),
    values: [
      {
        value: "vault-supplied",
        tone: "accent",
        meaning:
          "We resolve it from a key vault when the session starts, can confirm it beforehand, and can stop supplying it.",
      },
      {
        value: "locally-owned",
        tone: "neutral",
        meaning:
          "A sign-in or machine login the person made. We never hold it, cannot hand it to a harness, and only learn of it once the session is up.",
      },
    ],
  },
  evidence: {
    label: "Evidence",
    href: href("evidence"),
    values: [
      { value: "verified", tone: "ok", meaning: "The platform confirmed it itself, just now." },
      { value: "harness-reported", tone: "hold", meaning: "The runtime says so; we did not check it ourselves." },
      { value: "declared", tone: "neutral", meaning: "Expected and unobserved. Nothing here rounds up." },
    ],
  },
  slot: {
    label: "Slot",
    href: href("slot"),
    values: [
      { value: "satisfied", tone: "ok", meaning: "This need was met before the session started." },
      {
        value: "unsatisfied",
        tone: "warn",
        meaning: "This need was not met and the session will not start until it is. The row says what to do.",
      },
      {
        value: "deferred",
        tone: "hold",
        meaning:
          "It cannot be checked before launch — a sign-in the runtime holds, or a local login the group permits — so it is checked once the session is up and never counted as satisfied.",
      },
    ],
  },
  reach: {
    label: "Outside endpoints",
    href: href("reach"),
    values: [
      {
        value: "prohibited",
        tone: "ok",
        meaning:
          "The harness reaches only what it was granted: its credentialed endpoints and its model provider. The strong claim.",
      },
      {
        value: "allowed",
        tone: "hold",
        meaning:
          "The harness may reach anything not on a boundary. The agent still cannot cross a boundary; the claim is weaker and the tag says so.",
      },
    ],
  },
  holds: {
    label: "Holds",
    href: href("holds"),
    values: [
      {
        value: "enforced",
        tone: "ok",
        meaning: "There is no route, no permission, or the binary is not there. It holds whatever the agent tries.",
      },
      {
        value: "intercepted",
        tone: "hold",
        meaning:
          "Every invocation is checked before it runs. It holds against the thing attempted directly, not the same thing written another way.",
      },
    ],
  },
  loads: {
    label: "How it loads",
    href: href("loads"),
    values: [
      {
        value: "required",
        tone: "accent",
        meaning:
          "Into every session, and no harness can leave it out. Where a compliance rule belongs. It cannot be deleted while it is required.",
      },
      {
        value: "recommended",
        tone: "hold",
        meaning:
          "Every new harness starts with it, and whoever owns that harness may take it out again. A good default, not a rule.",
      },
      {
        value: "on-request",
        tone: "neutral",
        meaning: "Published and available; whoever builds the harness includes it.",
      },
    ],
  },
  role: {
    label: "Role",
    href: href("role"),
    values: [
      {
        value: "member",
        tone: "neutral",
        meaning: "Uses what they are given, offers changes, creates their own harnesses, reads every log about themselves.",
      },
      {
        value: "team-admin",
        tone: "accent",
        meaning:
          "Everything a member may, and may narrow what the team holds: sub-teams, narrower grants, boundaries for the team and below, accepting requests. Widens nothing.",
      },
      {
        value: "org-admin",
        tone: "accent",
        meaning: "Everything. Approves runtimes, connects vaults, creates groups, appoints admins, sets what a person may see.",
      },
    ],
  },
  request: {
    label: "Request",
    href: href("request"),
    values: [
      { value: "open", tone: "hold", meaning: "Waiting on a team admin." },
      { value: "closed", tone: "neutral", meaning: "Decided — accepted, declined or withdrawn — with the reason kept." },
    ],
  },
  session: {
    label: "Session",
    href: href("session"),
    values: [
      { value: "active", tone: "ok", meaning: "Running now, on the credentials it was minted." },
      {
        value: "revoked",
        tone: "warn",
        meaning:
          "Ended by the platform: a policy that covered it changed, or an admin revoked it. The reason is on the session.",
      },
      { value: "closed", tone: "neutral", meaning: "Ended by the person." },
    ],
  },
  preflight: {
    label: "Preflight",
    href: href("preflight"),
    values: [
      {
        value: "passing",
        tone: "ok",
        meaning: "Every check that runs before a session passed the last time it ran, or would pass now.",
      },
      {
        value: "failing",
        tone: "warn",
        meaning: "Something stops it starting. The harness's own page names the cause and links to the thing to change.",
      },
    ],
  },
  /** W6-D6. Three states a person can act on, and each names who acts: a key
   *  to connect, or an endpoint to wait for. *Reachable* named neither. */
  providerStatus: {
    label: "Status",
    href: href("providerStatus"),
    values: [
      {
        value: "set-up",
        tone: "ok",
        meaning:
          "A security group holds a key for it and its endpoint answered just now. Sessions can be routed here.",
      },
      {
        value: "needs-key",
        tone: "warn",
        meaning:
          "No security group holds a key for it, so nothing is routed to it, no runtime can run on it and a session aimed at it is refused. *Set up* connects one.",
      },
      /** W7-D2. Not a warning: nothing is missing. The runtime has its own
       *  login for this provider, so the session runs on the person's own
       *  sign-in and is not metered. */
      {
        value: "sign-in",
        tone: "accent",
        meaning: "Pi signs in to this provider itself (`/login`); add a key to route it through the harness.",
      },
      {
        value: "unreachable",
        tone: "hold",
        meaning:
          "A key is held, but the endpoint did not answer within three seconds. Routing stands; a session will fail until it answers.",
      },
    ],
  },
  provenance: {
    label: "Provenance",
    href: href("provenance"),
    values: [
      { value: "declared", tone: "neutral", meaning: "An admin typed it. Set by a person, in a commit with an author." },
      { value: "observed", tone: "ok", meaning: "Checked as this screen drew, and stored nowhere." },
      {
        value: "derived",
        tone: "accent",
        meaning: "Computed from what is granted, denied and included. Nobody wrote it.",
      },
    ],
  },
} as const satisfies ScaleRegistry;

/** Every `value` that scale `S` may take, kept as literal types so an unregistered
 *  value fails at compile time rather than only at the `ScaleTag` runtime check
 *  (01 D64) — the compile-time half of V1 `scale_registry_is_exhaustive`. */
export type ScaleValue<S extends ScaleId> = (typeof SCALES)[S]["values"][number]["value"];
