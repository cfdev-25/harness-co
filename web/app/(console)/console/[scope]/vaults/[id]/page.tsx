import type { components } from "@/lib/api.generated";
import { refusalSentence } from "@/lib/views/refusals";
import { request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";

import { BUNDLED, MACHINE, findingOf, filterSecrets } from "@/lib/views/vaults";
import { readmeOf } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { EMPTY } from "@/content/empty";
import { VAULTS, VAULTS_TEXT } from "@/content/screens/vaults";
import { Card } from "../../../../ui/card";
import { EntityHeader } from "../../../../ui/entity-header";
import { SubHeader } from "../../../../ui/sub-header";
import { PermissionNotCleared } from "../../../../ui/permission-not-cleared";
import { Screen } from "../../../../shell/screen";
import { SecretTable } from "./_secrets";
import { VaultWrites } from "./_writes";

type Body = components["schemas"]["Page_SecretRow_"];

/**
 * A vault's page — 04 §11. The bundled vault is the only one we may write to;
 * a customer's vault has no write verbs at all and links out instead (PRD
 * §6.2). The machine row states what we can and cannot do and lists nothing.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string; id: string }>;
  searchParams: Promise<{ finding?: string }>;
}) {
  const { scope: segment, id: raw } = await params;
  const { finding } = await searchParams;
  const scope = parseScope({ scope: segment });
  const id = decodeURIComponent(raw);
  const { viewer } = await loadViewer(scope);
  if (viewer.role.level !== "org-admin") {
    return (
      <Screen bar={<SubHeader level={levelOf(scope, viewer)} />}>
        <div className="px-6 pt-4">
          <PermissionNotCleared decider={refusalSentence("vaults.read")} />
        </div>
      </Screen>
    );
  }

  const machine = id === MACHINE;
  const bundled = id === BUNDLED;
  const body = machine
    ? { items: [] }
    : await request<Body>(
        `/v1/console/vaults/${encodeURIComponent(id)}/secrets?scope=${scopeQuery(scope)}`,
        await getToken(),
        { cache: "no-store" },
      );
  const rows = filterSecrets(body.items, findingOf(finding));

  return (
    <Screen
      bar={
        <SubHeader
          readme={readmeOf(
            machine ? VAULTS_TEXT.machineTitle : id,
            machine ? VAULTS_TEXT.machineNote : bundled ? VAULTS_TEXT.bundledNote : VAULTS_TEXT.customerNote,
          )}
          level={levelOf(scope, viewer)}
        />
      }
    >
      <div className="grid gap-6 px-6 pt-4 pb-10">
        <EntityHeader
          name={machine ? VAULTS_TEXT.machineTitle : id}
          trail={[{ label: VAULTS.title, href: scopeHref(scope, "/vaults") }, { label: id }]}
        />
        {!machine && (
          <Card title={VAULTS_TEXT.secretsTitle}>
            <SecretTable
              rows={rows}
              empty={EMPTY["vault.secrets"].sentence}
              finding={findingOf(finding)}
              base={`${scopeHref(scope, "/vaults")}/${encodeURIComponent(id)}`}
              vaultId={id}
              bundled={bundled}
            />
          </Card>
        )}
        {!machine && <VaultWrites vaultId={id} bundled={bundled} />}
      </div>
    </Screen>
  );
}
