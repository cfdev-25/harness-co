"use client";

import { useState } from "react";
import { cell, sorted, when } from "@/lib/views/cells";
import {
  type BoundaryDisplay,
  type BoundaryRow,
  appliesTo,
  boundaryColumns,
  claudeHolds,
  leaf,
  onlyFor,
  setByKind,
  setByPath,
} from "@/lib/views/boundaries";
import { fill } from "@/lib/views/refusals";
import { BOUNDARIES_TEXT as WORDS } from "@/content/screens/boundaries";
import { Mono } from "../../../ui/mono";
import { ScaleTag } from "../../../ui/scale-tag";
import { Table, type TableColumn } from "../../../ui/table";
import { RemoveBoundary } from "./_remove";

export interface BoundaryTableProps {
  rows: BoundaryRow[];
  personal: boolean;
  empty: string;
  orgLabel: string;
  /** A team admin may lift what their own node set and nothing above it, so
   *  the organisation's block is only actionable for an organisation admin. */
  mayRemove: boolean;
}

/**
 * One table for both blocks of every tab (04 §9, W6-D8: *Inherited* and *Set
 * here* are the same table filtered, not two designs). Sorting is client-side
 * over the display row; `lib/views/cells.ts` owns the comparator.
 */
export function BoundaryTable({ rows, personal, empty, orgLabel, mayRemove }: BoundaryTableProps) {
  const [sort, setSort] = useState({ key: "value", dir: "asc" as "asc" | "desc" });
  const display: BoundaryDisplay[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    value: cell(<Mono>{row.value}</Mono>, row.value),
    holds: row.holds,
    appliesTo: appliesTo(row),
    onlyFor: onlyFor(row),
    setBy: cell(
      setByKind(row) === "org" ? orgLabel : leaf(setByPath(row)),
      setByPath(row),
    ),
    reason: row.reason,
    when: when(row.at),
  }));
  // W6-D9: a command boundary is `intercepted`, and the row says by whom. The
  // runtime is what refuses the call, so *intercepted* alone would leave the
  // person to guess whether anything is actually holding — and where Claude
  // Code's own matcher cannot hold the pattern, the row says *by Pi* and
  // nothing more, because claiming a refusal nobody measured is worse than
  // saying which one you have (engine 07 §8).
  const holdsColumn = (column: TableColumn<BoundaryDisplay>): TableColumn<BoundaryDisplay> => ({
    ...column,
    render: (row) => {
      const by = row.kind === "command" ? byWhom(row.value.text ?? "") : null;
      return (
        <span className="grid gap-0.5">
          <ScaleTag scale="holds" value={row.holds} size="sm" />
          {by && <span className="text-xs text-faint" title={by.title}>{by.text}</span>}
        </span>
      );
    },
  });
  const columns: TableColumn<BoundaryDisplay>[] = mayRemove
    ? [
        ...boundaryColumns(personal).map((column) => (column.key === "holds" ? holdsColumn(column) : column)),
        {
          key: "id",
          heading: "",
          kind: "text",
          sort: false,
          render: (row) => <RemoveBoundary boundaryId={row.id} />,
        },
      ]
    : boundaryColumns(personal).map((column) => (column.key === "holds" ? holdsColumn(column) : column));
  return (
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
  );
}

/** *by Pi and Claude Code* · *by Pi* — and for the second, why. */
function byWhom(pattern: string): { text: string; title?: string } {
  if (claudeHolds(pattern)) {
    return { text: fill(WORDS.interceptedBy, { runtimes: WORDS.interceptedByBoth }) };
  }
  return {
    text: fill(WORDS.interceptedBy, { runtimes: WORDS.interceptedByPi }),
    title: WORDS.interceptedPiOnly,
  };
}
