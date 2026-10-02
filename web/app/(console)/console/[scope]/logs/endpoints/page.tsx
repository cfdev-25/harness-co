import type { components } from "@/lib/api.generated";
import { request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";

import { readmeOf } from "@/lib/views/header";
import { tabs } from "@/lib/views/logs";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { EMPTY, HIDDEN } from "@/content/empty";
import { LOGS, LOGS_TEXT } from "@/content/screens/logs";
import { HiddenView } from "../../../../ui/hidden-view";
import { SubHeader } from "../../../../ui/sub-header";
import { Screen } from "../../../../shell/screen";
import { AttemptTable } from "./_table";

type Body = components["schemas"]["Page_EndpointRow_"];

/**
 * Endpoints — a tab of Logs (04 §14), and the screen that finds the
 * next boundary: an unaccounted-for endpoint is how one is found (PRD §7).
 *
 * W5-D4: the rows are attempts, not just hosts — one per
 * (host, outcome, reason, setBy), each saying which rule decided and which
 * level owns it, and each refusal a viewer may lift carrying **Allow**. The
 * table is `_table.tsx` and nothing else on this page reads the rows.
 */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const scope = parseScope(await params);
  const { viewer } = await loadViewer(scope);
  const body = await request<Body>(
    `/v1/console/endpoints?scope=${scopeQuery(scope)}`,
    await getToken(),
    { cache: "no-store" },
  );
  return (
    <Screen
      bar={
        <SubHeader
          tabsLabel={LOGS_TEXT.title}
          tabs={tabs(scopeHref(scope), viewer, "endpoints")}
          readme={readmeOf(LOGS_TEXT.title, LOGS.lede, LOGS.about)}
          level={levelOf(scope, viewer)}
        />
      }
    >
      <div className="grid gap-4 px-6 pt-4 pb-10">
        {body.hidden ? (
          <HiddenView view="logs" note={HIDDEN.logs} />
        ) : (
          <AttemptTable
            rows={body.items}
            viewer={viewer}
            base={scopeHref(scope)}
            empty={EMPTY.endpoints.sentence}
          />
        )}
      </div>
    </Screen>
  );
}
