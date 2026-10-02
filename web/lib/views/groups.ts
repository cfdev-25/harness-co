import type { components } from "@/lib/api.generated";
import { GROUPS, GROUPS_TEXT } from "@/content/screens/groups";
import type { Column, Related } from "./types";
import { type Cell, record, records, str, when } from "./cells";
import { fill } from "./refusals";

/** `GET /v1/console/grants` · `/groups` · `/groups/{name}` (00 §4.10). */
export type GrantRow = components["schemas"]["GrantRow"];
export type GroupRow = components["schemas"]["GroupRow"];
/** `policy/groups.json`'s entry, verbatim: a `PATCH` replaces the whole list,
 *  so the held ones are handed back untouched (03 §4.5). */
export type GroupEntry = components["schemas"]["GroupEntry"];

export interface GrantDisplay {
  id: string;
  group: Cell;
  gives: string;
  sources: string;
  grantedTo: Related;
  onlyFor: Cell;
  narrowedFrom: Cell;
  by: string;
  when: string;
}

export interface EntryDisplay {
  /** The entry's place in the held list — its key, and what a removal filters
   *  on, because two entries may share an alias the server has not refused. */
  index: number;
  alias: Cell;
  secret: string;
  vault: string;
  upstream: string;
  attach: string;
  ready: Cell;
}

const GRANT_KEYS = [
  "group", "gives", "sources", "grantedTo", "onlyFor", "narrowedFrom", "by", "when",
] as const;
const ENTRY_KEYS = ["alias", "secret", "vault", "upstream", "attach", "ready"] as const;

/**
 * 07 §3, D71: the personal rendering is **Keys** — one flat list of
 * alias · upstream · vault · sources — so granted-to, only-for and
 * narrowed-from are absent rather than empty.
 */
export function grantColumns(personal: boolean): Column<GrantDisplay>[] {
  const hidden = new Set(personal ? ["grantedTo", "onlyFor", "narrowedFrom"] : []);
  return GRANT_KEYS.filter((key) => !hidden.has(key)).map((key) => {
    const entry = GROUPS.columns[key];
    return {
      key,
      heading: entry.heading,
      help: entry.help,
      kind: grantKind(key),
      unit: entry.unit,
      sort: key === "gives" || key === "sources" || key === "onlyFor" ? false : undefined,
    };
  });
}

function grantKind(key: (typeof GRANT_KEYS)[number]): Column<GrantDisplay>["kind"] {
  if (key === "grantedTo") return "related";
  if (key === "group" || key === "onlyFor" || key === "narrowedFrom") return "fact";
  return "text";
}

export function entryColumns(): Column<EntryDisplay>[] {
  return ENTRY_KEYS.map((key) => {
    const entry = GROUPS.columns[key];
    return {
      key,
      heading: entry.heading,
      help: entry.help,
      kind: key === "alias" || key === "ready" ? "fact" : "text",
      unit: entry.unit,
      sort: false,
    };
  });
}

/** *n entries* — and, for a grant written before W5-D1b retired
 *  `Grant.reach`, what it now gives, which is nothing: reach is
 *  `policy/reach.json` and is set on the Boundaries screen. */
export function givesOf(row: GrantRow): string {
  if (row.gives === "reach") return GROUPS_TEXT.givesReach;
  if (row.entryCount === 1) return GROUPS_TEXT.givesOneEntry;
  return fill(GROUPS_TEXT.givesEntries, { n: String(row.entryCount) });
}

/** D41: `sources` is a rule with two values, rendered as text with the
 *  column's help — not a `ScaleTag`, and the vocabulary has no word for it. */
export function sourcesOf(value: string | null | undefined): string {
  return value === "vault-or-local" ? GROUPS_TEXT.sourcesVaultOrLocal : GROUPS_TEXT.sourcesVaultOnly;
}

export function grantLabel(row: GrantRow): string {
  return row.group ?? GROUPS_TEXT.retiredReachGrant;
}

export function grantWhen(row: GrantRow): string {
  return when(row.at);
}

/** `GroupRow.entries` narrowed for the table (an open record). It takes the
 *  list rather than the row, so the caller keeps the verbatim one to send
 *  back (03 §4.5). */
export function entriesOf(entries: unknown): Array<{
  alias: string;
  vault: string;
  ref: string;
  upstream: string;
  header: string;
}> {
  return records(entries).map((entry) => {
    const secret = record(entry.secret);
    return {
      alias: str(entry.alias),
      vault: str(secret.vault),
      ref: str(secret.ref),
      upstream: str(entry.upstream),
      header: str(record(entry.attach).header),
    };
  });
}

/**
 * The narrowing modal's live sentence (04 §8), assembled from `content/`'s
 * fragments so nothing is written in a component. Unticking everything is a
 * grant that resolves nothing, and the sentence says so rather than reading
 * as if it were fine.
 */
export function narrowPreview(team: string, kept: string[], dropped: string[]): string {
  if (kept.length === 0) return fill(GROUPS_TEXT.narrowPreviewNone, { team });
  const first = fill(GROUPS_TEXT.narrowPreviewKeep, { team, kept: list(kept) });
  if (dropped.length === 0) return first;
  return `${first} ${fill(GROUPS_TEXT.narrowPreviewDrop, { dropped: list(dropped) })}`;
}

function list(values: string[]): string {
  if (values.length < 2) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/** Which grants a team admin may narrow: the ones the team already holds. */
export function narrowable(rows: GrantRow[]): GrantRow[] {
  return rows.filter((row) => row.gives === "entries" && row.group !== null);
}
