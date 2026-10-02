import type { ReactNode } from "react";
import { Trail } from "./trail";

export interface EntityHeaderProps {
  /** The thing's own name — a harness, a person, a file, a session. */
  name: string;
  trail?: Array<{ label: string; href?: string }>;
  /** The harness's drawing, at the start of the name block (PRD §17.1). */
  mark?: ReactNode;
  /** The two-by-three grid beside the name (PRD §17.1). */
  facts?: Array<{ label: string; value: ReactNode }>;
}

// 01 §5 restricts the spacing steps and 02 D25 the class length; the block's
// stacking rule is the long list in this file, so it is named here.
const BLOCK =
  "flex flex-col gap-4 " +
  "min-[960px]:flex-row min-[960px]:flex-wrap min-[960px]:items-start min-[960px]:gap-6";
const NAME = "min-w-0 text-xl font-bold tracking-[-0.02em] break-words";

/**
 * What a detail screen is showing, as its first block of **content**
 * (01 §7.5, D99).
 *
 * It is not a header: the page's name is the section in the top bar and the
 * screen's one strip is the bar above this. This is the object — its trail,
 * its drawing, its own name and the facts about it — and it scrolls with the
 * rest of the page, because a harness's six facts are the first thing to
 * read once and never again.
 *
 * Below 960 the blocks stack — name, then facts — which is 01 §7.5's own
 * number and the shell's (`shell.css`); Tailwind's `md` is 768 and the
 * overlap the screens agent found was at 800, so the variant is the
 * breakpoint the document names. The name is `break-words`: a harness name
 * is a person's word, and may be one long one with nowhere to wrap.
 */
export function EntityHeader({ name, trail, mark, facts }: EntityHeaderProps) {
  return (
    <div className={BLOCK}>
      <div className="flex min-w-0 flex-1 items-start gap-4">
        {mark && <div className="shrink-0">{mark}</div>}
        <div className="grid min-w-0 flex-1 gap-2">
          {trail && <Trail items={trail} />}
          <h2 className={NAME}>{name}</h2>
        </div>
      </div>
      {facts && facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 min-[960px]:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="grid min-w-0 gap-1">
              <dt className="text-2xs font-bold tracking-eyebrow text-muted uppercase">
                {fact.label}
              </dt>
              <dd className="min-w-0 text-base break-words text-fg">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
