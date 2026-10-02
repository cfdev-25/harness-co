/**
 * Harnesses (cards) — console 04 §4.
 *
 * One module for all three scopes (K1); `me`/`team` empty states differ
 * (05 §8), so the caller picks `EMPTY["harnesses.me" | "harnesses.team" |
 * "harnesses.me.personal"]` by `Scope`/`Viewer.edition` — `empty` below is
 * the `me`, enterprise default. 05 §8 has no distinct "harnesses (org)" row;
 * until one exists, the org scope also reads `harnesses.team`'s sentence.
 */
import type { ScreenContent } from "../types";
import type { EmptyId } from "../empty";

export type HarnessesColumn = "name" | "description" | "team" | "fileCount";
export type HarnessesVerb = "newHarness" | "newHarnessMine";

export const HARNESSES: ScreenContent<HarnessesColumn, HarnessesVerb, EmptyId> = {
  title: "Harnesses",
  lede: "A new harness starts empty and inherits everything you already hold.",
  columns: {
    name: { heading: "Name", help: "The harness's name, chosen when it was made." },
    description: { heading: "Description", help: "What the harness is for, in the person's own words." },
    team: { heading: "Team", unit: "teams", help: "Which team's branch owns this harness." },
    fileCount: { heading: "Files", help: "How many things are in it, of any kind." },
  },
  verbs: {
    newHarness: { label: "New harness", explain: "Starts an empty harness that inherits everything you already hold." },
    /** W5-D9: a level you only read still lets you start one — on your own
     *  branch, which is always yours. The button says where it will land. */
    newHarnessMine: {
      label: "New harness in yours",
      explain: "Starts an empty harness on your own branch; this level is one you read.",
    },
  },
  empty: "harnesses.me",
};

/**
 * The words this screen needs beyond `ScreenContent`'s four fields (05 R8: no
 * string a person reads is typed in a component). Added here rather than in a
 * new module because 05 §3 gives one content file per screen.
 */
export const HARNESSES_WORDS = {
  countOne: "1 harness",
  countMany: "{n} harnesses",
  searchPlaceholder: "Name or description",
  files: "files",
  fileOne: "file",
  newFrom: "Start from a copy",
  newFromNone: "Empty",
  newName: "Name",
  newDescription: "Description",
  newSubmit: "Create",
  newCancel: "Cancel",
  /* W7-D4: the two questions a first harness asks on a personal account, and
     the one read-only line under them. *Web access* is `HarnessDef.reach`,
     *Outside keys* is a grant of one security group scoped to this harness —
     so both are set here and changed later on Boundaries and Keys. */
  newWebAccess: "Web access",
  newWebAccessOn: "On — this harness may reach the web.",
  newWebAccessOff: "Off — only the model endpoint and the keys you give it.",
  newKeys: "Outside keys",
  newKeysNone: "None",
  newKeysHint: "A group of keys this harness may use. Most first harnesses need none.",
  /** The model that will serve it: read-only here, set under Providers. */
  newModelKey: "Model: your default key",
  newModelSignIn: "Model: your Pi sign-in",
  newModelNone: "Add a key or sign in to Pi first",
  newModelLink: "Providers",
  importLabel: "Import",
  importExplain: "Brings in a provider setup you already have on this machine.",
  importCommand: "harness import claude",
  /** W5-D9: the other copies of the same harness, under the team cell. */
  alsoAt: "Also at",
  /* W5-D13: the launch row. The button carries the runtime's own name; the
     row says what pressing one does, so a lone *Pi* is never a riddle. */
  openIn: "Open in",
  openInOne: "Open in {runner}",
  /** W5-D14: the folder this person last ran this harness in, and where. */
  openAgain: "Open again in {workspace} on {host}",
  openAgainHere: "Open again in {workspace}",
  /* W5-D13: a web page cannot tell whether the CLI is installed, so the line
     under the grid says what the buttons do and where to go when nothing
     happens, rather than guessing. The guide explains why it cannot know. */
  launchNote: "Buttons open a terminal on this machine. Nothing happened?",
  installLink: "Install the CLI",
  installHref:
    "https://github.com/cfdev-25/harness-co/blob/main/docs/guide/install.md",
  launchRun: "and run",
  setupCommand: "harness setup",
} as const;
