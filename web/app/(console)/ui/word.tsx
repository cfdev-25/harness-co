"use client";

import type { ReactNode } from "react";
import { wordOf, type WordId } from "@/lib/views/words";
import { useTip } from "./use-tip";

export interface WordProps {
  term: WordId;
  children?: ReactNode;
}

/**
 * The vocabulary's hover (05 §10, R1): a dotted underline, the short sentence
 * on hover *or* focus, `aria-describedby`, Escape to dismiss. Never nested,
 * never inside a link.
 */
export function Word({ term, children }: WordProps) {
  const entry = wordOf(term);
  const tip = useTip(entry?.short);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        className="cursor-help bg-transparent p-0 text-left underline decoration-dotted underline-offset-4"
        {...tip.anchor}
      >
        {children ?? term}
      </button>
      {tip.element}
    </span>
  );
}
