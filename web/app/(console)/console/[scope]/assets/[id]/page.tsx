import type { components } from "@/lib/api.generated";
import { refusalSentence } from "@/lib/views/refusals";
import { notFound } from "next/navigation";
import { request, ApiError } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";

import { assetRelated, edges, loadsValue, sidecarFacts } from "@/lib/views/assets";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { ASSETS, ASSETS_TEXT } from "@/content/screens/assets";
import { Card } from "../../../../ui/card";
import { KeyValue } from "../../../../ui/key-value";
import { Line } from "../../../../ui/line";
import { EntityHeader } from "../../../../ui/entity-header";
import { SubHeader } from "../../../../ui/sub-header";
import { PermissionNotCleared } from "../../../../ui/permission-not-cleared";
import { Related } from "../../../../ui/related";
import { ScaleTag } from "../../../../ui/scale-tag";
import { Screen } from "../../../../shell/screen";
import { SetLoads } from "./_loads";

type Asset = components["schemas"]["OrgAssetRow"];

/** The asset page — 04 §12: sidecar facts, *Loads*, the reverse view, then
 *  `EdgeWalk` as the last two cards, directed and never merged (P1). */
export default async function Page({
  params,
}: {
  params: Promise<{ scope: string; id: string }>;
}) {
  const { scope: segment, id } = await params;
  const scope = parseScope({ scope: segment });
  const { viewer } = await loadViewer(scope);
  const asset = await read(id, scopeQuery(scope));
  const links = assetRelated(asset);
  const walk = edges(asset);
  const orgAdmin = viewer.role.level === "org-admin";

  return (
    <Screen bar={<SubHeader level={levelOf(scope, viewer)} />}>
      <div className="grid gap-6 px-6 pt-4 pb-10">
        <EntityHeader
          name={asset.name}
          trail={[{ label: ASSETS.title, href: scopeHref(scope, "/assets") }, { label: asset.name }]}
          facts={[
            { label: ASSETS.columns.type.heading, value: asset.kind },
            {
              label: ASSETS_TEXT.loadsLabel,
              value: <ScaleTag scale="loads" value={loadsValue(asset)} />,
            },
          ]}
        />
        <Card title={ASSETS_TEXT.sidecar}>
          <KeyValue items={sidecarFacts(asset).map((fact) => ({ k: fact.k, v: fact.v }))} />
        </Card>
        <Card title={ASSETS_TEXT.loadsLabel}>
          {orgAdmin ? (
            <SetLoads assetId={asset.id} loads={loadsValue(asset)} />
          ) : (
            <PermissionNotCleared decider={refusalSentence("assets.loads")} />
          )}
        </Card>
        <Card title={ASSETS_TEXT.reverse}>
          <KeyValue
            items={[
              { k: ASSETS.columns.usedBy.heading, v: <Related value={links.harnesses} /> },
              { k: "Teams", v: <Related value={links.teams} /> },
              { k: ASSETS.columns.needsGroups.heading, v: <Related value={links.groups} /> },
            ]}
          />
        </Card>
        <Card title={ASSETS_TEXT.restedOnBy}>
          {walk.restedOnBy.map((edge) => (
            <Line key={`${edge.kind}-${edge.id}`} name={edge.label || edge.id} note={edge.via} />
          ))}
          {walk.restedOnBy.length === 0 && <Line name="—" />}
        </Card>
        <Card title={ASSETS_TEXT.restsOn}>
          {walk.restsOn.map((edge) => (
            <Line key={`${edge.kind}-${edge.id}`} name={edge.label || edge.id} note={edge.via} />
          ))}
          {walk.restsOn.length === 0 && <Line name="—" />}
        </Card>
      </div>
    </Screen>
  );
}

async function read(id: string, scope: string): Promise<Asset> {
  try {
    return await request<Asset>(`/v1/console/assets/${id}?scope=${scope}`, await getToken(), {
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
