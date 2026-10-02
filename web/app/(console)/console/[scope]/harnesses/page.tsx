import { request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import { readmeOf, searchIn } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadPersonalChoices, loadViewer } from "@/lib/views/viewer";
import type { HarnessCard, Page as Listing } from "@/lib/views/harness";
import type { Scope, Viewer } from "@/lib/views/types";
import { EMPTY } from "@/content/empty";
import { HARNESSES, HARNESSES_WORDS as WORDS } from "@/content/screens/harnesses";
import { EmptyState } from "../../../ui/empty-state";
import { SubHeader } from "../../../ui/sub-header";
import { Screen } from "../../../shell/screen";
import { Card } from "./_card";
import { Import } from "./_import";
import { LaunchNote } from "./_launch";
import { NewHarness } from "../_new-harness";

/** 04 §4. Cards carry no tag and no status (P11); everything else is inside. */
export const dynamic = "force-dynamic";

/** 05 §8's sentence for this scope and edition (07 D71), never a component's. */
function emptyFor(scope: Scope, viewer: Viewer) {
  if (scope.kind === "me") {
    return viewer.edition === "personal" ? EMPTY["harnesses.me.personal"] : EMPTY["harnesses.me"];
  }
  return EMPTY["harnesses.team"];
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const scope = parseScope(await params);
  const query = (await searchParams).q ?? "";
  const [{ viewer }, listing] = await Promise.all([
    loadViewer(scope),
    request<Listing<HarnessCard>>(`/v1/console/harnesses?scope=${scopeQuery(scope)}`, await getToken(), {
      cache: "no-store",
    }),
  ]);
  // W7-D4: the dialog's two extra questions, for a personal viewer only. One
  // read after the viewer, because the edition says whether to make it.
  const personal = await loadPersonalChoices(viewer);

  const needle = query.trim().toLowerCase();
  const cards = needle
    ? listing.items.filter(
        (card) =>
          card.name.toLowerCase().includes(needle) ||
          card.description.toLowerCase().includes(needle),
      )
    : listing.items;
  // 04 §4: at `org` the grid is grouped by team; at team and me there is one
  // group and the heading is not repeated.
  const groups = new Map<string, HarnessCard[]>();
  for (const card of cards) {
    const key = scope.kind === "org" ? card.team.name : "";
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  const level = levelOf(scope, viewer);
  const empty = emptyFor(scope, viewer);
  const count = cards.length === 1 ? WORDS.countOne : WORDS.countMany.replace("{n}", String(cards.length));

  return (
    <Screen
      bar={
        <SubHeader
          count={count}
          readme={readmeOf(HARNESSES.title, HARNESSES.lede, HARNESSES.about)}
          level={level}
          search={searchIn(scopeHref(scope, "/harnesses"), query, WORDS.searchPlaceholder)}
          actions={
            <>
              {/* 04 §4: beside *New harness* while there is nothing here —
                  the other way to a first harness is one you already have on
                  your machine. A dialog, because the command runs there. */}
              {listing.items.length === 0 && (
                <Import installed={viewer.setup?.installed ?? false} />
              )}
              <NewHarness
                scope={scope}
                cards={listing.items}
                canEdit={level.canEdit}
                personal={personal}
              />
            </>
          }
        />
      }
    >
      <div className="px-6 pt-4 pb-10">
        {cards.length === 0 ? (
          <EmptyState sentence={empty.sentence} />
        ) : (
          [...groups.entries()].map(([team, rows]) => (
            <section key={team} className="grid gap-3 pb-6">
              {team && <h2 className="text-lg font-semibold">{team}</h2>}
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]">
                {rows.map((card) => (
                  <Card key={card.id} card={card} scope={scope} />
                ))}
              </div>
            </section>
          ))
        )}
        {/* W5-D13: one line under the grid, because the page cannot detect
            whether `harness://` is registered on this machine. */}
        {cards.length > 0 && <LaunchNote />}
      </div>
    </Screen>
  );
}
