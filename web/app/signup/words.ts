/**
 * Everything `/signup` says, in one place — the same split as `content/` for
 * the console's screens, and here it is also what makes the page testable:
 * Playwright's component rig only externalises an import whose every
 * specifier is a component, so the words cannot live in `signup.tsx` beside
 * `SignUp` without the spec importing the real module and failing to mount.
 */
export const SIGNUP = {
  title: "Create an account",
  description: "Two answers now; the link in your email brings you back to finish.",
  steps: ["Team or Personal", "Your email", "Finish"],
  team: {
    label: "Team",
    sentence: "An organization you invite people into, with teams, keys and boundaries.",
  },
  personal: {
    label: "Personal",
    sentence: "Just you: your own harnesses, your own keys, nobody to ask.",
  },
  orgName: "Organization name",
  email: "Email",
  sendLink: "Email me the link",
  sent: "Check your email — the link brings you back here.",
  choose: "Which kind of account is this?",
  password: "Choose a password",
  show: "Show",
  hide: "Hide",
  code: "Access code",
  next: "Continue",
  change: "Change",
  finish: "Create my workspace",
  /** `?finish=1` with no session: the link is spent, or it was opened in a
   *  browser that never asked for it (the sign-in is bound to the one that
   *  did). Either way the way out is another link. */
  linkDead: "That link did not sign you in — it has been used, has expired, or was opened in a different browser. Ask for a new one.",
  haveAccount: "Already have an account?",
  signIn: "Sign in",
} as const;
