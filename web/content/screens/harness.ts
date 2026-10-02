/**
 * Harness (repository) — console 04 §5.
 *
 * `title` is the generic noun for chrome (browser tab, `aria-label`); the
 * visible heading is the harness's own name from `HarnessView.def`, which is
 * data, not content — the same reasoning 05 §3 gives for this screen's
 * `lede` being `""`. `empty` covers the flat file table (`harness.files`);
 * the History and Requests sub-views read `harness.history` and
 * `harness.requests` from `content/empty.ts` directly, since one screen
 * module can only name one `empty` key (05 §3).
 *
 * Personal edition (07 §3): the header's two-by-three grid loses *team* and
 * relabels *security groups* → *keys*; that relabelling is `groups.ts`'s
 * `edition.personal` override, not this module's.
 */
import type { ScreenContent } from "../types";

export type HarnessColumn = "type" | "name" | "owner" | "lastEditor" | "note" | "when" | "differs";
export type HarnessVerb = "openCommands" | "promote" | "edit" | "delete";

export const HARNESS: ScreenContent<HarnessColumn, HarnessVerb, "harness.files"> = {
  title: "Harness",
  lede: "",
  columns: {
    type: { heading: "Type", help: "What kind of thing it is — skill, tool, memory and so on." },
    name: { heading: "Name", help: "The file's name; opens it." },
    owner: {
      heading: "Owner",
      help: "Which branch the copy you would load comes from — the organisation, the team, or you.",
    },
    lastEditor: { heading: "Last editor", help: "Who last changed the version you are viewing." },
    note: { heading: "Their note", help: "The message the editor left with the change." },
    when: { heading: "When", help: "When that change was made." },
    differs: {
      heading: "Differs",
      help: "Whether this file is yours only, the team's only, both, or in conflict — shown only when comparing Differences.",
    },
  },
  verbs: {
    openCommands: {
      label: "Commands",
      explain: "Opens every command this harness supports, with the exact line to run.",
    },
    promote: {
      label: "Promote",
      explain: "Offers this file to everyone on the team. It acts on your machine, so it is the command `harness offer`, not a button here.",
    },
    edit: { label: "Edit", explain: "Changes the harness's name, description or drawing." },
    delete: { label: "Delete", explain: "Removes the harness; the files inside keep their history." },
  },
  empty: "harness.files",
};

/**
 * Everything this screen says beyond `ScreenContent`'s four fields (05 R8).
 * `{…}` placeholders are filled by `lib/views/` at render, never by a
 * component building a sentence out of parts.
 */
export const HARNESS_WORDS = {
  views: { files: "Files", history: "History", requests: "Requests" },
  viewLabel: "Which view",
  differences: "Differences",
  header: {
    team: "Team",
    preflight: "Preflight",
    model: "Model provider",
    groups: "Security groups",
    keys: "Keys",
    reach: "Reach",
    files: "Files",
  },
  /** 04 §5's *Applies here*: what holds on this harness wherever it runs —
   *  reach, the boundaries covering it, the groups whose grants cover it. */
  aside: {
    title: "Applies here",
    groups: "Security groups",
    boundaries: "Boundaries",
    commands: "Commands",
    commandsTitle: "Commands",
    noGroups: "No security group covers this harness.",
    noBoundaries: "Nothing is restricted here.",
    /** The rest of the sentence — the mode, the count and the node — is
     *  Reach's own, in `content/screens/boundaries.ts`, so the harness page,
     *  the header cell, the Boundaries screen and the session report all say
     *  it the same way (05 R8). */
    reachAs: "Reach: {what}",
  },
  differs: {
    "yours-only": "yours only",
    "theirs-only": "theirs only",
    both: "both",
    conflict: "conflict",
  },
  bulk: {
    label: "Everything at once",
    offer: "Offer everything",
    take: "Take the team's for everything",
    note: "Both act on your machine, so they are commands rather than buttons.",
  },
  history: {
    heading: "Versions",
    touched: "Files touched",
    empty: "No versions yet.",
  },
  identical: "Every version of this harness holds the same files, so the options read alike.",
  count: "{n} files",
  editRefusal: "Changing a team harness is a team admin's decision.",
  deleteTakes: "This removes the harness and nothing in it: {n} files keep their history.",
  deleteCancel: "Cancel",
  editName: "Name",
  editDescription: "Description",
  editDrawing: "Drawing",
  editErase: "Erase",
  editClear: "Clear",
  editSave: "Save",
} as const;
