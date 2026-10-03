import { howHref, scopeHref } from "@/lib/scope";
import type { NavKey, Scope, Viewer } from "@/lib/views/types";

/**
 * One function decides what is in the sidebar (01 §4.4); nothing else does.
 * The labels are the navigation's own nouns and live here with it — there is
 * no sidebar module in 05 §3 yet.
 */
export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  count?: number;
}

export interface NavGroup {
  /**
   * The eyebrow over the group. Absent is the one-group sidebar (D106): with
   * nothing to tell apart, a heading is furniture, so `navFor` leaves it off
   * and the sidebar draws one tight list.
   */
  label?: string;
  items: NavItem[];
}

export const NAV_LABELS: Record<NavKey, string> = {
  harnesses: "Harnesses", assets: "Assets", groups: "Security groups",
  boundaries: "Boundaries", providers: "Providers", vaults: "Key vaults", sessions: "Sessions",
  logs: "Logs", endpoints: "Endpoints", people: "People", teams: "Teams",
  account: "Account", how: "How this works",
};

/**
 * `sessions` and `endpoints` are tabs of Logs now (01 §4.4) and no longer
 * sidebar rows, but they are still screens with names and addresses — the
 * guides bold them and `Sessions` is still linked to from Account and from a
 * person's page — so the key keeps its label and its route here.
 */
const PATHS: Record<NavKey, string> = {
  harnesses: "/harnesses", assets: "/assets", groups: "/groups", boundaries: "/boundaries",
  providers: "/providers", vaults: "/vaults", sessions: "/logs/sessions", logs: "/logs/changes",
  endpoints: "/logs/endpoints", people: "/people", teams: "/teams", account: "/account",
  how: "/console/how",
};

function isNavKey(value: string | undefined): value is NavKey {
  return value !== undefined && value in NAV_LABELS;
}

/**
 * The route's first segment after `[scope]`, which decides `aria-current`.
 *
 * Scope is ONE segment (00 D2) and a team's is a dotted path, so the pattern
 * strips whatever that one segment is — `org`, `me`, or `acme.marketing`. The
 * old `team/<path>` alternative never matched a real team URL, and every
 * sidebar item lost its selected state at team scope.
 *
 * Everything under `/logs` is the one Logs row, tabs and all, and so is the
 * old `/sessions` address, which redirects into it.
 */
export function navKeyOf(pathname: string): NavKey | null {
  if (pathname.startsWith("/console/how")) return "how";
  const rest = pathname.replace(/^\/console\/[^/]+/, "");
  const [, first] = rest.split("/");
  if (first === "logs" || first === "sessions") return "logs";
  return isNavKey(first) ? first : null;
}

/**
 * The sidebar shows what you manage (01 §4.4). Everyone on a level sees the
 * things that level holds for them — harnesses, assets, the log, the people
 * on it; the permission screens belong to whoever administers it, and a row
 * a viewer may open only to be refused is worse than no row (P13).
 *
 * A personal account is one person who is their own organization (07 §2):
 * there are no teams, no people and no permissions to hand out, but reach and
 * the model are theirs to set, so Boundaries and Providers stay.
 *
 * **Groups exist to separate the permission screens from the rest** (D106).
 * A viewer who administers nothing here has no second kind of row, so the
 * four or five they do have are one unlabelled group — a tight list, not
 * four headings over one row each. A personal account is that case always.
 */
export function navFor(scope: Scope, viewer: Viewer): NavGroup[] {
  const item = (key: NavKey): NavItem => ({
    key,
    label: NAV_LABELS[key],
    href: key === "how" ? howHref() : scopeHref(scope, PATHS[key]),
    count: viewer.waiting[key],
  });
  const me = scope.kind === "me";
  const org = scope.kind === "org";
  const admin = viewer.adminHere;

  if (viewer.edition === "personal") {
    // Boundaries and Providers are in the one list and not under a
    // *Permissions* heading: there is nobody else here, so they are settings
    // of theirs like the rest — and Providers is where a model is connected
    // (07 §4), which a personal account cannot do without.
    return [{ items: [
      item("harnesses"), item("assets"), item("boundaries"), item("providers"), item("logs"), item("account"),
    ] }];
  }

  const permissions: NavItem[] = admin && !me
    ? [item("groups"), item("boundaries"), item("providers"), ...(org ? [item("vaults")] : [])]
    : [];
  const people: NavItem[] = me
    ? [item("account")]
    : [item("people"), ...(admin ? [item("teams")] : [])];

  // Nothing to separate: one list, in the order the rows have always been in.
  if (permissions.length === 0) {
    return [{ items: [item("harnesses"), item("assets"), item("logs"), ...people] }];
  }

  return [
    { label: "Assets", items: [item("harnesses"), item("assets")] },
    { label: "Permissions", items: permissions },
    { label: "Logs", items: [item("logs")] },
    { label: "People", items: people },
  ];
}

export function pinnedNav(): NavItem {
  return { key: "how", label: NAV_LABELS.how, href: howHref() };
}
