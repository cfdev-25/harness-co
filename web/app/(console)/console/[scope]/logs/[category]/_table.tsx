"use client";

import { useState } from "react";
import { cell, sorted } from "@/lib/views/cells";
import {
  type LogDisplay,
  type LogRow,
  actorOf,
  commitOf,
  isGitBacked,
  logColumns,
  logWhen,
  matching,
  teamOf,
} from "@/lib/views/logs";
import { LOGS_TEXT } from "@/content/screens/logs";
import { Mono } from "../../../../ui/mono";
import { Table } from "../../../../ui/table";
import { LogDiff } from "./_diff";

export interface LogTableProps {
  rows: LogRow[];
  /** `?q=` from the bar's search (01 §7.5); `""` is every row. */
  query: string;
  category: string;
  atMe: boolean;
  empty: string;
}

/** The sentence is the row; the commit is one click away (P9). */
export function LogTable({ rows, query, category, atMe, empty }: LogTableProps) {
  const [sort, setSort] = useState({ key: "when", dir: "desc" as "asc" | "desc" });
  const display: LogDisplay[] = matching(rows, query).map((row) => ({
    id: row.id,
    when: logWhen(row),
    who: actorOf(row),
    team: teamOf(row),
    what: row.sentence,
    action: cell(<Mono title={row.action}>{row.action}</Mono>, row.action),
    diff: isGitBacked(row)
      ? cell(<LogDiff category={category} id={row.id} label={`${LOGS_TEXT.viewAsGit} ${commitOf(row)}`} />)
      : cell("—", ""),
  }));
  return (
    <div className="grid gap-3">
      <Table
        columns={logColumns(atMe)}
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
