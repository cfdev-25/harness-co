/**
 * File — console 04 §6.
 *
 * `title` is the generic noun; the visible heading is the owner line and the
 * file's path (PRD §17.1, §17.2), both data. `empty` is `file.content`
 * (console 04 §6's assigned-but-unanswered state), added to `content/
 * empty.ts` because 05 §8's table has no File row — see that file's comment.
 */
import type { ScreenContent } from "../types";

export type FileColumn = "version" | "branch" | "who" | "when" | "message";
export type FileVerb = "viewAsGit" | "promote" | "withdraw";

export const FILE: ScreenContent<FileColumn, FileVerb, "file.content"> = {
  title: "File",
  lede: "",
  columns: {
    version: { heading: "Version", help: "The commit that produced this version, shown as a short hash." },
    branch: { heading: "Branch", help: "Whether this version is from your branch or the team's." },
    who: { heading: "Who", help: "Who made this version." },
    when: { heading: "When", help: "When this version was made." },
    message: { heading: "Message", help: "The note the person left with this version." },
  },
  verbs: {
    viewAsGit: { label: "View as git", explain: "Shows the underlying hunk, exactly as git recorded it." },
    promote: {
      label: "Promote",
      explain: "Offers this file to everyone on the team. It acts on your machine, so it is the command `harness offer`, not a button here.",
    },
    withdraw: { label: "Withdraw", explain: "Takes back a request you opened on this file." },
  },
  empty: "file.content",
};

/** 05 R8's strings for the file page; `{name}` is filled in `lib/views/`. */
export const FILE_WORDS = {
  owner: {
    org: "Organization file — nothing below the organization can change it.",
    team: "Team file — you may offer changes.",
    you: "Yours — on your branch only.",
    member: "{name}'s — on their branch only.",
  },
  back: "Back to the harness",
  siblings: "Files",
  whatChanged: "What changed",
  noChange: "This copy matches the team's.",
  oneCopy: "There is only one copy of this file, so there is nothing to compare.",
  compareMine: "Your version",
  compareTeam: "The team's version",
  conflict: "Your copy and the team's have both moved since they last agreed.",
  outs: {
    label: "Three ways out",
    keepMine: "Keep mine",
    takeTheirs: "Take the team's",
    editByHand: "Edit by hand",
  },
  history: "History",
  branch: { mine: "mine", team: "team" },
  stale: "the team's copy has since changed",
  proposed: "proposed",
  openRequest: "There is an open request on this file.",
} as const;
