/**
 * Account — console 04 §17. `me` scope only.
 */
import type { ScreenContent } from "../types";

export type AccountColumn = "tool" | "present" | "asOf" | "createIt";
export type AccountVerb = "askToBeAdmin" | "createToken" | "signOut";

export const ACCOUNT: ScreenContent<AccountColumn, AccountVerb, "account.logins"> = {
  title: "Account",
  lede: "Who can see your versions, said here so you never find out by accident.",
  columns: {
    tool: { heading: "Tool", help: "The runtime this login is for." },
    present: { heading: "Present", scale: "slot", help: "Whether this login was present the last time you ran a session." },
    asOf: { heading: "As of", help: "When this was last observed, from your last session." },
    createIt: { heading: "Create it", help: "The exact command that signs this runtime in." },
  },
  verbs: {
    askToBeAdmin: { label: "Ask to be an admin", explain: "Opens a request an organization admin decides." },
    createToken: {
      label: "Create an access token",
      explain: "The token harness login asks for. Shown once; name it after the machine.",
    },
    signOut: { label: "Sign out", explain: "Ends your session with the console." },
  },
  empty: "account.logins",
};

/**
 * W7-D5: the *Getting started* list, personal accounts only. Four steps in
 * the order they are done. A step reads as a thing to do, and its `done`
 * sentence as the fact that closed it — never *complete*, which says nothing
 * a tick has not already said.
 *
 * *A model* is the one step with two ways to close it (W7-D2), so it is the
 * one row with a sentence under its link.
 *
 * The first two rows carry a link, not a command (console D105): the install
 * line and the whole `harness login` line — the one with this deployment's
 * API address and a token on it — are printed once, under *Set up* on *How
 * this works*, and the row goes there.
 */
export const GETTING_STARTED = {
  title: "Getting started",
  note: "This list goes away once all four are done.",
  steps: {
    install: {
      step: "Install the CLI",
      link: "How to install",
      done: "The CLI has run on this account.",
    },
    login: {
      step: "Sign in",
      link: "How to sign in",
      done: "This account has an access token.",
    },
    model: {
      step: "A model",
      link: "Set up",
      note: "Or sign in to Claude or ChatGPT inside Pi with {command}.",
      noteCommand: "harness auth pi",
      done: {
        key: "A key is set up, and it is your default.",
        "sign-in": "Pi signs in to your model provider itself.",
      },
    },
    harness: {
      step: "First harness",
      link: "New harness",
      done: "You hold a harness.",
    },
  },
} as const;

/**
 * The rest of the Account screen's words (04 §17). The honesty line is a body
 * fact on the card, never the lede (P8): the page does not narrate itself.
 */
export const ACCOUNT_TEXT = {
  lede: "Your teams, the logins your last session saw, and the one thing you may ask for.",
  teamsTitle: "Your teams",
  teamsNone: "Just you.",
  loginsTitle: "Logins on your machine",
  loginsAsOf: "As of your last session.",
  loginsNoSession: "Run `harness preflight` once and this fills in.",
  seesTitle: "Who can see your versions",
  seesLine:
    "{admin} can see your versions. As {team}'s admin, they can open your branch and promote something you have not offered. Said here so you never find out by accident.",
  seesNobody: "Nobody but you. There is no admin above your branch.",
  askTitle: "Ask",
  askLabel: "Ask to be a {team} admin",
  askReason: "Why",
  askReasonHint: "An organization admin reads this and decides.",
  askSubmit: "Send the request",
  askSent: "Your request is open and waiting on an organization admin.",
  cancel: "Cancel",
  tokenTitle: "Command-line access",
  tokenName: "Name",
  tokenNameHint: "The machine this token is for.",
  tokenSubmit: "Create the token",
  tokenLabel: "Token",
  tokenOnce: "Copy it now — it is not shown again.",
  tokenNext: "Then, on that machine",
  sessionsTitle: "Sessions",
  sessionsLink: "Your sessions",
  createTeamTitle: "Create a team",
  createTeamNote:
    "A team turns this account into an organization: people, roles and requests appear. Nothing you already have is migrated or moved.",
  createTeamName: "Team name",
  createTeamSubmit: "Create the team",
  signOut: "Sign out",
} as const;
