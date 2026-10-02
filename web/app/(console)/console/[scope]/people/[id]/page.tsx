import type { components } from "@/lib/api.generated";
import { refusalSentence } from "@/lib/views/refusals";
import { notFound } from "next/navigation";
import { ApiError, request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import { personDetail, personName, personTeams, removalLists, roleOf } from "@/lib/views/people";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { PEOPLE, PEOPLE_TEXT } from "@/content/screens/people";
import { Button } from "../../../../ui/button";
import { Card } from "../../../../ui/card";
import { KeyValue } from "../../../../ui/key-value";
import { EntityHeader } from "../../../../ui/entity-header";
import { SubHeader } from "../../../../ui/sub-header";
import { PermissionNotCleared } from "../../../../ui/permission-not-cleared";
import { Related } from "../../../../ui/related";
import { ScaleTag } from "../../../../ui/scale-tag";
import { Screen } from "../../../../shell/screen";
import { PersonVerbs } from "./_verbs";

type Person = components["schemas"]["PersonRow"];
type Preview = components["schemas"]["RemovalPreview"];

/** A person's page — 04 §15: teams, role, sessions, and **Remove** with the
 *  server's `RemovalPreview` as the confirmation (§18). */
export default async function Page({
  params,
}: {
  params: Promise<{ scope: string; id: string }>;
}) {
  const { scope: segment, id } = await params;
  const scope = parseScope({ scope: segment });
  const { viewer } = await loadViewer(scope);
  const token = await getToken();
  const query = scopeQuery(scope);
  const person = await read<Person>(`/v1/console/people/${id}?scope=${query}`, token);
  const preview = await readOrNull<Preview>(`/v1/console/people/${id}/removal?scope=${query}`, token);
  const detail = personDetail(person);
  const level = viewer.role.level;
  const teams = personTeams(person);

  return (
    <Screen bar={<SubHeader level={levelOf(scope, viewer)} />}>
      <div className="grid gap-6 px-6 pt-4 pb-10">
        <EntityHeader
          name={personName(person)}
          trail={[{ label: PEOPLE.title, href: scopeHref(scope, "/people") }, { label: personName(person) }]}
          facts={[
            { label: PEOPLE.columns.role.heading, value: <ScaleTag scale="role" value={roleOf(person)} /> },
            { label: PEOPLE.columns.state.heading, value: person.state },
            { label: PEOPLE_TEXT.personSessions, value: `${detail.sessions}` },
          ]}
        />
        <Card>
          <KeyValue
            items={[
              { k: PEOPLE_TEXT.personTeams, v: <Related value={teams} />, help: PEOPLE.columns.teams.help },
              { k: PEOPLE.columns.groups.heading, v: <Related value={detail.groups} /> },
              { k: PEOPLE_TEXT.personReadableBy, v: <Related value={detail.readableBy} /> },
              {
                k: PEOPLE_TEXT.personSessions,
                v: (
                  <Button href={`${scopeHref(scope, "/logs/sessions")}?person=${person.id}`} size="sm">
                    {PEOPLE_TEXT.openSessions}
                  </Button>
                ),
              },
            ]}
          />
        </Card>
        <Card title={PEOPLE_TEXT.changeTitle}>
          {level === "member" ? (
            <PermissionNotCleared decider={refusalSentence("people.invite")} />
          ) : (
            <PersonVerbs
              personId={person.id}
              name={personName(person)}
              teamPath={person.team || (viewer.role.at ?? "")}
              unitPath={person.unit}
              admin={roleOf(person) === "team-admin"}
              orgAdmin={level === "org-admin"}
              visibility={detail.visibility}
              preview={preview ? removalLists(preview) : { loses: [], rotate: [] }}
            />
          )}
          {level === "team-admin" && <PermissionNotCleared decider={refusalSentence("people.visibility")} />}
        </Card>
      </div>
    </Screen>
  );
}

async function read<T>(path: `/v1/${string}`, token: string | null): Promise<T> {
  try {
    return await request<T>(path, token, { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}

async function readOrNull<T>(path: `/v1/${string}`, token: string | null): Promise<T | null> {
  try {
    return await request<T>(path, token, { cache: "no-store" });
  } catch {
    return null;
  }
}
