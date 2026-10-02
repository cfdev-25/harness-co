import { notFound } from "next/navigation";
import { refusalSentence } from "@/lib/views/refusals";
import { ApiError, request } from "@/lib/api";
import { parseScope, scopeHref } from "@/lib/scope";
import { shortTime } from "@/lib/views/harness";
import { getToken } from "@/lib/token.server";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import {
  mayRevoke,
  modelCell,
  providerCell,
  reachRows,
  refusalRows,
  slotRows,
  slotsOf,
  type SessionView,
} from "@/lib/views/session";
import { HIDDEN } from "@/content/empty";
import { LOGS_TEXT } from "@/content/screens/logs";
import { SESSIONS, SESSIONS_WORDS as WORDS } from "@/content/screens/sessions";
import { Card } from "../../../../../ui/card";
import { Chip } from "../../../../../ui/chip";
import { HiddenView } from "../../../../../ui/hidden-view";
import { Notice } from "../../../../../ui/notice";
import { EntityHeader } from "../../../../../ui/entity-header";
import { SubHeader } from "../../../../../ui/sub-header";
import { PermissionNotCleared } from "../../../../../ui/permission-not-cleared";
import { ScaleTag } from "../../../../../ui/scale-tag";
import { Screen } from "../../../../../shell/screen";
import { Tick } from "../_tick";
import { PreflightCard } from "./_report";
import { EndpointsTable, ReachTable, RefusalsTable, SlotsTable } from "./_tables";
import { Revoke } from "./_revoke";

/** 04 §13's session page: the report whole (P15), then slots, reach, tally. */
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ scope: string; id: string }>;
}) {
  const { scope: segment, id } = await params;
  const scope = parseScope({ scope: segment });
  const [{ viewer }, session] = await Promise.all([
    loadViewer(scope),
    read(id, await getToken()),
  ]);

  const hiddenLogs = scope.kind === "me" && !viewer.visibility.logs;
  const slots = slotRows(slotsOf(session), WORDS.resolved);
  const reach = reachRows(session.preflight, WORDS.reach, viewer);
  // W6-D9. Only when there is one: a session with nothing refused says
  // nothing, because an empty card reads like a feature that failed.
  const refusals = refusalRows(session.refusals ?? [], viewer);

  return (
    <Screen
      bar={
        <SubHeader
          level={levelOf(scope, viewer)}
          actions={
            mayRevoke(session, viewer) ? (
              <Revoke id={session.id} viewer={viewer} />
            ) : session.status === "active" ? (
              <PermissionNotCleared decider={refusalSentence("sessions.revoke")} />
            ) : null
          }
        />
      }
    >
      <div className="grid gap-4 px-6 pt-4 pb-10">
        <EntityHeader
          name={session.person.name}
          trail={[
            { label: LOGS_TEXT.title, href: scopeHref(scope, "/logs/changes") },
            { label: SESSIONS.title, href: scopeHref(scope, "/logs/sessions") },
            // The harness is a fact about this session, so it is the last
            // crumb like every other detail page's object, not a lede.
            { label: session.harness?.name ?? "" },
          ]}
          facts={[
            { label: SESSIONS.columns.provider.heading, value: providerCell(session) },
            { label: SESSIONS.columns.model.heading, value: modelCell(session, WORDS.notMetered) },
            {
              label: SESSIONS.columns.status.heading,
              value: <ScaleTag scale="session" value={session.status} size="sm" />,
            },
            { label: WORDS.head.started, value: shortTime(session.startedAt) },
            { label: WORDS.head.lastActive, value: shortTime(session.lastActiveAt) },
            { label: WORDS.head.closed, value: shortTime(session.closedAt) || "—" },
          ]}
        />
        <PreflightCard report={session.preflight} viewer={viewer} />
        <Card title={WORDS.cards.slots}>
          <SlotsTable rows={slots} />
        </Card>
        <Card title={WORDS.cards.reach}>
          <ReachTable rows={reach} />
        </Card>
        {refusals.length > 0 && (
          <Card title={WORDS.cards.refusals}>
            <p className="pb-3 text-base text-muted">{WORDS.refusalsLede}</p>
            <RefusalsTable rows={refusals} />
          </Card>
        )}
        <Card title={WORDS.cards.endpoints}>
          {hiddenLogs ? (
            <HiddenView view="logs" note={HIDDEN.logs} />
          ) : (
            <EndpointsTable rows={session.endpointsTally} />
          )}
        </Card>
        <Card title={WORDS.cards.definitions}>
          <dl className="grid gap-2">
            {Object.entries(session.commits).map(([ref, commit]) => (
              <div key={ref} className="flex items-baseline justify-between gap-3">
                <dt className="font-mono text-xs text-muted">{ref}</dt>
                <dd>
                  <a href={scopeHref(scope, "/logs/changes")} className="no-underline">
                    <Chip title={commit}>{commit.slice(0, 7)}</Chip>
                  </a>
                </dd>
              </div>
            ))}
          </dl>
        </Card>
        {session.revokedReason && (
          <Card title={WORDS.cards.revoked}>
            <Notice tone="warn">{session.revokedReason}</Notice>
          </Card>
        )}
        {session.status === "active" && <Tick />}
      </div>
    </Screen>
  );
}

async function read(id: string, token: string | null): Promise<SessionView> {
  try {
    return await request<SessionView>(`/v1/console/sessions/${id}`, token, { cache: "no-store" });
  } catch (failure) {
    if (failure instanceof ApiError && (failure.status === 404 || failure.status === 403)) notFound();
    throw failure;
  }
}
