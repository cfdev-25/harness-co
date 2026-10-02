import type { ReactNode } from "react";
import type { components } from "@/lib/api.generated";
import { request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import { fill } from "@/lib/views/refusals";
import { type BoundaryRow, type BoundaryTab, boundaryTabs, tabOf } from "@/lib/views/boundaries";
import { readmeOf } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import type { Scope, Viewer } from "@/lib/views/types";
import { EMPTY, HIDDEN } from "@/content/empty";
import { BOUNDARIES, BOUNDARIES_TEXT } from "@/content/screens/boundaries";
import { HiddenView } from "../../../ui/hidden-view";
import { SubHeader } from "../../../ui/sub-header";
import { Screen } from "../../../shell/screen";
import { AddBoundary } from "./_add";
import { BoundaryBlocks } from "./_blocks";

type Body = components["schemas"]["Page_BoundaryRow_"];

/**
 * What all three tabs of Boundaries share (04 §9, W6-D8): the fetch, the
 * header, the tab strip, and the two blocks — *Inherited*, read-only, each row
 * naming the level that set it, then *Set here*, with add and remove for an
 * admin of this level.
 *
 * It is one module because the three tabs differ in exactly two things: which
 * rows they hold (`tabOf`) and what, if anything, sits above or below the
 * blocks. Three copies of the fetch and the split would be three places for
 * the inheritance rule to drift.
 */
export interface BoundariesContext {
  scope: Scope;
  viewer: Viewer;
  /** The scope as `api` spells it, for every read and write on these tabs. */
  query: string;
  personal: boolean;
  orgPath: string;
  /** The node this level writes to, or `null` at *me* outside the personal
   *  edition, where a person sets no boundary and inherits every one. */
  here: string | null;
  rows: BoundaryRow[];
  hidden: boolean;
  mayAdd: boolean;
}

export async function boundariesContext(
  tab: BoundaryTab,
  params: Promise<{ scope: string }>,
): Promise<BoundariesContext> {
  const scope = parseScope(await params);
  const { viewer } = await loadViewer(scope);
  const query = scopeQuery(scope);
  const body = await request<Body>(`/v1/console/boundaries?scope=${query}`, await getToken(), {
    cache: "no-store",
  });
  const personal = viewer.edition === "personal";
  const orgPath = viewer.teams[0]?.path.split(".")[0] ?? "";
  // A personal account *is* its organization (07 §3), so *me* is where it
  // writes; an enterprise person at *me* writes nowhere and reads everything.
  const here =
    scope.kind === "team" ? scope.path : scope.kind === "org" || personal ? orgPath : null;
  return {
    scope,
    viewer,
    query,
    personal,
    orgPath,
    here,
    rows: body.items.filter((row) => tabOf(row) === tab),
    hidden: Boolean(body.hidden),
    mayAdd: viewer.adminHere && here !== null,
  };
}

export interface BoundariesScreenProps {
  tab: BoundaryTab;
  ctx: BoundariesContext;
  /** Rendered between the tabs and the two blocks — Reach's own section. */
  above?: ReactNode;
  /** Rendered inside *Set here*, under the table: Commands' starter adds. */
  offer?: ReactNode;
}

export function BoundariesScreen({ tab, ctx, above, offer }: BoundariesScreenProps) {
  const { scope, viewer, personal, orgPath, here, mayAdd } = ctx;
  const team = scope.kind === "team" ? scope.path.split(".").slice(-1)[0] : orgPath;
  const title = personal ? BOUNDARIES_TEXT.personalTitle : BOUNDARIES.title;
  const bar = (
    <SubHeader
      tabsLabel={BOUNDARIES.title}
      tabs={boundaryTabs(scopeHref(scope), tab)}
      readme={readmeOf(title, ledeFor(scope.kind, personal, team), BOUNDARIES.about)}
      level={levelOf(scope, viewer)}
      actions={mayAdd && here ? <AddBoundary scopePath={here} orgPath={orgPath} kind={tab} /> : undefined}
    />
  );

  // P10: the deny list is hidden, not the tabs and not Reach — how far a
  // person's own sessions go is theirs to read, never a log about anyone else.
  if (ctx.hidden) {
    return (
      <Screen bar={bar}>
        <div className="grid gap-8 px-6 pt-4 pb-10">
          {above}
          <HiddenView view="boundaries" note={HIDDEN.boundaries} />
        </div>
      </Screen>
    );
  }

  const empty = scope.kind === "me" ? EMPTY["boundaries.me"].sentence : EMPTY[emptyId(scope.kind)].sentence;
  return (
    <Screen bar={bar}>
      <div className="grid gap-8 px-6 pt-4 pb-10">
        {above}
        <BoundaryBlocks
          rows={ctx.rows}
          here={here}
          personal={personal}
          orgLabel={orgPath}
          mayAdd={mayAdd}
          empty={empty}
          offer={offer}
        />
      </div>
    </Screen>
  );
}

function emptyId(kind: string): "boundaries.team" | "boundaries.org" {
  return kind === "team" ? "boundaries.team" : "boundaries.org";
}

function ledeFor(kind: string, personal: boolean, team: string): string {
  if (personal) return BOUNDARIES_TEXT.personalLede;
  if (kind === "org") return BOUNDARIES_TEXT.ledeOrg;
  if (kind === "me") return BOUNDARIES_TEXT.ledeMe;
  return fill(BOUNDARIES_TEXT.ledeTeam, { team });
}
