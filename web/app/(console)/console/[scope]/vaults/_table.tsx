"use client";

import { useState } from "react";
import { observed, sorted } from "@/lib/views/cells";
import {
  type VaultDisplay,
  type VaultRow,
  contents,
  handsUs,
  issues,
  reachableText,
  vaultColumns,
  vaultGroups,
  vaultLabel,
} from "@/lib/views/vaults";
import { VAULTS_TEXT, VAULT_REACH } from "@/content/screens/vaults";
import { Table } from "../../../ui/table";

export interface VaultTableProps {
  rows: VaultRow[];
  empty: string;
  hrefFor: string;
}

export function VaultTable({ rows, empty, hrefFor }: VaultTableProps) {
  const [sort, setSort] = useState({ key: "vault", dir: "asc" as "asc" | "desc" });
  const display: VaultDisplay[] = rows.map((row) => {
    const text = reachableText(row, VAULT_REACH.yes, VAULT_REACH.no, VAULT_REACH.unknown);
    return {
      vault: vaultLabel(row, VAULTS_TEXT.machineTitle),
      connected: observed(row.reachable, text, text),
      handsUs: handsUs(row),
      issues: issues(row),
      contents: contents(row),
      groups: vaultGroups(row),
    };
  });
  return (
    <Table
      columns={vaultColumns()}
      rows={sorted(display, sort.key, sort.dir)}
      rowKey={(row) => row.vault}
      rowHref={(row) => `${hrefFor}/${encodeURIComponent(rows.find((item) => vaultLabel(item, VAULTS_TEXT.machineTitle) === row.vault)?.id ?? row.vault)}`}
      sort={sort}
      onSort={(key) =>
        setSort((was) => ({ key, dir: was.key === key && was.dir === "asc" ? "desc" : "asc" }))
      }
      empty={empty}
    />
  );
}
