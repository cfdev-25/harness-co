/**
 * `PermissionNotCleared` sentences — `docs/console/05-in-platform-docs.md` §7
 * and every `PermissionNotCleared` line in `docs/console/04-screens.md`.
 *
 * One file holds them all, and every name a sentence needs is a placeholder:
 * `{team}` is the team the refusal is about and `{admin}` is the person who
 * decides. 05 §7 authored its ten against the fixture names (Marketing, Rae
 * Lindqvist, Dana Okafor) and says they are "substituted from the viewer's
 * chain at render" (R10); the substitution step is `fill()` in
 * `lib/views/refusals.ts`, the one place it happens.
 *
 * Two families of id, because 05 and 04 are two documents:
 *  - `<verb>.<role>` — 05 §7's ten, which carry an `ask` line saying where
 *    the ask goes.
 *  - `<screen>.<verb>` — 04's sentences, verbatim, which are what a screen
 *    renders in the space the verb would have occupied (04 §19's usage rule).
 * Where the two overlap (accepting a request, creating a group) the wordings
 * differ by a few words; both are kept, because 05 §7's is the explanatory
 * one with the ask and 04's is the one the screen's V3 test names. Reported.
 */

export interface Refusal {
  sentence: string;
  ask?: { label: string; where: string };
}

export const REFUSALS = {
  // ---- 05 §7: the ten sentences that carry an ask -------------------------
  "accept_request.member": {
    sentence: "Accepting a request publishes it to everyone on {team}, so a {team} admin decides it.",
    // no ask: the request is already in the deciding admin's queue (05 §7).
  },
  "narrow_group.member": {
    sentence: "Narrowing a security group hands part of it to a sub-team, so a {team} admin does it.",
    ask: { label: "Ask {admin}", where: "opens a message with the group named" },
  },
  "add_boundary.member": {
    sentence: "A boundary applies to everyone in {team} and below, so a {team} admin adds it.",
    // 05 §7 gives no "→" clause for this row; "where" is authored to match
    // the pattern of the rows that do specify one (see report to caller).
    ask: { label: "Ask {admin}", where: "opens a message with the boundary named" },
  },
  "approve_provider.team_admin": {
    sentence:
      "Approving a runtime decides whose program holds credentials for the whole organization, so an organization admin decides it.",
    ask: { label: "Ask {admin}", where: "the request appears in the organization's People screen" },
  },
  "appoint_admin.team_admin": {
    sentence: "Team admin is granted from above, so an organization admin appoints one. Anyone may ask.",
    ask: {
      label: "Ask to be an admin",
      where: "the request appears in {team}'s People screen marked with the admin it waits on",
    },
  },
  "lift_org_boundary.any": {
    sentence:
      "An organization boundary only tightens on the way down. Nobody below the organization can lift it; an organization admin can remove it there.",
    ask: { label: "Ask {admin}", where: "opens a message with the boundary named" },
  },
  "read_member_branch.member": {
    sentence: "Another member's versions are theirs. A {team} admin can read them; you can read yours and the team's.",
    // no ask (05 §7: "—").
  },
  "revoke_session.other": {
    sentence: "This session is {owner}'s. Their team's admin, or an organization admin, can end it.",
    ask: { label: "Ask {admin}", where: "opens a message with the session named" },
  },
  "create_group.team_admin": {
    sentence:
      "A security group names a secret and who may mint it, so an organization admin creates one. Narrowing what {team} already holds covers most of what people ask for.",
    ask: { label: "Ask {admin}", where: "opens a message naming the group needed" },
  },
  "change_sources.team_admin": {
    sentence:
      "Which sources a group accepts is the rule that stops it resolving from somebody's laptop, so an organization admin changes it.",
    ask: { label: "Ask {admin}", where: "opens a message naming the group and the change needed" },
  },

  // ---- 04: the sentence each screen renders where the verb would be -------
  "harness.change": {
    sentence: "Changing a team harness is a team admin's decision.",
  },
  "requests.accept": {
    sentence: "Accepting a request publishes it to everyone on {team}, so a team admin decides it.",
  },
  "groups.create": {
    sentence:
      "Creating a security group, or adding an entry to one, is an organization admin's decision. Narrowing what {team} already holds covers most of what people ask for.",
  },
  "groups.narrow": {
    sentence: "Narrowing a group into a sub-team is a team admin's decision.",
  },
  "boundaries.lift": {
    sentence:
      "Lifting an organization boundary is nobody's decision below the organization. Boundaries only ever tighten on the way down.",
  },
  "boundaries.add": {
    sentence: "Adding a boundary is a team admin's decision.",
  },
  "providers.approve": {
    sentence:
      "Approving a runtime is an organization admin's decision: it decides whose program holds a credential in memory.",
  },
  "providers.routing": {
    sentence: "Choosing a team's default is a team admin's decision.",
  },
  "vaults.read": {
    sentence: "Key vaults are an organization admin's screen.",
  },
  "assets.loads": {
    sentence: "How an organization asset loads is an organization admin's decision.",
  },
  "sessions.revoke": {
    sentence: "Revoking a session is a team admin's decision. Close it yourself with Ctrl-C.",
  },
  "people.appoint": {
    sentence:
      "Appointing a team admin is an organization admin's decision. Anyone may ask; the request appears above.",
  },
  "people.invite": {
    sentence: "Inviting is a team admin's decision.",
  },
  "people.visibility": {
    sentence: "Whether someone sees boundaries and logs is an organization admin's decision.",
  },
} as const satisfies Record<string, Refusal>;

/** `RefusalId` is the union of keys in 05 §7 and 04's screen tables. */
export type RefusalId = keyof typeof REFUSALS;

/** The ten 05 §7 authored, each of which names who decides and where to ask. */
export const ASKING_REFUSALS = [
  "accept_request.member",
  "narrow_group.member",
  "add_boundary.member",
  "approve_provider.team_admin",
  "appoint_admin.team_admin",
  "lift_org_boundary.any",
  "read_member_branch.member",
  "revoke_session.other",
  "create_group.team_admin",
  "change_sources.team_admin",
] as const satisfies readonly RefusalId[];
