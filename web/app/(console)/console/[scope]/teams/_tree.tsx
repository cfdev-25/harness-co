"use client";

import { useState } from "react";
import { sorted } from "@/lib/views/cells";
import { type TeamDisplay, type TeamRow, teamColumns, teamDisplay, topLevel } from "@/lib/views/people";
import { Table } from "../../../ui/table";

export interface TeamTreeProps {
  rows: TeamRow[];
  empty: string;
}

/** PRD §12: the tree, collapsed to the top level. What sits inside a row is
 *  its *Contains* cell, not a second row (04 §15). */
export function TeamTree({ rows, empty }: TeamTreeProps) {
  const [sort, setSort] = useState({ key: "team", dir: "asc" as "asc" | "desc" });
  const display: TeamDisplay[] = topLevel(rows).map(teamDisplay);
  return (
    <Table
      columns={teamColumns()}
      rows={sorted(display, sort.key, sort.dir)}
      rowKey={(row) => row.path}
      sort={sort}
      onSort={(key) =>
        setSort((was) => ({ key, dir: was.key === key && was.dir === "asc" ? "desc" : "asc" }))
      }
      empty={empty}
    />
  );
}
