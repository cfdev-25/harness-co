"use client";

import { useState } from "react";
import { cell, related, sorted } from "@/lib/views/cells";
import {
  type HarnessProviderDisplay,
  type HarnessProviderRow,
  approvalOf,
  decidedBy,
  decidedWhen,
  harnessProviderColumns,
  noneApproved,
  pinOf,
  runtimeName,
  speaksOf,
} from "@/lib/views/providers";
import { PROVIDERS_TEXT } from "@/content/screens/providers";
import { Mono } from "../../../ui/mono";
import { Notice } from "../../../ui/notice";
import { Table } from "../../../ui/table";
import { ApprovalSwitch } from "./_approval";

export interface HarnessProviderTableProps {
  rows: HarnessProviderRow[];
  personal: boolean;
  /** 04 §10: only an organisation admin gets the switch; everyone else reads
   *  the tag and the refusal the page already renders (P13). */
  orgAdmin: boolean;
  empty: string;
}

/** D47: a runtime that is not approved is a row with its reason, never
 *  filtered out — *not approved is a state* (PRD §9.1). */
export function HarnessProviderTable({ rows, personal, orgAdmin, empty }: HarnessProviderTableProps) {
  const [sort, setSort] = useState({ key: "provider", dir: "asc" as "asc" | "desc" });
  // W6-D3: the column shows the runtime's own name, so the row is keyed and
  // looked up by it — the id stays in the write, which names the provider.
  const byId = new Map(rows.map((row) => [runtimeName(row), row]));
  const display: HarnessProviderDisplay[] = rows.map((row) => ({
    provider: runtimeName(row),
    approval: approvalOf(row),
    approvedFor: related(row.teams, "teams"),
    pin: cell(<Mono title={pinOf(row)}>{pinOf(row)}</Mono>, pinOf(row)),
    speaks: speaksOf(row),
    reason: row.reason ?? "—",
    decidedBy: decidedBy(row),
    when: decidedWhen(row),
  }));
  const columns = harnessProviderColumns(personal).map((column) =>
    column.key === "approval" && orgAdmin && !personal
      ? {
          ...column,
          sort: false as const,
          render: (display_: HarnessProviderDisplay) => {
            const row = byId.get(display_.provider);
            return row ? <ApprovalSwitch row={row} /> : display_.approval;
          },
        }
      : column,
  );
  return (
    <div className="grid gap-4">
      {noneApproved(rows) && <Notice tone="hold">{PROVIDERS_TEXT.firstRun.harness}</Notice>}
      <Table
        columns={columns}
        rows={sorted(display, sort.key, sort.dir)}
        rowKey={(row) => row.provider}
        sort={sort}
        onSort={(key) =>
          setSort((was) => ({ key, dir: was.key === key && was.dir === "asc" ? "desc" : "asc" }))
        }
        empty={empty}
      />
    </div>
  );
}
