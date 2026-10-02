import Link from "next/link";
import { scopeHref } from "@/lib/scope";
import { alsoAtWord, scopeOfPath, type HarnessCard } from "@/lib/views/harness";
import type { Scope } from "@/lib/views/types";
import { HARNESSES_WORDS as WORDS } from "@/content/screens/harnesses";
import { Mono } from "../../../ui/mono";
import { PixelArt } from "../../../ui/pixel-art";
import { Related } from "../../../ui/related";
import { Launch } from "./_launch";

/**
 * One card of the grid (04 §4). A server component, extracted from `page.tsx`
 * so the whole card — overlay link, team cell and W5-D13's launch row — can be
 * mounted and pressed in a component test: the one thing worth proving here is
 * that the overlay does not swallow a runtime button.
 *
 * The card is the link, but its team cell is a link too, and an anchor may not
 * nest: the name carries an overlay link instead, the same way `ui/table` does,
 * and everything that must stay clickable sits above it at `z-10`.
 */
export function Card({ card, scope }: { card: HarnessCard; scope: Scope }) {
  return (
    <div className="relative grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-card hover:border-accent">
      <div className="flex items-start gap-3">
        <PixelArt icon={card.icon ?? undefined} size={56} alt={card.name} />
        <span className="grid min-w-0 gap-1">
          <Link
            href={scopeHref(scope, `/harnesses/${card.id}`)}
            className="truncate text-md font-semibold text-fg no-underline after:absolute after:inset-0"
          >
            {card.name}
          </Link>
          <span className="line-clamp-2 text-base text-muted">{card.description}</span>
        </span>
      </div>
      <div className="relative z-10 flex items-center justify-between gap-3">
        <Related
          value={{
            unit: "teams",
            items: [
              {
                id: card.team.path,
                label: card.team.name,
                href: scopeHref(scopeOfPath(card.team.path), "/harnesses"),
              },
            ],
          }}
        />
        <Mono>
          {card.fileCount} {card.fileCount === 1 ? WORDS.fileOne : WORDS.files}
        </Mono>
      </div>
      {/* W5-D9: the same id on another node of the chain is the same harness
          read at that level, not a second card. The nearest copy is this
          card; these are the rest. */}
      {(card.alsoAt ?? []).length > 0 && (
        <div className="relative z-10 flex flex-wrap items-baseline gap-2 text-xs text-muted">
          <span>{WORDS.alsoAt}</span>
          {(card.alsoAt ?? []).map((also) => (
            <Link key={also.href} href={also.href} className="text-accent-text hover:underline">
              {alsoAtWord(also)}
            </Link>
          ))}
        </div>
      )}
      <Launch card={card} />
    </div>
  );
}
