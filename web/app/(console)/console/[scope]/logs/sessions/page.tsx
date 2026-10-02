import { request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import { readmeOf } from "@/lib/views/header";
import { tabs } from "@/lib/views/logs";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import type { Page as Listing } from "@/lib/views/harness";
import { readFilters, sessionsQuery, type SessionRow } from "@/lib/views/session";
import { EMPTY } from "@/content/empty";
import { LOGS, LOGS_TEXT } from "@/content/screens/logs";
import { SESSIONS, SESSIONS_WORDS as WORDS } from "@/content/screens/sessions";
import { SubHeader } from "../../../../ui/sub-header";
import { Screen } from "../../../../shell/screen";
import { SessionFilters } from "./_filters";
import { SessionList } from "./_list";
import { Tick } from "./_tick";

/** 04 §13, as the Sessions tab of Logs (04 §14). The founder's window on the
 *  backbone, at all three scopes (D44). */
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const scope = parseScope(await params);
  const filters = readFilters(await searchParams);
  const query = sessionsQuery(filters).replace("?", "&");
  const [{ viewer }, listing] = await Promise.all([
    loadViewer(scope),
    request<Listing<SessionRow>>(`/v1/console/sessions?scope=${scopeQuery(scope)}${query}`, await getToken(), {
      cache: "no-store",
    }),
  ]);

  const rows = listing.items;
  const live = rows.some((row) => row.status === "active");

  return (
    <Screen
      bar={
        <SubHeader
          tabsLabel={LOGS_TEXT.title}
          tabs={tabs(scopeHref(scope), viewer, "sessions")}
          count={rows.length === 1 ? WORDS.countOne : WORDS.countMany.replace("{n}", String(rows.length))}
          readme={readmeOf(LOGS_TEXT.title, SESSIONS.lede, LOGS.about)}
          level={levelOf(scope, viewer)}
          actions={<SessionFilters filters={filters} base={scopeHref(scope, "/logs/sessions")} />}
        />
      }
    >
      <div className="grid gap-4 px-6 pt-4 pb-10">
        {rows.length === 0 ? (
          <p className="py-10 text-md text-muted">{EMPTY.sessions.sentence}</p>
        ) : (
          <SessionList rows={rows} base={scopeHref(scope, "/logs/sessions")} personal={viewer.edition === "personal"} />
        )}
        {/* P2: an active session's *last active* is observed, so the screen
            re-reads it on the supervise tick and stores nothing. */}
        {live && <Tick />}
      </div>
    </Screen>
  );
}
