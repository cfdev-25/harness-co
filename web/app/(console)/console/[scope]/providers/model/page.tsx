import type { components } from "@/lib/api.generated";
import { refusalSentence } from "@/lib/views/refusals";
import { request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";

import { matrixRows, providerTabs } from "@/lib/views/providers";
import { readmeOf } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { EMPTY } from "@/content/empty";
import { PROVIDERS } from "@/content/screens/providers";
import { PermissionNotCleared } from "../../../../ui/permission-not-cleared";
import { SubHeader } from "../../../../ui/sub-header";
import { Screen } from "../../../../shell/screen";
import { ModelProviderTable } from "./_table";

type Body = components["schemas"]["Page_ModelProviderRow_"];
type Matrix = components["schemas"]["RoutingMatrix"];

/**
 * Model providers — 04 §10. W6-D5: routing is this table's two columns and two
 * verbs, and `GET /v1/console/routing` is read here as well as the rows,
 * because `PUT /v1/routing` writes the whole file and the subjects a verb may
 * pick are the server's list, labelled by the server (a harness id is a uuid).
 */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const scope = parseScope(await params);
  const { viewer } = await loadViewer(scope);
  const body = await request<Body>(
    `/v1/console/providers/model?scope=${scopeQuery(scope)}`,
    await getToken(),
    { cache: "no-store" },
  );
  const matrix = await request<Matrix>(
    `/v1/console/routing?scope=${scopeQuery(scope)}`,
    await getToken(),
    { cache: "no-store" },
  );
  const orgAdmin = viewer.role.level === "org-admin";
  // D42: a team admin sets their own team's default and nothing else, so the
  // picker is handed the one subject rather than a refusal.
  const only = scope.kind === "team" ? scope.path : null;
  return (
    <Screen
      bar={
        <SubHeader
          tabsLabel={PROVIDERS.title}
          tabs={providerTabs(scopeHref(scope), "model")}
          readme={readmeOf(PROVIDERS.title, PROVIDERS.lede, PROVIDERS.about)}
          level={levelOf(scope, viewer)}
        />
      }
    >
      <div className="grid gap-4 px-6 pt-4 pb-10">
        <ModelProviderTable
          rows={body.items}
          orgAdmin={orgAdmin}
          adminHere={viewer.adminHere}
          matrix={matrix}
          byTeam={matrixRows(matrix, only)}
          only={only}
          empty={EMPTY["providers.model"].sentence}
        />
        {!orgAdmin && <PermissionNotCleared decider={refusalSentence("providers.approve")} />}
      </div>
    </Screen>
  );
}
