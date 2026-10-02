import type { components } from "@/lib/api.generated";
import { refusalSentence } from "@/lib/views/refusals";
import { request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";

import { readmeOf } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { EMPTY } from "@/content/empty";
import { VAULTS, VAULTS_TEXT } from "@/content/screens/vaults";
import { Card } from "../../../ui/card";
import { Notice } from "../../../ui/notice";
import { PermissionNotCleared } from "../../../ui/permission-not-cleared";
import { SubHeader } from "../../../ui/sub-header";
import { Screen } from "../../../shell/screen";
import { ConnectVault } from "./_connect";
import { VaultTable } from "./_table";

type Body = components["schemas"]["Page_VaultRow_"];

/**
 * Key vaults — 04 §11. An organisation admin's screen; a deep link from
 * anywhere else renders the refusal rather than a shorter list. The person's
 * own machine is a row, so no row has a blank provider (PRD §6.2).
 */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const scope = parseScope(await params);
  const { viewer } = await loadViewer(scope);
  if (viewer.role.level !== "org-admin") {
    return (
      <Screen
        bar={
          <SubHeader
            readme={readmeOf(VAULTS.title, VAULTS.lede)}
            level={levelOf(scope, viewer)}
          />
        }
      >
        <div className="px-6">
          <PermissionNotCleared decider={refusalSentence("vaults.read")} />
        </div>
      </Screen>
    );
  }

  const body = await request<Body>(
    `/v1/console/vaults?scope=${scopeQuery(scope)}`,
    await getToken(),
    { cache: "no-store" },
  );

  return (
    <Screen
      bar={
        <SubHeader
          readme={readmeOf(VAULTS.title, VAULTS.lede)}
          level={levelOf(scope, viewer)}
          actions={<ConnectVault />}
        />
      }
    >
      <div className="grid gap-6 px-6 pt-4 pb-10">
        <VaultTable
          rows={body.items}
          empty={EMPTY.vaults.sentence}
          hrefFor={scopeHref(scope, "/vaults")}
        />
        <Card title={VAULTS_TEXT.connectYourOwn}>
          <Notice tone="neutral">{VAULTS_TEXT.connectYourOwnNote}</Notice>
        </Card>
      </div>
    </Screen>
  );
}
