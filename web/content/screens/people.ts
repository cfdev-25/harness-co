/**
 * People and teams — console 04 §15. One module for `PersonRow` and
 * `TeamRow` columns (`00 §5` treats `/people`, `/people/[id]` and `/teams`
 * as one screen row); `teamsPeople` avoids colliding with `PersonRow`'s own
 * `teams` column.
 */
import type { ScreenContent } from "../types";

export type PeopleColumn =
  | "name"
  | "email"
  | "teams"
  | "role"
  | "state"
  | "lastActive"
  | "team"
  | "inside"
  | "contains"
  | "teamsPeople"
  | "groups"
  | "admins";
export type PeopleVerb =
  | "invite"
  | "cancelInvite"
  | "remove"
  | "newSubTeam"
  | "askToBeAdmin"
  | "appointAdmin"
  | "revokeAdmin"
  | "deactivate"
  | "visibilitySwitch";

export const PEOPLE: ScreenContent<PeopleColumn, PeopleVerb, "people" | "teams"> = {
  title: "People",
  lede: "Adding someone to a team is the grant.",
  columns: {
    name: { heading: "Name", help: "The person's name." },
    email: { heading: "Email", help: "The person's email address." },
    teams: { heading: "Teams", unit: "teams", help: "Which teams this person is on." },
    role: { heading: "Role", scale: "role", help: "What this person may do." },
    state: { heading: "State", help: "Whether this person is active, invited, or deactivated." },
    lastActive: { heading: "Last active", help: "The last time this person ran a session." },
    team: { heading: "Team", help: "The team's name and place in the tree." },
    inside: { heading: "Inside", help: "The team this one sits inside." },
    contains: { heading: "Contains", unit: "teams", help: "The sub-teams inside this one." },
    teamsPeople: { heading: "People", help: "How many people are on this team." },
    groups: { heading: "Groups", unit: "groups", help: "Which security groups this team holds." },
    admins: { heading: "Admins", unit: "people", help: "Who administers this team." },
  },
  verbs: {
    invite: { label: "Invite", explain: "Adds this person to the team, which is the grant." },
    cancelInvite: { label: "Cancel invite", explain: "Withdraws this invitation, so nobody joins on it." },
    remove: { label: "Remove", explain: "Takes this person off the team and shows what they lose first." },
    newSubTeam: {
      label: "New sub-team",
      explain: "Starts a team inside this one; it begins empty and inherits everything above it.",
    },
    askToBeAdmin: { label: "Ask to be an admin", explain: "Opens a request an organisation admin decides." },
    appointAdmin: { label: "Appoint", explain: "Makes this person an admin of the team." },
    revokeAdmin: {
      label: "Revoke admin",
      explain: "Takes the team's admin role back; they stay on the team.",
    },
    deactivate: { label: "Deactivate", explain: "Stops this person signing in, without removing their history." },
    visibilitySwitch: {
      label: "Change visibility",
      explain: "Chooses whether this person or team sees boundaries and logs.",
    },
  },
  empty: "people",
};

/**
 * The rest of the People and teams screens' words (04 §15): the teams tree,
 * the sub-team dialog, the removal preview, the role-request card and the
 * four items a team admin may not change (PRD §12).
 */
export const PEOPLE_TEXT = {
  changeTitle: "What you may change",
  openSessions: "Open their sessions",
  searchPlaceholder: "Filter these people",
  waitingCount: "{n} requests are waiting",
  waitingOne: "1 request is waiting",
  waitingNote: "An organisation admin decides each one.",
  teamsTitle: "Teams",
  teamsLede: "The tree, collapsed to the top level. A team is a branch, and everything on it inherits.",
  peopleLedeTeam: "Everyone on {team} and below. Adding someone to a team is the grant.",
  waitingTitle: "Waiting on an organisation admin",
  waitingNone: "Nothing is waiting.",
  waitsOn: "waits on {admin}",
  accept: "Accept",
  decline: "Decline",
  notYoursTitle: "Not yours to change",
  notYours: [
    { what: "Who is an organisation admin", who: "an organisation admin decides" },
    { what: "Which security groups exist, and what is in them", who: "an organisation admin decides" },
    { what: "Which runtimes are approved", who: "an organisation admin decides" },
    { what: "Whether a person sees boundaries and logs", who: "an organisation admin decides" },
  ],
  subTeamTitle: "New sub-team",
  subTeamName: "Name",
  subTeamWho: "Who is on it",
  subTeamWhoHint: "Choose from the people already on this team.",
  subTeamNotice:
    "A sub-team starts empty and inherits everything above it. Keeping something out of it means placing that thing somewhere else.",
  subTeamSubmit: "Create the sub-team",
  inviteTitle: "Invite someone",
  inviteEmail: "Email",
  inviteTeam: "Team",
  inviteTeamHint: "An invitation is to a team, and joining it is the grant.",
  cancelInviteTitle: "Cancel the invitation to {email}",
  cancelInviteTakes: "{email} never joins on this invitation. Inviting them again is one verb.",
  inviteSubmit: "Send the invitation",
  removeTitle: "Remove {name}",
  removeVerb: "Remove",
  removeLoses: "They lose these security groups:",
  removeRotate: "These shared keys should be rotated:",
  removeNothing: "They hold nothing through this team.",
  deactivateTitle: "Deactivate {name}",
  deactivateVerb: "Deactivate",
  deactivateTakes: "They can no longer sign in. Nothing they did is removed.",
  revokeAdminTitle: "Revoke {name}'s admin role",
  revokeAdminTakes: "They stop deciding for this team. They stay on it, and keep everything it grants.",
  visibilityTitle: "What they can see",
  visibilityBoundaries: "Boundaries",
  visibilityLogs: "Logs",
  /** W5-D15: the Assets screen's *Browse* tab — the place to pick more
   *  from. Turning it off takes nothing already held away. */
  visibilityStore: "Browse for assets",
  visibilityNote: "Transparency is the default. Turning a view off is recorded and the person is told.",
  personTeams: "Teams",
  personRole: "Role",
  personSessions: "Sessions",
  personReadableBy: "Can open your versions",
  cancel: "Cancel",
  notFound: "No person answers this id.",
} as const;
