import type { components } from "@/lib/api.generated";
import { redirect } from "next/navigation";
import { request } from "@/lib/api";
import { parseScope, scopeHref } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import { related } from "@/lib/views/cells";
import { fill } from "@/lib/views/refusals";
import { lastSessionId, loginsOf, personDetail } from "@/lib/views/people";
import { readmeOf } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { EMPTY } from "@/content/empty";
import { gettingStarted } from "@/lib/views/account";
import { ACCOUNT, ACCOUNT_TEXT, GETTING_STARTED } from "@/content/screens/account";
import { Button } from "../../../ui/button";
import { Card } from "../../../ui/card";
import { Related } from "../../../ui/related";
import { SubHeader } from "../../../ui/sub-header";
import { Screen } from "../../../shell/screen";
import { Ask } from "./_ask";
import { GettingStarted } from "./_getting-started";
import { Logins } from "./_logins";
import { CreateToken } from "./_token";

type Sessions = components["schemas"]["Page_SessionRow_"];
type Session = components["schemas"]["SessionView"];
type Person = components["schemas"]["PersonRow"];

/**
 * Account — 04 §17. Cards in order: teams, logins, who can see your versions,
 * the one ask, sessions. The honesty line is a **body fact on its card**, not
 * the lede: a page states what it is, it does not narrate itself (P8).
 */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const scope = parseScope(await params);
  if (scope.kind !== "me") redirect("/console/me/account");

  const { viewer } = await loadViewer(scope);
  const token = await getToken();
  const person = await quiet<Person>(`/v1/console/people/${viewer.user.id}?scope=me`, token);
  const sessions = await quiet<Sessions>(
    `/v1/console/sessions?person=${viewer.user.id}&limit=1&scope=me`,
    token,
  );
  const id = sessions ? lastSessionId(sessions.items) : null;
  const session = id ? await quiet<Session>(`/v1/console/sessions/${id}?scope=me`, token) : null;
  const logins = loginsOf(session);

  const personal = viewer.edition === "personal";
  // W7-D5: the first card, and only while it has something to ask for. It is
  // `null` for an enterprise account and for a personal one that has done all
  // four, so the page draws nothing rather than a finished list.
  const setup = gettingStarted(viewer);
  const team = viewer.teams[viewer.teams.length - 1] ?? null;
  const readableBy = person ? personDetail(person).readableBy : related(undefined, "people");
  const admin = readableBy.items[0]?.label ?? null;

  return (
    <Screen
      bar={
        <SubHeader
          readme={readmeOf(ACCOUNT.title, ACCOUNT_TEXT.lede)}
          level={levelOf(scope, viewer)}
        />
      }
    >
      <div className="grid gap-6 px-6 pt-4 pb-10">
        {setup && (
          <Card title={GETTING_STARTED.title}>
            <GettingStarted steps={setup} />
          </Card>
        )}

        <Card title={ACCOUNT_TEXT.teamsTitle}>
          {personal || viewer.teams.length === 0 ? (
            <p className="text-base text-muted">{ACCOUNT_TEXT.teamsNone}</p>
          ) : (
            <Related
              value={{
                unit: "teams",
                items: viewer.teams.map((node) => ({
                  id: node.path,
                  label: node.admin ? `${node.name} (admin)` : node.name,
                  href: `/console/${node.path}`,
                })),
              }}
            />
          )}
        </Card>

        <Card title={ACCOUNT_TEXT.loginsTitle}>
          {session === null ? (
            <p className="text-base text-muted">{ACCOUNT_TEXT.loginsNoSession}</p>
          ) : (
            <Logins rows={logins} empty={EMPTY["account.logins"].sentence} />
          )}
        </Card>

        <Card title={ACCOUNT_TEXT.seesTitle}>
          <p className="text-base text-fg">
            {admin && team
              ? fill(ACCOUNT_TEXT.seesLine, { admin, team: team.name })
              : ACCOUNT_TEXT.seesNobody}
          </p>
        </Card>

        <Card title={personal ? ACCOUNT_TEXT.createTeamTitle : ACCOUNT_TEXT.askTitle}>
          <Ask
            personal={personal}
            team={team ? { path: team.path, name: team.name } : null}
          />
        </Card>

        <Card title={ACCOUNT_TEXT.tokenTitle}>
          <CreateToken />
        </Card>

        <Card title={ACCOUNT_TEXT.sessionsTitle}>
          <Button href={scopeHref(scope, "/logs/sessions")}>{ACCOUNT_TEXT.sessionsLink}</Button>
        </Card>
      </div>
    </Screen>
  );
}

/** A screen that cannot read one of its five cards still draws the other
 *  four; the card says what it does not have rather than blanking the page. */
async function quiet<T>(path: `/v1/${string}`, token: string | null): Promise<T | null> {
  try {
    return await request<T>(path, token, { cache: "no-store" });
  } catch {
    return null;
  }
}
