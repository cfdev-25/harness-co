"use client";

import Link from "next/link";
import { useState } from "react";
import { cell, sorted, related } from "@/lib/views/cells";
import {
  type GrantDisplay,
  type GrantRow,
  grantColumns,
  grantLabel,
  grantWhen,
  givesOf,
  sourcesOf,
} from "@/lib/views/groups";
import { GROUPS_TEXT } from "@/content/screens/groups";
import { Table, type TableColumn } from "../../../ui/table";
import { RevokeGrant } from "./_revoke";

export interface GrantTableProps {
  rows: GrantRow[];
  /** `?q=` from the bar's search (01 §7.5); `""` is every row. */
  query: string;
  personal: boolean;
  empty: string;
  groupsHref: string;
  /** The verb is the row's, so the column is only there for someone who has
   *  it; the route decides again and its refusal is what the row shows. */
  mayRevoke: boolean;
  /** Each group's aliases, for the confirmation's preview. */
  aliases: Record<string, string[]>;
}

/**
 * One table of grants: a group grant and an outside-endpoints grant are rows
 * in it, told apart by *Gives* (PRD §8, 04 §8). Nothing here is a tag.
 */
export function GrantTable(props: GrantTableProps) {
  const { rows, query, personal, empty, groupsHref, mayRevoke, aliases } = props;
  const [sort, setSort] = useState({ key: "group", dir: "asc" as "asc" | "desc" });
  const needle = query.trim().toLowerCase();
  const found = rows.filter(
    (row) => needle === "" || `${grantLabel(row)} ${row.by ?? ""}`.toLowerCase().includes(needle),
  );
  const display: GrantDisplay[] = found.map((row) => {
    const label = grantLabel(row);
    const harnesses = related(row.harnesses, "harnesses");
    return {
      id: row.id,
      group: cell(
        row.group ? (
          <Link href={`${groupsHref}/${row.group}`} className="text-accent-text hover:underline">
            {label}
          </Link>
        ) : (
          label
        ),
        label,
      ),
      gives: givesOf(row),
      sources: sourcesOf(row.sources),
      grantedTo: related(row.teams, "teams"),
      onlyFor: cell(
        harnesses.items.length === 0 ? GROUPS_TEXT.everyHarness : harnesses.items.map((i) => i.label).join(", "),
        harnesses.items.map((i) => i.label).join(", "),
      ),
      narrowedFrom: cell(row.narrowedFrom ?? "—", row.narrowedFrom ?? ""),
      by: row.by ?? "—",
      when: grantWhen(row),
    };
  });
  const kept = new Map(rows.map((row) => [row.id, aliases[row.group ?? ""] ?? []]));
  const columns: TableColumn<GrantDisplay>[] = mayRevoke
    ? [
        ...grantColumns(personal),
        {
          key: "id",
          heading: "",
          kind: "text",
          sort: false,
          render: (row) => <RevokeGrant grantId={row.id} aliases={kept.get(row.id) ?? []} />,
        },
      ]
    : grantColumns(personal);
  return (
    <div className="grid gap-3">
      <Table
      columns={columns}
      rows={sorted(display, sort.key, sort.dir)}
      rowKey={(row) => row.id}
      sort={sort}
      onSort={(key) =>
        setSort((was) => ({ key, dir: was.key === key && was.dir === "asc" ? "desc" : "asc" }))
      }
        empty={empty}
      />
    </div>
  );
}
