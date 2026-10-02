import { notFound } from "next/navigation";
import { ApiError, request } from "@/lib/api";
import { parseScope, scopeHref } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import { readmeOf } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import {
  DIFFERENCES,
  compareOptions,
  differencesRows,
  allOrgOwned,
  fetchedVersion,
  harnessTabs,
  mayEdit,
  readVersion,
  readView,
  viewOptions,
  type HarnessView,
  type Page as Listing,
} from "@/lib/views/harness";
import { readState, type RequestView } from "@/lib/views/requests";
import { HARNESS, HARNESS_WORDS as WORDS } from "@/content/screens/harness";
import { PermissionNotCleared } from "../../../../ui/permission-not-cleared";
import { SubHeader } from "../../../../ui/sub-header";
import { Screen } from "../../../../shell/screen";
import { AppliesHere } from "./_applies";
import { EditHarness } from "./_edit";
import { HarnessHeader } from "./_header";
import { FilesView } from "./_files";
import { HistoryView } from "./_history";
import { RequestsPanel } from "./_requests";

/** 04 §5. One screen, three views (`?view`), one compare control (`?version`). */
export const dynamic = "force-dynamic";

type Search = { version?: string; view?: string; as?: string; state?: string };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string; id: string }>;
  searchParams: Promise<Search>;
}) {
  const { scope: segment, id } = await params;
  const scope = parseScope({ scope: segment });
  const search = await searchParams;
  const { viewer } = await loadViewer(scope);
  const panel = readView(search.view, viewer);
  const version = readVersion(search.version, scope, panel);
  const as = search.as ? `&as=${encodeURIComponent(search.as)}` : "";
  const token = await getToken();

  let view: HarnessView;
  try {
    view = await request<HarnessView>(
      `/v1/console/harnesses/${id}?version=${fetchedVersion(version)}${as}`,
      token,
      { cache: "no-store" },
    );
  } catch (failure) {
    if (!(failure instanceof ApiError)) throw failure;
    if (failure.status === 404) notFound();
    // 02 rule 11: a 403 renders the server's sentence where the view would be
    // — `?as` naming somebody the viewer does not administer is the usual one
    // — and never a disabled control or a stack (P13, D27).
    if (failure.status === 403) {
      return (
        <Screen bar={<SubHeader level={levelOf(scope, viewer)} />}>
          <div className="px-6 py-6">
            <PermissionNotCleared decider={`${failure.message} ${failure.remedy ?? ""}`.trim()} />
          </div>
        </Screen>
      );
    }
    throw failure;
  }

  // 03 D32: Differences is a client-side view over the two copies, so it is
  // the one selection that reads twice. Nothing else composes (K2).
  let rows = view.files;
  if (version === DIFFERENCES) {
    const theirs = await request<HarnessView>(
      `/v1/console/harnesses/${id}?version=team${as}`,
      token,
      { cache: "no-store" },
    );
    rows = differencesRows(view.files, theirs.files);
  }

  let requests: RequestView[] = [];
  const state = readState(search.state);
  if (panel === "requests") {
    const listing = await request<Listing<RequestView>>(
      `/v1/console/harnesses/${id}/requests?state=${state}`,
      token,
      { cache: "no-store" },
    );
    requests = listing.items;
  }

  const base = scopeHref(scope, `/harnesses/${id}`);
  const options = compareOptions(view, viewer, panel, { differences: WORDS.differences });

  return (
    <Screen
      asideSide="end"
      /* D131, W5-D7: the reach a session of this harness gets — the chain's
         walk narrowed by the harness's own step. `?? null` covers a response
         written before the field landed, where the line reads *not set*. */
      aside={<AppliesHere view={view} scope={scope} viewer={viewer} reach={view.reach ?? null} />}
      bar={
        <SubHeader
          tabsLabel={WORDS.viewLabel}
          tabs={harnessTabs(
            base,
            version,
            panel,
            options,
            viewOptions(viewer, WORDS.views),
            search.as ?? null,
          )}
          readme={readmeOf(view.def.name, view.def.description)}
          level={levelOf(scope, viewer)}
          actions={<EditHarness view={view} mayChange={mayEdit(view, viewer)} />}
        />
      }
    >
      <div className="grid gap-6 px-6 pt-4 pb-10">
        <HarnessHeader view={view} viewer={viewer} scope={scope} />
        {panel === "files" && (
          <FilesView
            rows={rows}
            base={base}
            version={version}
            as={search.as ?? null}
            identical={allOrgOwned(rows)}
          />
        )}
        {panel === "history" && <HistoryView view={view} rows={rows} />}
        {panel === "requests" && (
          <RequestsPanel requests={requests} state={state} base={base} />
        )}
      </div>
    </Screen>
  );
}

export const metadata = { title: HARNESS.title };
