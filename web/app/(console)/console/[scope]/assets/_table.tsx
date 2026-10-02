"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useState } from "react";
import { cell, sorted } from "@/lib/views/cells";
import {
  type AssetDisplay,
  type OrgAssetRow,
  LOADS,
  assetColumns,
  assetRelated,
  description,
  lastChange,
  loadsLabel,
  loadsWord,
  usedBy,
} from "@/lib/views/assets";
import { ASSETS, ASSETS_TEXT } from "@/content/screens/assets";
import Link from "next/link";
import { Button } from "../../../ui/button";
import { Field } from "../../../ui/field";
import { Select } from "../../../ui/select";
import { Table, type TableColumn } from "../../../ui/table";
import { DeleteAsset } from "./_delete";
import { type Draft, said, useAssetEdit } from "./_edit";

export interface AssetTableProps {
  rows: OrgAssetRow[];
  /** `?q=` from the bar's search (01 §7.5); `""` is every row. */
  query: string;
  empty: string;
  hrefFor: string;
  /** The verbs are the level admin's, and at *You* that is always the person
   *  (01 §7.5's `canEdit`, the same fact the chip states). The route decides
   *  again and its refusal is what the row shows. */
  canEdit: boolean;
  /** How an organization asset loads is an organization admin's decision
   *  (`PUT /v1/assets/{id}/loads`), and only for a row on the organization's
   *  branch — so the Loads cell is a control exactly there. */
  orgAdmin: boolean;
  /** The `?scope=` a write takes (03 §4), not the URL segment. */
  scope: string;
}

/**
 * The rows of one kind (W5-D9): name, description, loads, used by, last
 * change, and — for an admin of this level — Edit and Delete. The kind is
 * the tab, so there is no Type column; the row is not a link, the Name cell
 * is, because the last cell holds two buttons. Edit is in place (D109): the
 * row's Name, Description and Loads cells become controls and the two
 * buttons become Save and Cancel; Enter saves, Escape cancels.
 */
export function AssetTable({ rows, query, empty, hrefFor, canEdit, orgAdmin, scope }: AssetTableProps) {
  const [sort, setSort] = useState({ key: "name", dir: "asc" as "asc" | "desc" });
  const edit = useAssetEdit(scope);
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

  function keys(event: KeyboardEvent) {
    if (event.key === "Enter") edit.save();
    else if (event.key === "Escape") edit.cancel();
    else return;
    event.preventDefault();
  }

  /** The three cells that become controls on the row being edited. */
  const editors: Partial<Record<keyof AssetDisplay, (draft: Draft, row: OrgAssetRow) => ReactNode>> = {
    name: (draft) => (
      <Field
        label={ASSETS_TEXT.editName}
        labelHidden
        name="name"
        value={draft.name}
        required
        autoFocus
        error={said(edit.failure, "words")}
        onChange={(event) => edit.set({ name: event.target.value })}
        onKeyDown={keys}
      />
    ),
    description: (draft) => (
      <Field
        label={ASSETS_TEXT.editDescription}
        labelHidden
        name="description"
        value={draft.description}
        onChange={(event) => edit.set({ description: event.target.value })}
        onKeyDown={keys}
      />
    ),
    loads: (draft, row) =>
      orgAdmin && row.level === "org" ? (
        <Select
          label={ASSETS_TEXT.loadsLabel}
          labelHidden
          name="loads"
          value={draft.loads}
          error={said(edit.failure, "loads")}
          onChange={(event) => {
            const state = LOADS.find((one) => one === event.target.value);
            if (state) edit.set({ loads: state });
          }}
          onKeyDown={keys}
        >
          {LOADS.map((state) => (
            <option key={state} value={state}>
              {loadsWord(state)}
            </option>
          ))}
        </Select>
      ) : (
        loadsLabel(row)
      ),
  };

  const columns: TableColumn<AssetDisplay>[] = assetColumns().map((column) => {
    const editor = editors[column.key];
    if (!editor || !canEdit) return column;
    return {
      ...column,
      render: (shown) => {
        const row = byId.get(shown.id);
        if (edit.draft && row && edit.draft.id === shown.id) return editor(edit.draft, row);
        const value = shown[column.key];
        if (column.key === "name") return shown.name.value;
        return typeof value === "string" && value !== "" ? value : "—";
      },
    };
  });
  if (canEdit) {
    columns.push({
      key: "actions",
      heading: "",
      kind: "text",
      sort: false,
      render: (shown) => {
        const row = byId.get(shown.id);
        if (!row) return null;
        if (edit.draft?.id === row.id) {
          return (
            <span className="flex justify-end gap-2">
              <Button size="sm" onClick={edit.cancel}>{ASSETS_TEXT.cancel}</Button>
              <Button size="sm" variant="primary" busy={edit.busy} onClick={edit.save}>
                {ASSETS_TEXT.editSubmit}
              </Button>
            </span>
          );
        }
        return (
          <span className="flex justify-end gap-2">
            <Button size="sm" explain={ASSETS.verbs.edit.explain} onClick={() => edit.start(row)}>
              {ASSETS.verbs.edit.label}
            </Button>
            <DeleteAsset assetId={row.id} leaves={usedBy(row)} scope={scope} />
          </span>
        );
      },
    });
  }
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
      {edit.confirm}
    </div>
  );
}
