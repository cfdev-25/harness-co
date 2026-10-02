import { HOW_TEXT } from "@/content/screens/how";

/**
 * *How this works* is one page with two tabs, and the tabs are routes
 * (04 §16, as Logs is at 04 §14): **Set up** is what a person does once per
 * machine, **Reference** is the vocabulary they come back to. Set up is
 * first because a console with no CLI on the machine can do nothing yet.
 *
 * Both routes are outside `[scope]` — a scale's anchor is one URL (00 §5,
 * K4) — so the hrefs are written whole and take no scope.
 */
export interface HowTab {
  id: string;
  label: string;
  href: string;
  /** Which route is open, so the bar can mark it (01 §7.5). */
  current: boolean;
}

export type HowRoute = "setup" | "reference";

export const HOW_HREF: Record<HowRoute, string> = {
  setup: "/console/how/setup",
  reference: "/console/how",
};

export function howTabs(current: HowRoute): HowTab[] {
  return [
    { id: "setup", label: HOW_TEXT.tabs.setUp, href: HOW_HREF.setup, current: current === "setup" },
    {
      id: "reference",
      label: HOW_TEXT.tabs.reference,
      href: HOW_HREF.reference,
      current: current === "reference",
    },
  ];
}

/**
 * Step 1 of *Set up* is the one a browser cannot take: opening a terminal.
 * The keystroke differs per machine, so the card guesses from the user agent
 * and the segmented control beside it is how a wrong guess is corrected —
 * `navigator.platform` is deprecated and lies under emulation, so it is read
 * only as the fallback it is.
 *
 * Pure, and given its two strings rather than reading `navigator`, so the
 * guess is a unit test rather than a browser.
 */
export type OsId = "mac" | "windows" | "linux";

export const OS_IDS: OsId[] = ["mac", "windows", "linux"];

/** What a server render says, and what a user agent nobody can read falls
 *  back to: the machine most people are on, with the control right beside
 *  it. */
export const DEFAULT_OS: OsId = "mac";

export function detectOs(userAgent: string, platform = ""): OsId {
  const text = `${userAgent} ${platform}`.toLowerCase();
  if (/mac|iphone|ipad|ipod/.test(text)) return "mac";
  if (/win/.test(text)) return "windows";
  if (/linux|x11|cros|android/.test(text)) return "linux";
  return DEFAULT_OS;
}
