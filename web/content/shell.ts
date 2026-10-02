/**
 * Strings the console's chrome says around any screen — 05 §3's shell module.
 *
 * The `?as` banner (04 §18) is rendered by the shell above every screen
 * (02 rule 17, `shell/as-banner.tsx`) — no screen carries a copy. `{name}`
 * and `{level}` are filled by `lib/views/refusals.ts`'s `fill`.
 */

export const SHELL = {
  /** 01 §4.3: the levels, as the switcher's tree and the chip name them. */
  levels: {
    me: "You",
    org: "Organisation",
    platform: "Platform",
  },
  /** 01 §7.5: the chip under every page title says where you are and whether
   *  you may change anything here. */
  chip: {
    canEdit: "{level} · you can edit here",
    readOnly: "{level} · read and use",
    label: "Level",
  },
  /** 01 §7.5: the page name is a button and opens the screen's readme.
   *  `{name}` is the page's own name, filled by `lib/views/readme.ts`. */
  readme: {
    title: "About {name}",
  },
  /** 01 §7.5a: the bar's search is an icon until it is pressed. One label
   *  for both states — the button says what it opens, the field what it
   *  searches — and the closing word for the key that collapses it. */
  search: {
    label: "Search",
    close: "Close search",
  },
  switcher: {
    label: "Level",
    hint: "Choose a level",
  },
  as: {
    /** `{name}` is the member being read; filled in `lib/views/` at render. */
    banner: "Reading {name}'s branch · they have not offered these; you can take one anyway.",
    verb: "Promote a file",
    verbExplain: "Opens the file picker and publishes the file to everyone on the team.",
    leave: "Stop reading their branch",
  },
} as const;
