/**
 * The words a `ui/` component needs but may not hold — 01 §7 and 02 rule 2
 * say a component is *given* its strings, so the labels shared by several
 * screens live here rather than being typed at each call site (05 R8).
 */

export const UI = {
  copy: { copy: "Copy", copied: "Copied" },
  modal: { close: "Close", cancel: "Cancel" },
  table: { more: "more" },
  /** `CommandSheet`'s title, shared by every screen that opens it (P14). */
  commands: { title: "Commands" },
} as const;
