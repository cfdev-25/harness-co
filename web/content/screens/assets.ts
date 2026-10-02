/**
 * Assets — console 04 §12. One screen at every level (W5-D9): at *You* the
 * person's own copies, at a team the team's, at the organization the
 * organization's. The verbs are the level's admin's; at *You* that is always
 * the person. The *always loaded* decision stays an organization admin's,
 * and stays on the asset page.
 */
import type { ScreenContent } from "../types";
import type { EmptyId } from "../empty";

/** The table renders five of these (W5-D9's row); `type` and `needsGroups`
 *  are the asset page's own headings, which is why they are here too — one
 *  screen, one vocabulary. */
export type AssetsColumn =
  | "type"
  | "name"
  | "description"
  | "loads"
  | "usedBy"
  | "needsGroups"
  | "lastChange";
export type AssetsVerb = "setLoads" | "edit" | "remove";

export const ASSETS: ScreenContent<AssetsColumn, AssetsVerb, EmptyId> = {
  title: "Assets",
  lede: "Everything on the organization's branch. An organization asset reaches every team unless a harness leaves it out.",
  columns: {
    type: { heading: "Type", help: "What kind of asset this is — skill, tool, memory and so on." },
    name: { heading: "Name", help: "The asset's name." },
    description: { heading: "Description", help: "What it is for, in the words of whoever wrote it." },
    loads: {
      heading: "Loads",
      help: "Whether every session loads this, every new harness starts with it, or a harness asks for it.",
    },
    usedBy: { heading: "Used by", unit: "harnesses", help: "Which harnesses load this asset." },
    needsGroups: { heading: "Needs groups", unit: "groups", help: "Which security groups this asset needs to run." },
    lastChange: { heading: "Last change", help: "When this asset was last committed." },
  },
  verbs: {
    setLoads: {
      label: "Set how it loads",
      explain: "Changes whether every session loads this, every new harness starts with it, or neither.",
    },
    edit: {
      label: "Edit",
      explain:
        "Changes the name and the description of this copy in its row — and, for an organization admin, how it loads. The harnesses that hold it keep it.",
    },
    remove: {
      label: "Delete",
      explain: "Removes this copy from the branch and from every harness on it that lists it.",
    },
  },
  empty: "assets.org",
};

/**
 * The rest of the Assets screen's words (04 §12): the tabs, the two row
 * verbs, the asset page's reverse view and `EdgeWalk` headings, and the
 * refusal 04 §12 gives verbatim.
 */
export const ASSETS_TEXT = {
  count: "{n} assets",
  countOne: "1 asset",
  searchPlaceholder: "Filter these assets",
  ledeTeam: "Everything on this team's branch. It reaches everyone on the team unless a harness leaves it out.",
  ledeMe: "Everything on your own branch — what you have made, and your copies of what reached you.",
  kinds: "Kinds",
  sidecar: "What it declares",
  reverse: "What loads it",
  restsOn: "What this rests on",
  restedOnBy: "What rests on this",
  loadsLabel: "Loads",
  /** W5-D10's three states — the words `loadsLabel()` in `lib/views/assets.ts`
   *  returns, and the labels on the asset page's three-way control. One
   *  vocabulary: the cell and the control cannot disagree. */
  loadsRequired: "Required",
  loadsRecommended: "Recommended",
  loadsOnRequest: "On request",
  requiredExplain: "Every session loads it. No harness can leave it out, and it cannot be deleted.",
  recommendedExplain: "Every new harness starts with it, and whoever owns that harness may take it out again.",
  onRequestExplain: "Published and available; whoever builds the harness includes it.",
  confirmTitle: "Load this into every session",
  confirmTakes: "Preflight will refuse to launch any harness without it.",
  confirmVerb: "Set required",
  cancel: "Cancel",
  notFound: "No asset here answers this id.",
  editName: "Name",
  editDescription: "Description",
  editSubmit: "Save",
  removeTitle: "Delete this asset",
  /** The confirmation is the preview (02 rule 22): what the asset leaves. */
  removeLeaves: "It leaves these harnesses:",
  removeLeavesAll: "It loads into every harness today, and would leave all of them.",
  removeLeavesNone: "No harness lists it.",
  removeTakes: "The copy on this branch is removed. Other levels keep theirs.",

  /** The store — W5-D15. *Browse* is a tab of this screen and not a screen of
   *  its own: one table, one fetch, one set of verbs, filtered (02 rule 16). */
  browseTab: "Browse",
  browseExplain: "Everything you can use — what the organization, your teams and you hold, and what comes bundled.",
  browseFrom: "From",
  browseHeldHeading: "Yours",
  browseHeldYes: "On your branch",
  browseHeldNo: "—",
  browsePreset: "preset",
  browseYou: "you",
  browseAllKinds: "All kinds",
  browseEmpty: "Nothing reaches you yet, and nothing is bundled.",
  browseFilteredEmpty: "Nothing here answers that.",
  browseSelected: "{n} selected",
  browseSelectedOne: "1 selected",
  browseClear: "Clear",
  browseSelectLabel: "Pick {name}",
  /** The bar at the bottom, which appears when something is ticked. */
  addToHarness: "Add to harness",
  addToHarnessExplain: "Adds what you ticked to your version of a harness you can run.",
  addTitle: "Add to a harness",
  addWhich: "Harness",
  addSubmit: "Add",
  addNoHarnesses: "You have no harnesses yet. `New harness from selection` starts one.",
  newFromSelection: "New harness from selection",
  newFromSelectionExplain: "Starts a harness on your own branch holding what you ticked.",
  /** W5-D15: a tool brings the environment its sidecar names, and the
   *  confirmation says which and why before the button is pressed. */
  browseBrings: "Adds {environment} because {tool} needs it.",
  browseAdds: "Adds {n} to your version of this harness.",
  browseAddsOne: "Adds 1 thing to your version of this harness.",
  browsePresetNote: "A bundled asset is copied onto your own branch when you add it.",
} as const;
