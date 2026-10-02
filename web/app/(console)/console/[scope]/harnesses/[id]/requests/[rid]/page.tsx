import { notFound } from "next/navigation";
import { ApiError, request } from "@/lib/api";
import { parseScope, scopeHref } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import type { RequestView } from "@/lib/views/requests";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { REQUESTS, REQUESTS_WORDS as WORDS } from "@/content/screens/requests";
import { Card } from "../../../../../../ui/card";
import { Diff } from "../../../../../../ui/diff";
import { Notice } from "../../../../../../ui/notice";
import { EntityHeader } from "../../../../../../ui/entity-header";
import { SubHeader } from "../../../../../../ui/sub-header";
import { Tally } from "../../../../../../ui/tally";
import { Screen } from "../../../../../../shell/screen";
import { RequestAside } from "./_aside";

/** 04 §7's request page: the change on the left, the discussion on the right. */
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ scope: string; id: string; rid: string }>;
}) {
  const { scope: segment, id, rid } = await params;
  const scope = parseScope({ scope: segment });
  const base = scopeHref(scope, `/harnesses/${id}`);
  const { viewer } = await loadViewer(scope);

  let view: RequestView;
  try {
    view = await request<RequestView>(`/v1/console/requests/${rid}`, await getToken(), {
      cache: "no-store",
    });
  } catch (failure) {
    if (failure instanceof ApiError && failure.status === 404) notFound();
    throw failure;
  }

  const count = `${view.files.length} ${view.files.length === 1 ? WORDS.file : WORDS.files}`;

  return (
    <Screen
      asideSide="end"
      aside={<RequestAside view={view} />}
      bar={<SubHeader level={levelOf(scope, viewer)} />}
    >
      <div className="grid gap-4 px-6 pt-4 pb-10">
        <EntityHeader
          name={view.title}
          trail={[
            { label: REQUESTS.title, href: `${base}?view=requests&state=${view.state}` },
            { label: `${view.author.name} · ${count}` },
          ]}
        />
        {/* The author's reasoning is what the decision rests on, so it is on
            the page and not behind the name (01 §7.5). */}
        {view.reasoning && <p className="max-w-2xl text-md text-muted">{view.reasoning}</p>}
        {view.subject.kind === "role" ? (
          // D43: a role request is the same primitive with no files, so the
          // page is the reasoning, the discussion and the decision.
          <Notice tone="hold">{WORDS.roleAsk.replace("{team}", view.team.name)}</Notice>
        ) : (
          view.files.map((file) => (
            <Card
              key={file.assetId}
              title={file.path}
              actions={
                <>
                  <Tally added={file.added} removed={file.removed} />
                  {file.stale && (
                    <span className="text-xs text-warn">
                      {WORDS.proposed} · {WORDS.stale}
                    </span>
                  )}
                </>
              }
            >
              {file.diff.length > 0 ? <Diff hunks={file.diff} /> : <p className="text-base text-muted">{WORDS.stale}</p>}
            </Card>
          ))
        )}
      </div>
    </Screen>
  );
}

export const metadata = { title: REQUESTS.title };
