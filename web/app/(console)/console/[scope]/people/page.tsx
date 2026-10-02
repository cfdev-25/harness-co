import type { components } from "@/lib/api.generated";
import { redirect } from "next/navigation";
import { request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import { num } from "@/lib/views/cells";
import { fill, refusalSentence } from "@/lib/views/refusals";
import { personName } from "@/lib/views/people";
import { readmeOf, searchIn } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { EMPTY } from "@/content/empty";
import { PEOPLE, PEOPLE_TEXT } from "@/content/screens/people";
import { Card } from "../../../ui/card";
import { Line } from "../../../ui/line";
import { PermissionNotCleared } from "../../../ui/permission-not-cleared";
import { SubHeader } from "../../../ui/sub-header";
import { Screen } from "../../../shell/screen";
import { PeopleVerbs } from "./_invite";
import { PersonTable } from "./_table";

type Body = components["schemas"]["Page_PersonRow_"];
type Teams = components["schemas"]["Page_TeamRow_"];

/**
 * People — 04 §15. `me` redirects to the Account screen (§17): a person's own
 * page is their account, not a one-row list of themselves.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const scope = parseScope(await params);
  const query = (await searchParams).q ?? "";
  if (scope.kind === "me") redirect(scopeHref(scope, "/account"));

  const { viewer } = await loadViewer(scope);
  const token = await getToken();
  const body = await request<Body>(
    `/v1/console/people?scope=${scopeQuery(scope)}`,
    token,
    { cache: "no-store" },
  );

  const level = viewer.role.level;
  // 04 §15: an invitation is to a team. At the organization scope there is no
  // team in the route, so the form is given the ones to choose from; at a team
  // scope the scope's path is the team and the field is not shown.
  const teams =
    scope.kind === "org" && level !== "member"
      ? (await request<Teams>("/v1/console/teams?scope=org", token, { cache: "no-store" })).items.map(
          (row) => ({ path: row.path, name: row.name || row.path }),
        )
      : [];
  const team = scope.kind === "team" ? scope.path.split(".").slice(-1)[0] : "";
  const waiting = num(viewer.waiting.people);
  const members = body.items
    .filter((row) => row.id !== "")
    .map((row) => ({ id: row.id, name: personName(row) }));

  return (
    <Screen
      bar={
        <SubHeader
          readme={readmeOf(
            PEOPLE.title,
            scope.kind === "team" ? fill(PEOPLE_TEXT.peopleLedeTeam, { team }) : PEOPLE.lede,
          )}
          level={levelOf(scope, viewer)}
          search={searchIn(scopeHref(scope, "/people"), query, PEOPLE_TEXT.searchPlaceholder)}
          actions={
            level !== "member" ? (
              <PeopleVerbs
                team={scope.kind === "team" ? scope.path : (viewer.role.at ?? "")}
                members={members}
                teams={teams}
              />
            ) : undefined
          }
        />
      }
    >
      <div className="grid gap-6 px-6 pt-4 pb-10">
        <PersonTable
          rows={body.items}
          query={query}
          empty={EMPTY.people.sentence}
          hrefFor={scopeHref(scope, "/people")}
          mayCancel={level !== "member"}
        />
        <Card title={PEOPLE_TEXT.waitingTitle}>
          {waiting === 0 ? (
            <Line name={PEOPLE_TEXT.waitingNone} />
          ) : (
            <Line
              name={
                waiting === 1
                  ? PEOPLE_TEXT.waitingOne
                  : fill(PEOPLE_TEXT.waitingCount, { n: String(waiting) })
              }
              note={PEOPLE_TEXT.waitingNote}
            />
          )}
        </Card>
        {scope.kind === "team" && (
          <Card title={PEOPLE_TEXT.notYoursTitle}>
            {PEOPLE_TEXT.notYours.map((item) => (
              <Line key={item.what} name={item.what} note={item.who} />
            ))}
          </Card>
        )}
        {level === "member" && <PermissionNotCleared decider={refusalSentence("people.invite")} />}
        {level === "team-admin" && <PermissionNotCleared decider={refusalSentence("people.appoint")} />}
      </div>
    </Screen>
  );
}
