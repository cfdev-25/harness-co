import { notFound } from "next/navigation";
import { ApiError, request } from "@/lib/api";
import { parseScope, scopeHref } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import { readmeOf } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import {
  isConflict,
  isUnanswered,
  ownerLineId,
  ownerName,
  readVersion,
  shownContent,
  type FileView,
  type HarnessView,
} from "@/lib/views/harness";
import { fill } from "@/lib/views/requests";
import { EMPTY } from "@/content/empty";
import { FILE, FILE_WORDS as WORDS } from "@/content/screens/file";
import { Notice } from "../../../../../../ui/notice";
import { EntityHeader } from "../../../../../../ui/entity-header";
import { SubHeader } from "../../../../../../ui/sub-header";
import { Screen } from "../../../../../../shell/screen";
import { FileBody } from "./_body";
import { FileHistory } from "./_history";
import { Siblings } from "./_siblings";

/** 04 §6. The owner line comes first (PRD §17.1); the editor is not here. */
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string; id: string; assetId: string }>;
  searchParams: Promise<{ version?: string; as?: string }>;
}) {
  const { scope: segment, id, assetId } = await params;
  const scope = parseScope({ scope: segment });
  const search = await searchParams;
  const version = readVersion(search.version, scope, "files");
  const as = search.as ? `&as=${encodeURIComponent(search.as)}` : "";
  const token = await getToken();

  let file: FileView;
  let harness: HarnessView;
  try {
    [file, harness] = await Promise.all([
      request<FileView>(`/v1/console/harnesses/${id}/files/${assetId}?version=${version}${as}`, token, {
        cache: "no-store",
      }),
      request<HarnessView>(`/v1/console/harnesses/${id}?version=${version === "team" ? "team" : "mine"}${as}`, token, {
        cache: "no-store",
      }),
    ]);
  } catch (failure) {
    if (failure instanceof ApiError && failure.status === 404) notFound();
    throw failure;
  }
  const { viewer } = await loadViewer(scope);

  const base = scopeHref(scope, `/harnesses/${id}`);
  const query = new URLSearchParams({ version });
  if (search.as) query.set("as", search.as);
  const owner = ownerLineId(file.row.owner);
  const ownerLine = fill(WORDS.owner[owner], { name: ownerName(file.row.owner) });

  return (
    <Screen
      asideSide="start"
      aside={<Siblings rows={harness.files} base={base} query={query.toString()} current={assetId} />}
      bar={
        <SubHeader
          readme={readmeOf(file.row.path, ownerLine)}
          level={levelOf(scope, viewer)}
        />
      }
    >
      <div className="grid gap-6 px-6 pt-4 pb-10">
        <EntityHeader
          name={file.row.path}
          trail={[{ label: harness.def.name, href: `${base}?${query.toString()}` }]}
        />
        {/* The sentence itself is behind the bar's readme mark; this is the
            owner word on its own, so a test can read which of the four it is. */}
        <span data-owner-line={owner} hidden />
        {file.request?.state === "open" && <Notice tone="hold">{WORDS.openRequest}</Notice>}
        {isUnanswered(file) ? (
          <Notice tone="warn">{EMPTY["file.content"].sentence}</Notice>
        ) : (
          <FileBody
            conflict={isConflict(file)}
            mine={file.content.mine}
            team={file.content.team}
            content={shownContent(file, version)}
            diff={file.diff ?? []}
            path={file.row.path}
          />
        )}
        <FileHistory history={file.history} />
      </div>
    </Screen>
  );
}

export const metadata = { title: FILE.title };
