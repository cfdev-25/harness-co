"use client";

import { cell, observed } from "@/lib/views/cells";
import { type EntryDisplay, type GroupEntry, entriesOf, entryColumns } from "@/lib/views/groups";
import { Chip } from "../../../../ui/chip";
import { Table, type TableColumn } from "../../../../ui/table";
import { RemoveEntry } from "./_verbs";

export interface EntryTableProps {
  name: string;
  /** The held list, verbatim: a `PATCH` replaces it whole, so a removal sends
   *  back what is here minus one row (03 §4.5). */
  entries: GroupEntry[];
  /** The verb is an organisation admin's; the route decides again. */
  mayEdit: boolean;
}

/**
 * A group's entries — alias → secret (04 §8). `Ready` is 04's observed
 * `FactCell`; `api` does not probe an entry on this response, so the cell is
 * observed with no value rather than a `false` nobody checked (P2).
 */
export function EntryTable({ name, entries, mayEdit }: EntryTableProps) {
  const rows: EntryDisplay[] = entriesOf(entries).map((entry, index) => ({
    index,
    alias: cell(<Chip>{entry.alias}</Chip>, entry.alias),
    secret: entry.ref,
    vault: entry.vault,
    upstream: entry.upstream,
    attach: entry.header,
    ready: observed(undefined, "—"),
  }));
  const columns: TableColumn<EntryDisplay>[] = mayEdit
    ? [
        ...entryColumns(),
        {
          key: "index",
          heading: "",
          kind: "text",
          sort: false,
          render: (row) => (
            <RemoveEntry name={name} entries={entries} index={row.index} alias={row.alias.text ?? ""} />
          ),
        },
      ]
    : entryColumns();
  return <Table columns={columns} rows={rows} rowKey={(row) => String(row.index)} empty="—" dense />;
}
