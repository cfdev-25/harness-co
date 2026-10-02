/**
 * Boundaries — console 04 §9.
 *
 * Personal edition (07 §3, D71): rendered as **What I block**; the node that
 * set it is always "you", so the `setBy` column is hidden there.
 */
import type { ScreenContent } from "../types";
import type { EmptyId } from "../empty";

export type BoundariesColumn = "kind" | "value" | "holds" | "appliesTo" | "onlyFor" | "setBy" | "reason" | "when";
export type BoundariesVerb = "add" | "remove";

export const BOUNDARIES: ScreenContent<BoundariesColumn, BoundariesVerb, EmptyId> = {
  title: "Boundaries",
  lede: "A boundary is something the assistant may never do, however it is running.",
  /** The three tabs' own sentences (W6-D8), which used to sit under the tab
   *  strip. Reach's is first, because Reach is where the screen opens. */
  about: [
    "Reach: how far a session started here goes, and the hosts it may never touch.",
    "Commands: command lines a session may never run, in either runtime.",
    "Files: paths a session may never read or write.",
  ],
  columns: {
    kind: { heading: "Kind", help: "Endpoint, command, filesystem or capability — what sort of thing this boundary denies." },
    value: { heading: "Value", help: "The exact thing denied." },
    holds: {
      heading: "Holds",
      scale: "holds",
      help: "Whether this boundary is enforced outright or intercepted at the moment it is tried.",
    },
    appliesTo: { heading: "Applies to", unit: "teams", help: "Which teams this boundary reaches." },
    onlyFor: { heading: "Only for", unit: "harnesses", help: "Narrows the boundary to specific harnesses, when set." },
    setBy: { heading: "Set by", help: "The organisation or team that added this boundary." },
    reason: { heading: "Reason", help: "Why this boundary was added." },
    when: { heading: "When", help: "When this boundary was added." },
  },
  verbs: {
    add: { label: "Add a boundary", explain: "Denies something for this team and everyone below it." },
    remove: { label: "Remove", explain: "Lifts this boundary for the scope that set it." },
  },
  empty: "boundaries.org",
};

/**
 * The rest of the Boundaries screen's words (04 §9), added beside `BOUNDARIES`
 * because `ScreenContent` carries only a title, a lede, columns and verbs and
 * this screen has a per-scope lede, a second block, a form and two refusals.
 * `{team}` and `{admin}` are filled by `lib/views/cells.ts`'s `fill`, since
 * 05 §7 authors its sentences against fixture names and defines no
 * substitution step.
 */
export const BOUNDARIES_TEXT = {
  count: "{n} boundaries",
  countOne: "1 boundary",
  ledeOrg: "A boundary is a deny, set once at the organisation and inherited by everything below it.",
  ledeTeam: "Every boundary that reaches {team}, in full. A team may add for itself and below, never lift.",
  ledeMe: "Every boundary that reaches you, in full. A refusal you cannot look up is indistinguishable from a bug.",
  personalTitle: "What I block",
  personalLede: "Everything the assistant may never do, however it is running.",
  orgBlock: "Set by the organisation",
  tightenOnly: "Boundaries only tighten on the way down.",
  tabs: {
    reach: "Reach",
    commands: "Commands",
    files: "Files",
  },
  inherited: "Inherited",
  inheritedNone: "Nothing above this level sets a boundary here.",
  inheritedReadOnly: "A boundary is lifted where it was set. These are read-only here.",
  here: "Set here",
  hereNone: "This level sets none of its own.",
  /** The *Holds* cell on a command row (W6-D9). A command boundary is never
   *  enforced — the runtime is what refuses the call — so the row says which
   *  runtime, and says *by Pi* alone where Claude Code's own matcher cannot
   *  hold the pattern (engine 07 §8). */
  interceptedBy: "by {runtimes}",
  interceptedByBoth: "Pi and Claude Code",
  interceptedByPi: "Pi",
  interceptedPiOnly:
    "Claude Code matches each subcommand on its own, so a pattern with a pipe or an && in it never fires there. Pi reads the whole line and holds it.",
  suggestedCommands: "Suggested",
  suggestedCommandsLede:
    "The command lines most organisations never want run. One click each; nothing here is on until you add it.",
  addVerb: "Add",
  alreadySet: "already set",
  addTitle: "Add a boundary",
  addSubmit: "Add the boundary",
  cancel: "Cancel",
  kindLabel: "Kind",
  valueLabel: "Value",
  valueHint: "The exact host, command, path or capability denied.",
  holdsLabel: "Holds",
  reasonLabel: "Reason",
  reasonHint: "Why this is denied. Everyone it reaches reads this.",
  scopeLabel: "Applies to",
  scopeHint: "This team and everything below it.",
  /** W6-D9. A command boundary is intercepted and nothing else: the runtime
   *  refuses the call as it is made, and nothing outside the runtime can hold
   *  a command at all. The form says so instead of offering a choice that the
   *  api would refuse (engine 06 §13). */
  holdsCommandFixed: "intercepted — the runtime refuses the call as it is made",
  patternHint: "A command line. * matches any run of characters: rm -rf /* · git push --force*",
  removeVerb: "Remove",
  removeTitle: "Remove this boundary",
  removeTakes: "Everything this boundary denied becomes reachable again for every harness it covered.",
} as const;

