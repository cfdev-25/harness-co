import { request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import {
  type AssetsPage,
  type BrowsePage,
  assetsCount,
  assetsEmptyId,
  assetsLede,
  currentKind,
  kindTabs,
  ofKind,
} from "@/lib/views/assets";
import type { HarnessCard } from "@/lib/views/harness";
import { readmeOf, searchIn } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadPersonalChoices, loadViewer } from "@/lib/views/viewer";
import { EMPTY, HIDDEN } from "@/content/empty";
import { ASSETS, ASSETS_TEXT } from "@/content/screens/assets";
import type { Hidden } from "@/lib/views/types";
import { HiddenView } from "../../../ui/hidden-view";
import { SubHeader } from "../../../ui/sub-header";
import { Screen } from "../../../shell/screen";
import { AssetTable } from "./_table";
import { Browse } from "./_browse";

/**
 * Assets — 04 §12, W5-D9. One screen at every level: at *You* the person's
 * own copies, at a team the team's, at the organization the organization's.
 * The tabs are the organization's kinds and the current one is `?kind=`
 * (a filter inside one screen, so a query and not a route — 02 rule 16).
 * The verbs are the level admin's; at *You* that is always the person, which
 * is why the personal edition has the screen too.
 *
 * W5-D15 adds one more tab, `?tab=browse`: the store. It is the same screen —
 * one directory, one set of verbs — asking the other question, *what could I
 * use*, where the kinds answer *what is on this branch*. An organization that
 * sets `visibility.store: false` has no such tab and the route answers the
 * note in its place (P10).
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string }>;
  searchParams: Promise<{ kind?: string; tab?: string; q?: string }>;
}) {
  const scope = parseScope(await params);
  const asked = await searchParams;
  const { viewer } = await loadViewer(scope);
  const store = viewer.visibility.store !== false;
  const browsing = store && asked.tab === "browse";
  const level = levelOf(scope, viewer);
  const [body, browse, harnesses, mine, personal] = await Promise.all([
    read<AssetsPage>(`/v1/console/assets?scope=${scopeQuery(scope)}`),
    browsing ? read<BrowsePage & { hidden?: Hidden }>(
      `/v1/console/assets/browse?scope=${scopeQuery(scope)}`) : null,
    browsing ? read<{ items: HarnessCard[] }>("/v1/console/harnesses?scope=me") : null,
    // The *Included in* checklist of an editing row: the harnesses of this
    // level, fetched here because a table does not fetch (01 rule 2), and only
    // where the row has verbs at all.
    !browsing && level.canEdit
      ? read<{ items: HarnessCard[] }>(`/v1/console/harnesses?scope=${scopeQuery(scope)}`)
      : null,
    // W7-D4: *New harness from selection* is the harnesses screen's dialog, so
    // on a personal account it asks the same two questions. Only when the
    // store is open, because that is the only tab that mounts it.
    browsing ? loadPersonalChoices(viewer) : null,
  ]);
  const kind = browsing ? (asked.kind ?? "") : currentKind(body.kinds, body.items, asked.kind);
  const rows = ofKind(body.items, kind);
  const empty = EMPTY[assetsEmptyId(scope)];
  const base = scopeHref(scope, "/assets");
  const query = asked.q ?? "";
  // The bar's search writes `?q=` beside whichever tab is open, so the kind
  // and the store survive a keystroke (02 rule 16).
  const here = browsing
    ? `${base}?tab=browse${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`
    : `${base}?kind=${encodeURIComponent(kind)}`;
  const tabs = [
    ...kindTabs(body.kinds, body.items, browsing ? "" : kind, base),
    ...(store
      ? [{ id: "browse", label: ASSETS_TEXT.browseTab, href: `${base}?tab=browse`,
           current: browsing, group: "store" }]
      : []),
  ];

  return (
    <Screen
      bar={
        <SubHeader
          tabsLabel={ASSETS_TEXT.kinds}
          tabs={tabs}
          count={browsing ? undefined : assetsCount(rows.length)}
          readme={readmeOf(ASSETS.title, assetsLede(scope), [ASSETS_TEXT.browseExplain])}
          level={level}
          search={searchIn(here, query, ASSETS_TEXT.searchPlaceholder)}
        />
      }
    >
      <div className="grid gap-4 px-6 pt-4 pb-10">
        {browsing && browse ? (
          browse.hidden ? (
            <HiddenView view="store" note={HIDDEN.store} />
          ) : (
            <Browse
              rows={browse.items}
              harnesses={harnesses?.items ?? []}
              scope={scope}
              kind={kind}
              base={base}
              query={query}
              personal={personal ?? undefined}
            />
          )
        ) : (
          <AssetTable
            rows={rows}
            query={query}
            empty={empty.sentence}
            hrefFor={base}
            canEdit={level.canEdit}
            orgAdmin={viewer.role.level === "org-admin"}
            personal={viewer.edition === "personal"}
            // At a team the read carries the chain (`scope_paths`), so the
            // organization's harnesses come with it; the checklist offers this
            // level's own. At *You* the whole list is the person's to write —
            // a tick there writes their version of the harness (D93).
            harnesses={(mine?.items ?? []).filter(
              (card) => scope.kind !== "team" || card.team.path === scope.path,
            )}
            scope={scopeQuery(scope)}
          />
        )}
      </div>
    </Screen>
  );
}

async function read<T>(path: `/v1/${string}`): Promise<T> {
  return request<T>(path, await getToken(), { cache: "no-store" });
}
