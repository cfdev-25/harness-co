"use client";

import { useTip } from "./use-tip";

export interface HelpMarkProps {
  /** The column heading's `(?)` text, from the screen's content module. */
  text: string;
}

/** A `Word` without a term: the same mechanism, the text passed in (05 §10). */
export function HelpMark({ text }: HelpMarkProps) {
  const tip = useTip(text);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="cursor-help rounded-full border border-line px-1 font-mono text-2xs text-muted"
        {...tip.anchor}
      >
        ?
      </button>
      {tip.element}
    </span>
  );
}
