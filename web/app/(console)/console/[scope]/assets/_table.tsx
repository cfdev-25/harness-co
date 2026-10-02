"use client";

import { useState } from "react";
import { cell, sorted } from "@/lib/views/cells";
import {
  type AssetDisplay,
  type OrgAssetRow,
  assetColumns,
  assetRelated,
  description,
  lastChange,
  loadsLabel,
  usedBy,
} from "@/lib/views/assets";
import Link from "next/link";
import { Table, type TableColumn } from "../../../ui/table";
import { DeleteAsset } from "./_delete";
import { EditAsset } from "./_edit";

export interface AssetTableProps {
  rows: OrgAssetRow[];
  /** `?q=` from the bar's search (01 §7.5); `""` is every row. */
  query: string;
  empty: string;
  hrefFor: string;
  /** The verbs are the level admin's, and at *You* that is always the person
   *  (01 §7.5's `canEdit`, the same fact the chip states). The route decides
   *  again and its refusal is what the dialog shows. */
  canEdit: boolean;
  /** The `?scope=` a write takes (03 §4), not the URL segment. */
  scope: string;
}

/**
 * The rows of one kind (W5-D9): name, description, loads, used by, last
 * change, and — for an admin of this level — Edit and Delete. The kind is
 * the tab, so there is no Type column; the row is not a link, the Name cell
 * is, because the last cell holds two buttons.
 */
export function AssetTable({ rows, query, empty, hrefFor, canEdit, scope }: AssetTableProps) {
  const [sort, setSort] = useState({ key: "name", dir: "asc" as "asc" | "desc" });
  const needle = query.trim().toLowerCase();
  const found = rows.filter(
    (row) =>
      needle === "" ||
      `${row.name} ${description(row)}`.toLowerCase().includes(needle),
  );
  const display: AssetDisplay[] = found.map((row) => ({
    id: row.id,
    name: cell(
      <Link href={`${hrefFor}/${row.id}`} className="font-semibold text-accent-text hover:underline">
        {row.name}
      </Link>,
      row.name,
    ),
    description: description(row),
    loads: loadsLabel(row),
    usedBy: assetRelated(row).harnesses,
    lastChange: lastChange(row),
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const columns: TableColumn<AssetDisplay>[] = canEdit
    ? [
        ...assetColumns(),
        {
          key: "actions",
          heading: "",
          kind: "text",
          sort: false,
          render: (display) => {
            const row = byId.get(display.id);
            if (!row) return null;
            return (
              <span className="flex justify-end gap-2">
                <EditAsset
                  assetId={row.id}
                  name={row.name}
                  description={description(row)}
                  scope={scope}
                />
                <DeleteAsset assetId={row.id} leaves={usedBy(row)} scope={scope} />
              </span>
            );
          },
        },
      ]
    : assetColumns();
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
