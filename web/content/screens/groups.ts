/**
 * Security groups — console 04 §8.
 *
 * One module covers the grants list and the group detail page's entries
 * table (00 §5 treats `/groups` and `/groups/[name]` as one screen row).
 * `empty` is the org default; the team scope reads `groups.team` directly
 * (05 §8 gives that scope its own, different sentence, same pattern as
 * `harnesses.ts`).
 *
 * Personal edition (07 §3, D71): rendered as **Keys** — one flat list of
 * alias · upstream · vault · sources, with `narrowToSubTeam`, `createGroup`,
 * `addEntry` and their columns for granted-to/only-for/narrowed-from hidden.
 * The edition-keyed label lives here rather than as a second screen module.
 */
import type { ScreenContent } from "../types";
import type { EmptyId } from "../empty";

export type GroupsColumn =
  | "group"
  | "gives"
  | "sources"
  | "grantedTo"
  | "onlyFor"
  | "narrowedFrom"
  | "by"
  | "when"
  | "alias"
  | "secret"
  | "vault"
  | "upstream"
  | "attach"
  | "ready";
export type GroupsVerb =
  | "narrowToSubTeam"
  | "createGroup"
  | "addEntry"
  | "removeEntry"
  | "changeSources"
  | "revokeGrant";

export const GROUPS: ScreenContent<GroupsColumn, GroupsVerb, EmptyId> = {
  title: "Security groups",
  lede: "A security group is a named bundle of credentials that a team is given.",
  columns: {
    group: { heading: "Group", help: "The security group this row grants." },
    gives: { heading: "Gives", help: "How many entries the group holds." },
    sources: {
      heading: "Sources",
      help: "Whether the group resolves from a vault only, or from a vault or a local login.",
    },
    grantedTo: { heading: "Granted to teams", unit: "teams", help: "Which teams this grant reaches." },
    onlyFor: { heading: "Only for harnesses", unit: "harnesses", help: "Narrows the grant to specific harnesses, when set." },
    narrowedFrom: { heading: "Narrowed from", help: "The wider grant this one was narrowed from, if any." },
    by: { heading: "By", help: "Who created this grant." },
    when: { heading: "When", help: "When this grant was created." },
    alias: { heading: "Alias", help: "The name a tool uses for this entry's credential." },
    secret: { heading: "Secret", unit: "secrets", help: "The vault reference this entry resolves." },
    vault: { heading: "Vault", help: "Which key vault holds this entry's secret." },
    upstream: { heading: "Upstream", help: "The service this entry's credential is for." },
    attach: { heading: "Attach", help: "The request header this entry's credential is attached to." },
    ready: { heading: "Ready", help: "Whether the vault can currently supply this entry, checked just now." },
  },
  verbs: {
    narrowToSubTeam: {
      label: "Narrow to a sub-team",
      explain: "Hands part of this group to a sub-team, with only the entries you tick.",
    },
    createGroup: { label: "New group", explain: "Names a new secret and who may mint it." },
    addEntry: { label: "Add an entry", explain: "Adds a new alias and secret to this group." },
    removeEntry: {
      label: "Remove",
      explain: "Takes this entry out of the group; anything resolving its alias stops working.",
    },
    changeSources: {
      label: "Change sources",
      explain: "Changes whether this group may resolve from a local login as well as a vault.",
    },
    revokeGrant: { label: "Revoke", explain: "Stops this grant; anything resolving through it stops working." },
  },
  empty: "groups.org",
};

/**
 * The rest of the Security groups screen's words (04 §8): the grants list, the
 * group page's `EdgeWalk`, and the **Narrow to a sub-team** modal, whose live
 * sentence is assembled from these three fragments so no sentence is built in
 * a component (05 R8).
 */
export const GROUPS_TEXT = {
  count: "{n} grants",
  countOne: "1 grant",
  searchPlaceholder: "Filter these grants",
  createGroupTitle: "New security group",
  createGroupName: "Name",
  createGroupSources: "Sources",
  createGroupSubmit: "Create the group",
  ledeOrg: "A security group is a named set of credentials a team is given. A grant is one being given.",
  ledeTeam: "Every grant that reaches {team}, and what each one resolves.",
  ledeMe: "The groups that cover you, and the entries they resolve.",
  personalTitle: "Keys",
  personalLede: "Every key you hold, what it is for, and where it comes from.",
  // W5-D1b: `Grant.reach` is retired. A grant written before that still
  // appears in the index, and the row says what it now does, which is
  // nothing — reach is `policy/reach.json`, set under Boundaries.
  retiredReachGrant: "Reach grant, retired",
  givesEntries: "{n} entries",
  givesOneEntry: "1 entry",
  givesReach: "nothing — reach is set under Boundaries",
  sourcesVaultOnly: "vault only",
  sourcesVaultOrLocal: "vault or local",
  entriesTitle: "Entries",
  addEntryTitle: "Add an entry",
  addEntryAlias: "Alias",
  addEntryVault: "Vault",
  addEntryRef: "Reference",
  addEntryRefHint: "The name the vault holds this secret under. A reference, never a value.",
  addEntryUpstream: "Upstream",
  addEntryUpstreamHint: "The origin the credential is attached at, with no path.",
  addEntryUpstreamOrigin: "An upstream is an origin: a scheme and a host, with no path.",
  addEntryHeader: "Attach header",
  addEntryPrefix: "Attach prefix",
  addEntrySubmit: "Add the entry",
  removeEntryTitle: "Remove {alias}",
  removeEntryTakes: "Anything resolving {alias} through this group stops working.",
  grantedTo: "Granted to",
  onlyFor: "Only for",
  narrowedFrom: "Narrowed from",
  everyHarness: "every harness they own",
  restsOn: "What this rests on",
  restedOnBy: "What rests on this",
  narrowTitle: "Narrow to a sub-team",
  narrowTeamLabel: "Sub-team",
  narrowEntriesLabel: "Entries to keep",
  narrowSubmit: "Create the grant",
  narrowPreviewKeep: "{team} will be able to resolve {kept}.",
  narrowPreviewDrop: "They will not get {dropped}.",
  narrowPreviewNone: "{team} will be able to resolve nothing; untick fewer entries.",
  narrowCannotAdd: "A narrowed grant can only take away. There is nothing here that adds an entry.",
  cancel: "Cancel",
  revokeTitle: "Revoke this grant",
  revokeVerb: "Revoke",
  revokeTakesNone: "Nothing we can see rests on this grant.",
  revokeTakes: "These stop resolving:",
  notFound: "No security group answers this name.",
} as const;
