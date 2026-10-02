import type { components } from "@/lib/api.generated";
import { request } from "@/lib/api";
import { parseScope, scopeHref, scopeQuery } from "@/lib/scope";
import { getToken } from "@/lib/token.server";
import { fill, refusalSentence } from "@/lib/views/refusals";
import { entriesOf, narrowable } from "@/lib/views/groups";
import { readmeOf, searchIn } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { loadViewer } from "@/lib/views/viewer";
import { EMPTY } from "@/content/empty";
import { GROUPS, GROUPS_TEXT } from "@/content/screens/groups";
import { PermissionNotCleared } from "../../../ui/permission-not-cleared";
import { SubHeader } from "../../../ui/sub-header";
import { Screen } from "../../../shell/screen";
import { GrantTable } from "./_table";
import { CreateGroup } from "./_create";
import { Narrow } from "./_narrow";

type Grants = components["schemas"]["Page_GrantRow_"];
type Groups = components["schemas"]["Page_GroupRow_"];

/**
 * Security groups — 04 §8. The content is one table of **grants**: a group
 * grant and an outside-endpoints grant are rows in the same list, told apart
 * by *Gives* (PRD §8). Creating a group is an organisation admin's; narrowing
 * one the team already holds is the team admin's.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ scope: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const scope = parseScope(await params);
  const { viewer } = await loadViewer(scope);
  const token = await getToken();
  const search = (await searchParams).q ?? "";
  const query = scopeQuery(scope);
  const [grants, groups] = await Promise.all([
    request<Grants>(`/v1/console/grants?scope=${query}`, token, { cache: "no-store" }),
    request<Groups>(`/v1/console/groups?scope=${query}`, token, { cache: "no-store" }),
  ]);

  const personal = viewer.edition === "personal";
  const team = scope.kind === "team" ? scope.path.split(".").slice(-1)[0] : "";
  const level = viewer.role.level;
  const empty = scope.kind === "me" ? EMPTY["groups.me"].sentence : EMPTY[emptyId(scope.kind)].sentence;
  const aliases = new Map(
    groups.items.map((group) => [group.name, entriesOf(group.entries).map((entry) => entry.alias)]),
  );
  const offered = narrowable(grants.items).map((grant) => ({
    id: grant.id,
    group: grant.group ?? "",
    aliases: aliases.get(grant.group ?? "") ?? [],
  }));
  const subTeams = viewer.teams
    .filter((node) => scope.kind !== "team" || node.path.startsWith(`${scope.path}.`))
    .map((node) => ({ path: node.path, name: node.name }));

  return (
    <Screen
      bar={
        <SubHeader
          count={countOf(grants.items.length)}
          readme={readmeOf(
            personal ? GROUPS_TEXT.personalTitle : GROUPS.title,
            ledeFor(scope.kind, personal, team),
          )}
          level={levelOf(scope, viewer)}
          search={searchIn(scopeHref(scope, "/groups"), search, GROUPS_TEXT.searchPlaceholder)}
          actions={verbFor(scope.kind, level, personal, offered, subTeams)}
        />
      }
    >
      <div className="grid gap-6 px-6 pt-4 pb-10">
        <div>
          <GrantTable
            rows={grants.items}
            query={search}
            personal={personal}
            empty={empty}
            groupsHref={scopeHref(scope, "/groups")}
            mayRevoke={level !== "member"}
            aliases={Object.fromEntries(aliases)}
          />
        </div>
        {refusalFor(level, personal, team) && (
          <PermissionNotCleared decider={refusalFor(level, personal, team) ?? ""} />
        )}
      </div>
    </Screen>
  );
}

function emptyId(kind: string): "groups.team" | "groups.org" {
  return kind === "team" ? "groups.team" : "groups.org";
}

/** 04 §8: **New group** at the organisation, **Narrow to a sub-team** at a
 *  team. The two verbs are never both on one sub-header. */
function verbFor(
  kind: string,
  level: string,
  personal: boolean,
  offered: Array<{ id: string; group: string; aliases: string[] }>,
  subTeams: Array<{ path: string; name: string }>,
) {
  if (kind === "org" || personal) {
    return level === "org-admin" ? <CreateGroup /> : undefined;
  }
  if (kind === "team" && level !== "member" && offered.length > 0 && subTeams.length > 0) {
    return <Narrow grants={offered} subTeams={subTeams} />;
  }
  return undefined;
}

function countOf(n: number): string {
  return n === 1 ? GROUPS_TEXT.countOne : fill(GROUPS_TEXT.count, { n: String(n) });
}

function ledeFor(kind: string, personal: boolean, team: string): string {
  if (personal) return GROUPS_TEXT.personalLede;
  if (kind === "org") return GROUPS_TEXT.ledeOrg;
  if (kind === "me") return GROUPS_TEXT.ledeMe;
  return fill(GROUPS_TEXT.ledeTeam, { team });
}

/** 04 §8's two refusals, from `content/refusals.ts` — the one place every
 *  `PermissionNotCleared` sentence lives (05 §7, P13). */
function refusalFor(level: string, personal: boolean, team: string): string | null {
  if (personal || level === "org-admin") return null;
  if (level === "team-admin") return refusalSentence("groups.create", { team });
  return refusalSentence("groups.narrow");
}
