"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { Column, Fact, Related as RelatedValue } from "@/lib/views/types";
import { relative, absolute } from "@/lib/views/time";
import { Chip } from "./chip";
import { FactCell } from "./fact-cell";
import { HelpMark } from "./help-mark";
import { Mono } from "./mono";
import { Related } from "./related";
import { ScaleTag } from "./scale-tag";

/**
 * `Column<Row>` (00 §4.2) plus the three things the screens needed and the
 * contract did not have. Reported as an addition to 00 §4.2 rather than
 * invented per screen (D65):
 *  - `kind: "chip"` and `kind: "mono"`, because an alias, a ref and a commit
 *    are not facts and were being smuggled through `kind: "fact"`;
 *  - `render`, the one escape hatch, for the cell that is genuinely a
 *    composite (a command block, two tags, a name with a note). It is a
 *    function, so only a client component may pass it;
 *  - `link`, which says *this* cell carries the row's link, instead of the
 *    first cell always carrying it (`linkColumn` below builds one).
 */
export interface TableColumn<Row> extends Omit<Column<Row>, "kind"> {
  kind: Column<Row>["kind"] | "chip" | "mono";
  render?: (row: Row) => ReactNode;
  link?: boolean;
}

/** The column that carries the row's link (P1: a row is a link). */
export function linkColumn<Row>(column: TableColumn<Row>): TableColumn<Row> {
  return { ...column, link: true };
}

/**
 * `rowKey` and `rowHref` take a **key or a template** as well as a function,
 * so a server `page.tsx` can render a table directly: a function cannot cross
 * the server/client boundary, and every screen was writing a `_table.tsx`
 * client wrapper for no other reason. A template names row fields in braces —
 * `"/console/org/harnesses/{id}"` — and each is URL-encoded.
 */
export type RowKey<Row> = (keyof Row & string) | ((row: Row) => string);
export type RowHref<Row> = string | ((row: Row) => string);

export interface TableProps<Row> {
  columns: TableColumn<Row>[];
  rows: Row[];
  rowKey: RowKey<Row>;
  /** P1: a row is a link; when absent rows are inert. */
  rowHref?: RowHref<Row>;
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: string) => void;
  /** The sentence from `content/empty.ts`. */
  empty: string;
  dense?: boolean;
}

const DASH = "—";

function isFact(value: unknown): value is Fact<ReactNode> {
  return typeof value === "object" && value !== null && "provenance" in value;
}

function isRelated(value: unknown): value is RelatedValue {
  return typeof value === "object" && value !== null && "unit" in value;
}

function field(row: unknown, key: string): unknown {
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>)[key] : undefined;
}

export function keyOf<Row>(rowKey: RowKey<Row>, row: Row): string {
  return typeof rowKey === "function" ? rowKey(row) : String(field(row, rowKey) ?? "");
}

export function hrefOf<Row>(rowHref: RowHref<Row>, row: Row): string {
  if (typeof rowHref === "function") return rowHref(row);
  return rowHref.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = field(row, key);
    return value === undefined || value === null ? whole : encodeURIComponent(String(value));
  });
}

function cell<Row>(column: TableColumn<Row>, row: Row): ReactNode {
  if (column.render) return column.render(row);
  const value = field(row, column.key);
  if (value === null || value === undefined || value === "") return DASH;
  if (column.kind === "scale" && column.scale && typeof value === "string") {
    return <ScaleTag scale={column.scale} value={value} size="sm" />;
  }
  if (column.kind === "related" && isRelated(value)) return <Related value={value} />;
  if (column.kind === "fact" && isFact(value)) return <FactCell fact={value} />;
  if (column.kind === "chip") return <Chip>{String(value)}</Chip>;
  if (column.kind === "mono") return <Mono>{String(value)}</Mono>;
  if (column.kind === "time" && typeof value === "string") {
    // The words are what a person scans; the instant is what they quote. The
    // relative form is computed from the clock, so the server's render and the
    // browser's first render can differ by a minute — that is a difference of
    // fact, not of markup, and is suppressed rather than papered over.
    return (
      <time
        dateTime={value}
        title={absolute(value)}
        suppressHydrationWarning
        className="whitespace-nowrap text-muted"
      >
        {relative(value)}
      </time>
    );
  }
  return String(value);
}

export function Table<Row>(props: TableProps<Row>) {
  const { columns, rows, rowKey, rowHref, sort, onSort, empty, dense = false } = props;
  const [focused, setFocused] = useState(0);
  const body = useRef<HTMLTableSectionElement>(null);

  function focus(index: number) {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    setFocused(next);
    body.current?.querySelectorAll("tr")[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>, index: number) {
    if (event.key === "ArrowDown") focus(index + 1);
    else if (event.key === "ArrowUp") focus(index - 1);
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(rows.length - 1);
    else if ((event.key === "Enter" || event.key === " ") && rowHref) {
      const link = event.currentTarget.querySelector("a");
      link?.click();
    } else return;
    event.preventDefault();
  }

  if (rows.length === 0) return <p className="px-1 py-10 text-md text-muted">{empty}</p>;

  const linked = columns.findIndex((column) => column.link);
  const linkAt = linked === -1 ? 0 : linked;
  const pad = dense ? "px-4 py-2" : "px-4 py-3";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-base">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                aria-sort={sort?.key === column.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                className={`border-b border-line px-4 py-2 text-2xs font-bold tracking-eyebrow whitespace-nowrap text-muted uppercase ${
                  column.kind === "number" ? "text-right" : ""
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  {column.sort !== false && onSort ? (
                    <button type="button" onClick={() => onSort(column.key)} className="cursor-pointer uppercase">
                      {column.heading}
                    </button>
                  ) : (
                    column.heading
                  )}
                  {column.help && <HelpMark text={column.help} />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={body}>
          {rows.map((row, index) => (
            <tr
              key={keyOf(rowKey, row)}
              tabIndex={rowHref ? (index === focused ? 0 : -1) : undefined}
              onFocus={() => setFocused(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className="relative border-b border-hairline last:border-b-0 hover:bg-sunken"
            >
              {columns.map((column, position) => (
                <td
                  key={column.key}
                  className={`${pad} align-top ${column.kind === "number" ? "text-right tabular-nums" : ""}`}
                >
                  {position === linkAt && rowHref ? (
                    <Link
                      href={hrefOf(rowHref, row)}
                      tabIndex={-1}
                      className="font-semibold after:absolute after:inset-0"
                    >
                      {cell(column, row)}
                    </Link>
                  ) : (
                    cell(column, row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
