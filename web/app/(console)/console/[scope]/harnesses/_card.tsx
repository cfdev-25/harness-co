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
 * One card of the grid (04 §4). Three rows and no more (D107): the title row
 * — mark, name, description — then one meta row of facts, then one action
 * row. A server component, extracted from `page.tsx` so the whole card can be
 * mounted and pressed in a component test: the one thing worth proving here
 * is that the overlay does not swallow a runtime button.
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
      {/* D107: one meta row. Team, file count and — W5-D9 — the same id read
          at the other levels of the chain, which is the same harness and not
          a second card. Three facts on one line read as facts; on three
          lines they read as three sections of a card that has none. */}
      <div className="relative z-10 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
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
        {(card.alsoAt ?? []).length > 0 && (
          <span className="flex flex-wrap items-center gap-2">
            <span>{WORDS.alsoAt}</span>
            {(card.alsoAt ?? []).map((also) => (
              <Link key={also.href} href={also.href} className="text-accent-text hover:underline">
                {alsoAtWord(also)}
              </Link>
            ))}
          </span>
        )}
      </div>
      <Launch card={card} />
    </div>
  );
}
