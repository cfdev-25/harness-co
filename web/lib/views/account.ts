import { GETTING_STARTED } from "@/content/screens/account";
import { loginCommand } from "./people";
import type { Viewer } from "./types";

/**
 * The Account screen's *Getting started* list (W7-D5, 04 §17).
 *
 * Four rows, in the order the person does them, each either a check with the
 * fact that closed it or one thing to do — a link, in every case (D105). The list
 * is derived from `viewer.setup` on every read (`console.setup_facts`), so it
 * cannot drift from what has actually happened and there is nothing to tick.
 */

/**
 * W7-D6. The one line, and the same string the account row and
 * `docs/guide/first-session.md` print. It is a command, so it lives beside
 * the words that frame it; the sheet (05 §6) carries `harness …` rows only,
 * and this is `curl`.
 *
 * The raw URL answers once the repository is pushed **and public**; today it
 * is private and `curl` gets a 404. Said in the guide, not here: a screen
 * states what the command is, not what the repository's visibility is.
 */
export const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/cfdev-25/harness-co/main/scripts/install.sh | sh";

/**
 * `harness setup` — the sheet's own row (engine 08 §11.17). Written out rather
 * than looked up: a lookup by the exact string it would return is a line that
 * does nothing. `test/unit/sheet.test.ts` compares the checked-in sheet to
 * what the CLI's build emits, which is what keeps the string the CLI's.
 */
const REGISTER_COMMAND = "harness setup";

/** The token's slot before one is minted. A `<…>` is the CLI's own spelling
 *  for *you put something here*, and it is what makes the line paste-able as
 *  a shape before it is paste-able as a command. */
export const TOKEN_PLACEHOLDER = "<token>";

/** And the origin's slot, for a console deployed without `HARNESS_API_ORIGIN`.
 *  A localhost default here would be a line that runs and reaches the wrong
 *  machine, which is worse than one that visibly asks to be filled in. */
export const API_ORIGIN_PLACEHOLDER = "<your API URL>";

/**
 * Where the first two rows send the person (console D105). The commands used
 * to be printed on the row; they are printed in one place now, with the token
 * that the second one needs, and the row is the link to it. A command in two
 * places is two commands the day one of them changes.
 */
export const SETUP_HREF = "/console/how#setup";

export type SetupCommandKey = "install" | "login" | "register";

export interface SetupCommand {
  key: SetupCommandKey;
  command: string;
}

/**
 * *How this works* → *Set up* (console D105): the three commands a person
 * pastes, in order, once per machine.
 *
 * `apiOrigin` is the API the console itself talks to — `HARNESS_API_ORIGIN`,
 * read on the server and handed down, because the browser has only the `/v1`
 * rewrite and cannot know the address the CLI should use (02 D23). A trailing
 * slash is dropped: the CLI joins `api_url + "/v1/me"`.
 *
 * `token` is `null` until the person presses *Generate a token*, and the line
 * carries the placeholder meanwhile. The verb of each line comes from the
 * shared command sheet (D40); only the two flags and their values are written
 * here, because no sheet row can carry this deployment's origin.
 */
export function setupCommands(apiOrigin: string | null, token: string | null): SetupCommand[] {
  const origin = (apiOrigin ?? "").replace(/\/+$/, "") || API_ORIGIN_PLACEHOLDER;
  return [
    { key: "install", command: INSTALL_COMMAND },
    {
      key: "login",
      command: `${loginCommand()} --api-url ${origin} --token ${token ?? TOKEN_PLACEHOLDER}`,
    },
    { key: "register", command: REGISTER_COMMAND },
  ];
}

export type SetupStepKey = "install" | "login" | "model" | "harness";

export interface SetupStep {
  key: SetupStepKey;
  /** What the step is, in the imperative: the heading of the row. */
  step: string;
  done: boolean;
  /** The fact that closed it, on a checked row. */
  fact?: string;
  /** The one thing an unchecked row carries (W7-D5). All four are links now:
   *  the two that used to print a command link to the one place it is printed
   *  (console D105). */
  link?: { label: string; href: string };
  /**
   * The one extra sentence a row may carry — the second way to get a model
   * (W7-D2). `{command}` in it is `noteCommand`, drawn in monospace: the
   * sentence stays whole in `content/` and the screen decides the type.
   */
  note?: string;
  noteCommand?: string;
}

/**
 * `null` is *draw nothing*: an enterprise account never has this list (its
 * first hour is an admin's, and `first-hour-admin.md` and `harness setup`
 * own it), and a personal account that has done all four is finished with it.
 * A list that stays after it is complete is furniture (P8).
 *
 * `setup` is optional on `Viewer` so a server one deploy behind answers
 * without it; nothing done is the honest reading, and the list appears.
 *
 * Account is `me`-only (04 §17), so the two scope links are written at `me`;
 * the first two rows link outside `[scope]`, to the one place the commands
 * live (console D105).
 */
export function gettingStarted(viewer: Viewer): SetupStep[] | null {
  if (viewer.edition !== "personal") return null;
  const setup = viewer.setup ?? { installed: false, loggedIn: false, model: null, harness: false };
  const words = GETTING_STARTED.steps;
  const steps: SetupStep[] = [
    {
      key: "install",
      step: words.install.step,
      done: setup.installed,
      ...(setup.installed
        ? { fact: words.install.done }
        : { link: { label: words.install.link, href: SETUP_HREF } }),
    },
    {
      key: "login",
      step: words.login.step,
      done: setup.loggedIn,
      ...(setup.loggedIn
        ? { fact: words.login.done }
        : { link: { label: words.login.link, href: SETUP_HREF } }),
    },
    {
      key: "model",
      step: words.model.step,
      done: setup.model !== null,
      ...(setup.model !== null
        ? { fact: words.model.done[setup.model] }
        : {
            link: { label: words.model.link, href: "/console/me/providers/model" },
            note: words.model.note,
            noteCommand: words.model.noteCommand,
          }),
    },
    {
      key: "harness",
      step: words.harness.step,
      done: setup.harness,
      ...(setup.harness
        ? { fact: words.harness.done }
        : { link: { label: words.harness.link, href: "/console/me/harnesses" } }),
    },
  ];
  return steps.every((row) => row.done) ? null : steps;
}
