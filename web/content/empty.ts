/**
 * Empty states and hidden-view notes — `docs/console/05-in-platform-docs.md` §8.
 *
 * `EMPTY` holds one entry per row of 05 §8's table (23 rows) plus the
 * personal-edition Harnesses (me) empty state from `docs/console/
 * 07-personal-edition.md` §2, edition-keyed per D71 as `"harnesses.me.
 * personal"` rather than a second screen or a component prop.
 *
 * 05 §8's table is the floor, not the ceiling: a screen whose scope or
 * edition 05 wrote no row for adds a key here rather than keeping a sentence
 * of its own, and `test/unit/content.test.ts` asserts *at least* the
 * documented keys. `boundaries.me`, `groups.me` and `logs.scope` came in that
 * way, from 04 §9, §8 and §14.
 *
 * Two further entries exist beyond that 24, added because `ScreenContent.
 * empty` (05 §3) is a required field on every `screens/<screen>.ts` module
 * and two screens have no matching row in 05 §8's table:
 *  - `file.content`: console 04 §6's File screen empty state ("This id is
 *    assigned but nothing answers it on your chain", engine C18) — 05 §13
 *    lists `file` as an `empty`-consumer but 05 §8's table has no File row.
 *  - `how`: console 04 §16 says How this works is never empty ("Empty:
 *    impossible — the registry is static"), which is in tension with
 *    `empty` being required on every screen's content; this entry exists
 *    only to satisfy that type and is not expected to render.
 * Reported to the caller as a gap in 05 rather than silently dropping the
 * `empty` field from those two screens' types.
 *
 * `HIDDEN` holds the two notes P10 requires, keyed by `Viewer["visibility"]`'s
 * own fields so an unknown visibility flag is a type error.
 */
import type { Visibility } from "./types";

export interface EmptyState {
  sentence: string;
  verb?: { label: string; href?: string; command?: string };
}

export const EMPTY = {
  "harnesses.me": {
    sentence: "You have no harnesses yet. One starts empty and inherits everything you already hold.",
    verb: { label: "New harness" },
  },
  // D71: the personal-edition rendering of the same screen (07 §2, §3) — an
  // edition-keyed entry, not a second screen.
  "harnesses.me.personal": {
    sentence:
      'Nothing here yet. Install the CLI and run `harness import claude` to bring what you already have, or `harness new` to start one.',
    verb: { label: "Import", command: "harness import claude" },
  },
  "harnesses.team": {
    sentence: "Marketing has no harnesses yet.",
    verb: { label: "New harness" },
  },
  "harness.files": {
    sentence: "Nothing is in this harness yet. Add something you already have, or start a session and adopt what you make.",
    verb: { label: "Adopt", command: "harness adopt ./my-tool" },
  },
  "harness.requests": {
    sentence: "No requests. Offering a change from your version opens one here.",
    verb: { label: "Offer", command: 'harness offer <path> --message "…"' },
  },
  "harness.history": {
    sentence: "No versions yet. The first `harness push` starts the history.",
  },
  "requests.closed": {
    sentence: "Nothing has been decided yet.",
  },
  sessions: {
    sentence: "No sessions yet. `harness run` starts one, and it appears here within a few seconds.",
    verb: { label: "Run", command: "harness run pi" },
  },
  "session.endpoints": {
    sentence: "This session has not reached anything yet.",
  },
  "groups.org": {
    sentence: "No security groups yet. A group is a named set of credentials a team can be given.",
    verb: { label: "Create a group" },
  },
  "groups.team": {
    sentence: "Marketing holds no security groups yet. An organization admin grants one.",
  },
  grants: {
    sentence: "Nothing is granted to this team yet.",
    verb: { label: "Grant a group" },
  },
  "boundaries.org": {
    sentence: "No boundaries yet. Nothing is restricted beyond the organization's runtime approvals.",
    verb: { label: "Add a boundary" },
  },
  "boundaries.team": {
    sentence: "Marketing adds no boundaries of its own. The organization's apply.",
    verb: { label: "Add a boundary" },
  },
  providers: {
    sentence: "No runtime is approved yet, so nobody can start a session.",
    verb: { label: "Approve a runtime" },
  },
  "providers.model": {
    sentence: "No model provider yet, so a session has nowhere to send a request.",
    verb: { label: "Add a model provider" },
  },
  vaults: {
    sentence: "No key vault is connected. The one we host is ready to use.",
    verb: { label: "Connect a vault" },
  },
  "vault.secrets": {
    sentence: "We cannot list what is inside this vault; it shows what an admin declared.",
  },
  "assets.org": {
    sentence: "No organization assets yet. Anything here reaches every team.",
    verb: { label: "Add an asset" },
  },
  // W5-D9: Assets is one screen at every level, and a level with nothing on
  // its branch says so in its own words. 05 §8 has only the organization's
  // row; these two came in the way `boundaries.me` did.
  "assets.team": {
    sentence: "Nothing on this team's branch yet. What the organization holds still reaches you.",
  },
  "assets.me": {
    sentence: "Nothing on your own branch yet. What your team and your organization hold still reaches you.",
  },
  logs: {
    sentence: "Nothing recorded yet in this category.",
  },
  endpoints: {
    sentence: "No harness has reached an endpoint yet.",
  },
  people: {
    sentence: "Just you. Adding someone to a team is the grant.",
    verb: { label: "Invite" },
  },
  teams: {
    sentence: "No teams yet. A team is a branch everything on it inherits.",
    verb: { label: "New team" },
  },
  "account.logins": {
    sentence: "No runtime is signed in on this machine.",
    verb: { label: "Sign in", command: "harness auth claude" },
  },
  // 05 §8 has no `me` row for the three screens below, and 04 §9, §8 and §14
  // each give the sentence; they lived in `content/screens/` because this
  // file's key count was asserted exactly. The count assertion is now "at
  // least the documented keys" (05 §8: `EMPTY` may grow), so they live here
  // with every other empty state.
  "boundaries.me": {
    sentence: "No boundaries reach you. The agent may reach whatever its grants allow.",
  },
  "groups.me": {
    sentence:
      "No security group covers you yet. A team you are on is given one, and you get it with them.",
  },
  /** 04 §14: the filtered-empty state names the filter (02 rule 27). */
  "logs.scope": {
    sentence: "Nothing recorded yet for {scope}.",
  },
  // The two additions beyond 05 §8's 24 — see the module comment above.
  "file.content": {
    sentence: "This id is assigned but nothing answers it on your chain.",
  },
  how: {
    sentence: "This registry is fixed; there is never nothing to show.",
  },
} as const satisfies Record<string, EmptyState>;

export type EmptyId = keyof typeof EMPTY;

/** P10: the note `HiddenView` renders in place of a list an org admin has
 *  hidden from a member, keyed by the field that is hidden. */
export const HIDDEN = {
  boundaries: "Your organization has chosen not to show boundaries to members. A refusal you meet will still say which boundary it was.",
  logs: "Your organization has chosen not to show members their own logs.",
  store: "Your organization has chosen not to show members the store. What already reaches you is unchanged.",
} as const satisfies Record<keyof Visibility, string>;
