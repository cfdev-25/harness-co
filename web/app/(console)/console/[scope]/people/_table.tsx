"use client";

import { useState } from "react";
import { sorted } from "@/lib/views/cells";
import {
  type PersonDisplay,
  type PersonRow,
  lastActive,
  personColumns,
  personName,
  personTeams,
  roleOf,
} from "@/lib/views/people";
import { Table, type TableColumn } from "../../../ui/table";
import { CancelInvite } from "./_invite";

export interface PersonTableProps {
  rows: PersonRow[];
  /** `?q=` from the bar's search (01 §7.5); `""` is every row. */
  query: string;
  empty: string;
  hrefFor: string;
  /** The verb is an admin's; the route decides again (P13). */
  mayCancel: boolean;
}

export function PersonTable({ rows, query, empty, hrefFor, mayCancel }: PersonTableProps) {
  const [sort, setSort] = useState({ key: "name", dir: "asc" as "asc" | "desc" });
  const needle = query.trim().toLowerCase();
  const found = rows.filter(
    (row) => needle === "" || `${personName(row)} ${row.email}`.toLowerCase().includes(needle),
  );
  const display: PersonDisplay[] = found.map((row) => ({
    id: row.id,
    invite: row.invite ?? null,
    name: personName(row),
    email: row.email,
    teams: personTeams(row),
    role: roleOf(row),
    state: row.state,
    lastActive: lastActive(row),
  }));
  const columns: TableColumn<PersonDisplay>[] = mayCancel
    ? [
        ...personColumns(),
        {
          key: "invite",
          heading: "",
          kind: "text",
          sort: false,
          // Only an invited row has one, and it is the only handle it has.
          render: (row) =>
            row.invite ? <CancelInvite invite={row.invite} email={row.email} /> : null,
        },
      ]
    : personColumns();
  return (
    <div className="grid gap-3">
      <Table
      columns={columns}
      rows={sorted(display, sort.key, sort.dir)}
      rowKey={(row) => row.id || row.email}
      rowHref={(row) => (row.id ? `${hrefFor}/${row.id}` : `${hrefFor}`)}
      sort={sort}
      onSort={(key) =>
        setSort((was) => ({ key, dir: was.key === key && was.dir === "asc" ? "desc" : "asc" }))
      }
        empty={empty}
      />
    </div>
  );
}
