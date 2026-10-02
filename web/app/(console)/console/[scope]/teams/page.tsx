import type { components } from "@/lib/api.generated";
import { request } from "@/lib/api";
import { parseScope, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import { readmeOf } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";

import { EMPTY } from "@/content/empty";
import { PEOPLE_TEXT } from "@/content/screens/people";
import { SubHeader } from "../../../ui/sub-header";
import { Screen } from "../../../shell/screen";
import { TeamTree } from "./_tree";

type Body = components["schemas"]["Page_TeamRow_"];

/** Teams — 04 §15. One row per top-level team; a sub-team is a *Contains*. */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const scope = parseScope(await params);
  const { viewer } = await loadViewer(scope);
  const body = await request<Body>(
    `/v1/console/teams?scope=${scopeQuery(scope)}`,
    await getToken(),
    { cache: "no-store" },
  );
  return (
    <Screen
      bar={
        <SubHeader
          readme={readmeOf(PEOPLE_TEXT.teamsTitle, PEOPLE_TEXT.teamsLede)}
          level={levelOf(scope, viewer)}
        />
      }
    >
      <div className="px-6 pt-4 pb-10">
        <TeamTree rows={body.items} empty={EMPTY.teams.sentence} />
      </div>
    </Screen>
  );
}
