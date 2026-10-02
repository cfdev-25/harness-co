import type { components } from "@/lib/api.generated";
import { notFound } from "next/navigation";
import { request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import { fill } from "@/lib/views/refusals";
import { categoryOf, tabs } from "@/lib/views/logs";
import { readmeOf, searchIn } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { EMPTY, HIDDEN } from "@/content/empty";
import { LOGS, LOGS_TEXT } from "@/content/screens/logs";
import { HiddenView } from "../../../../ui/hidden-view";
import { SubHeader } from "../../../../ui/sub-header";
import { Screen } from "../../../../shell/screen";
import { LogTable } from "./_table";

type Body = components["schemas"]["Page_LogRow_"];

/**
 * Logs — 04 §14. One page, one tab per route, filtered to the scope. At `me`
 * with `visibility.logs === false` every tab is a `HiddenView` naming the
 * decision (P10): never a shorter list, never silence.
 *
 * The first tab is **Changes**; `harness` stays the category `api` answers
 * to, and the old `/logs/harness` address is its own redirect beside this
 * route.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string; category: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { scope: segment, category: route } = await params;
  const query = (await searchParams).q ?? "";
  const scope = parseScope({ scope: segment });
  const category = categoryOf(route);
  if (category === null) notFound();
  const { viewer } = await loadViewer(scope);
  const body = await request<Body>(
    `/v1/console/logs/${category}?scope=${scopeQuery(scope)}`,
    await getToken(),
    { cache: "no-store" },
  );

  const where = scope.kind === "team" ? scope.path.split(".").slice(-1)[0] : scope.kind === "me" ? "you" : "the organisation";
  return (
    <Screen
      bar={
        <SubHeader
          tabsLabel={LOGS_TEXT.title}
          tabs={tabs(scopeHref(scope), viewer, route)}
          readme={readmeOf(LOGS_TEXT.title, fill(LOGS_TEXT.ledeFor, { scope: where }), LOGS.about)}
          level={levelOf(scope, viewer)}
          search={searchIn(scopeHref(scope, `/logs/${route}`), query, LOGS_TEXT.searchPlaceholder)}
        />
      }
    >
      <div className="grid gap-4 px-6 pt-4 pb-10">
        {body.hidden ? (
          <HiddenView view="logs" note={HIDDEN.logs} />
        ) : (
          <LogTable
            rows={body.items}
            query={query}
            category={category}
            atMe={scope.kind === "me"}
            empty={fill(EMPTY["logs.scope"].sentence, { scope: where })}
          />
        )}
      </div>
    </Screen>
  );
}