/** 04 §9's form: the four kinds, and `holds` from the registered scale. */
export const BOUNDARY_KINDS = ["endpoint", "command", "filesystem", "capability"] as const;

/**
 * Reach — the section at the top of Boundaries (04 §9, W5-D5, engine 01 D131).
 *
 * It lives in this module because Reach is a section of this screen, and its
 * three sentences are read in three other places — the harness header, the
 * harness's *Applies here* line, and the session report's reach line — through
 * `lib/views/reach.ts`, which imports them here rather than letting each
 * screen write the same sentence again (05 R8; the same arrangement
 * `lib/views/logs.ts` has with `LOGS`).
 */
export const REACH_TEXT = {
  title: "Reach",
  lede: "How far a session started here may reach beyond the hosts it holds a credential for.",
  /** The composed answer, in three words each. `{n}` is the host count. */
  off: "off",
  allow: "allow-list, {n} hosts",
  allowOne: "allow-list, 1 host",
  allowNone: "allow-list, nothing on it yet",
  on: "on, except {n} hosts",
  onOne: "on, except 1 host",
  onNone: "on, nothing denied",
  notSet: "not set",
  setBy: "set by {node}",
  /** *Organisation: allow-list, 3 hosts* — one line per step of the walk. */
  chainLine: "{level}: {what}",
  inherited: "Inherited",
  inheritedNone: "Nothing above this level sets reach, so this level starts it.",
  here: "At this level",
  notSetHere: "This level sets no reach of its own, so it uses what it inherits. Choosing a mode starts one here, and it may only narrow what is above.",
  effective: "In effect here",
  modes: {
    off: {
      label: "Off",
      sentence:
        "A session reaches only the hosts it holds a credential for, and its model provider. Nothing else resolves.",
    },
    allow: {
      label: "An allow-list",
      sentence:
        "A session reaches the hosts on the list below and nothing else. The list starts empty; the suggested hosts are one click each.",
    },
    on: {
      label: "On, with a deny-list",
      sentence:
        "A session reaches anything that is not on the list below and not behind a boundary. This is also the only mode in which a model request may ask the provider to browse on its own side.",
    },
  },
  hostsAllow: "Hosts a session may reach",
  hostsOn: "Hosts a session may not reach",
  noHostsAllow: "Nothing on the list yet, so a session reaches only its credentialed hosts.",
  noHostsOn: "Nothing denied here, so a session reaches anything a boundary allows.",
  addLabel: "Add a host",
  addHint: "A host name — or a leading *. for every subdomain of it.",
  addVerb: "Add",
  removeVerb: "Remove",
  suggested: "Suggested",
  suggestedLede: "The package registries and source hosts most work needs. One click each.",
  alreadyAllowed: "already allowed",
  readOnly: "Reach is set by an admin of the level that holds it. You can read it and use it.",
} as const;

/** The three modes in the order the radio offers them: widest choice last. */
export const REACH_MODES = ["off", "allow", "on"] as const;
