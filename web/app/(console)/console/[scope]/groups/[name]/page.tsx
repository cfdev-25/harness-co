import type { components } from "@/lib/api.generated";
import { notFound } from "next/navigation";
import { ApiError, request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import { record, related } from "@/lib/views/cells";
import { fill } from "@/lib/views/refusals";
import { edgeList } from "@/lib/views/assets";
import { sourcesOf } from "@/lib/views/groups";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { GROUPS, GROUPS_TEXT } from "@/content/screens/groups";
import { Card } from "../../../../ui/card";
import { KeyValue } from "../../../../ui/key-value";
import { Line } from "../../../../ui/line";
import { EntityHeader } from "../../../../ui/entity-header";
import { SubHeader } from "../../../../ui/sub-header";
import { Related } from "../../../../ui/related";
import { Screen } from "../../../../shell/screen";
import { EntryTable } from "./_entries";
import { ChangeSources } from "./_sources";
import { AddEntry } from "./_verbs";

type Group = components["schemas"]["GroupRow"];

/** The group page — 04 §8: entries, then the three relationships, then the
 *  `EdgeWalk` as the last two cards, directed and never merged (P1). */
export default async function Page({
  params,
}: {
  params: Promise<{ scope: string; name: string }>;
}) {
  const { scope: segment, name } = await params;
  const scope = parseScope({ scope: segment });
  const group = await read(decodeURIComponent(name), scopeQuery(scope));
  const { viewer } = await loadViewer(scope);
  const walk = record(group.edges);
  const narrowed = related(group.narrowed, "groups");
  const orgAdmin = viewer.role.level === "org-admin";
  // 04 §8: the entry form names a vault, so the page fetches the list the
  // admin may choose from. Nobody else is offered the verb.
  const vaults = orgAdmin ? await readVaults(scopeQuery(scope)) : [];

  return (
    <Screen
      bar={
        <SubHeader
          level={levelOf(scope, viewer)}
          actions={
            orgAdmin ? (
              <>
                <ChangeSources name={group.name} sources={group.sources ?? "vault"} />
                <AddEntry name={group.name} entries={group.entries} vaults={vaults} />
              </>
            ) : undefined
          }
        />
      }
    >
      <div className="grid gap-6 px-6 pt-4 pb-10">
        <EntityHeader
          name={group.name}
          trail={[
            { label: GROUPS.title, href: scopeHref(scope, "/groups") },
            { label: group.name },
          ]}
          facts={[
            { label: GROUPS.columns.sources.heading, value: sourcesOf(group.sources) },
            { label: GROUPS.columns.gives.heading, value: entryCount(group.entries.length) },
          ]}
        />
        <Card title={GROUPS_TEXT.entriesTitle}>
          <EntryTable name={group.name} entries={group.entries} mayEdit={orgAdmin} />
        </Card>
        <Card>
          <KeyValue
            items={[
              {
                k: GROUPS_TEXT.grantedTo,
                v: <Related value={related(group.teams, "teams")} />,
                help: GROUPS.columns.grantedTo.help,
              },
              {
                k: GROUPS_TEXT.onlyFor,
                v: <Related value={related(group.harnesses, "harnesses")} />,
                help: GROUPS.columns.onlyFor.help,
              },
              {
                k: GROUPS_TEXT.narrowedFrom,
                v: <Related value={narrowed} />,
                help: GROUPS.columns.narrowedFrom.help,
              },
            ]}
          />
        </Card>
        <Card title={GROUPS_TEXT.restedOnBy}>
          <Edges value={walk.restedOnBy} />
        </Card>
        <Card title={GROUPS_TEXT.restsOn}>
          <Edges value={walk.restsOn} />
        </Card>
      </div>
    </Screen>
  );
}

function entryCount(n: number): string {
  return n === 1 ? GROUPS_TEXT.givesOneEntry : fill(GROUPS_TEXT.givesEntries, { n: String(n) });
}

function Edges({ value }: { value: unknown }) {
  const edges = edgeList(value);
  if (edges.length === 0) return <Line name="—" />;
  return (
    <>
      {edges.map((edge) => (
        <Line key={`${edge.kind}-${edge.id}`} name={edge.label || edge.id} note={edge.via} />
      ))}
    </>
  );
}

async function readVaults(scope: string): Promise<string[]> {
  const body = await request<components["schemas"]["Page_VaultRow_"]>(
    `/v1/console/vaults?scope=${scope}`,
    await getToken(),
    { cache: "no-store" },
  );
  return body.items.map((vault) => vault.id);
}

async function read(name: string, scope: string): Promise<Group> {
  try {
    return await request<Group>(
      `/v1/console/groups/${encodeURIComponent(name)}?scope=${scope}`,
      await getToken(),
      { cache: "no-store" },
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

