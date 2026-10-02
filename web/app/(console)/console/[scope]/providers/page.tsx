import type { components } from "@/lib/api.generated";
import { refusalSentence } from "@/lib/views/refusals";
import { request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";

import { readmeOf } from "@/lib/views/header";
import { providerTabs } from "@/lib/views/providers";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { EMPTY } from "@/content/empty";
import { PROVIDERS } from "@/content/screens/providers";
import { PermissionNotCleared } from "../../../ui/permission-not-cleared";
import { SubHeader } from "../../../ui/sub-header";
import { Screen } from "../../../shell/screen";
import { HarnessProviderTable } from "./_table";

type Body = components["schemas"]["Page_HarnessProviderRow_"];

/** Harness providers — 04 §10. A catalogue with switches: approval decides
 *  whose program holds a credential in memory, so only an organization admin
 *  sets it (PRD §9.1), and the switch is in the row — nothing is chosen from
 *  a list that the table already is. */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const scope = parseScope(await params);
  const { viewer } = await loadViewer(scope);
  const body = await request<Body>(
    `/v1/console/providers/harness?scope=${scopeQuery(scope)}`,
    await getToken(),
    { cache: "no-store" },
  );
  const personal = viewer.edition === "personal";
  const orgAdmin = viewer.role.level === "org-admin";
  return (
    <Screen
      bar={
        <SubHeader
          tabsLabel={PROVIDERS.title}
          tabs={providerTabs(scopeHref(scope), "harness")}
          readme={readmeOf(PROVIDERS.title, PROVIDERS.lede, PROVIDERS.about)}
          level={levelOf(scope, viewer)}
        />
      }
    >
      <div className="grid gap-4 px-6 pt-4 pb-10">
        <HarnessProviderTable
          rows={body.items}
          personal={personal}
          orgAdmin={orgAdmin}
          empty={EMPTY.providers.sentence}
        />
        {!orgAdmin && !personal && <PermissionNotCleared decider={refusalSentence("providers.approve")} />}
      </div>
    </Screen>
  );
}
