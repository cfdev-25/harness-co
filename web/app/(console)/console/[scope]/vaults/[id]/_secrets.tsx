"use client";

import Link from "next/link";
import { cell, observed } from "@/lib/views/cells";
import {
  type Finding,
  type SecretDisplay,
  type SecretRow,
  secretColumns,
  secretGroups,
  secretReady,
  secretWhen,
} from "@/lib/views/vaults";
import { VAULTS_TEXT, VAULT_REACH } from "@/content/screens/vaults";
import { Mono } from "../../../../ui/mono";
import { SectionLabel } from "../../../../ui/section-label";
import { Table, type TableColumn } from "../../../../ui/table";
import { RotateSecret } from "./_rotate";

export interface SecretTableProps {
  rows: SecretRow[];
  empty: string;
  finding: Finding;
  base: string;
  vaultId: string;
  /** PRD §6.2: rotate exists on the vault we host and nowhere else. */
  bundled: boolean;
}

const FILTERS: Array<{ id: Finding; label: string; note: string }> = [
  { id: "all", label: VAULTS_TEXT.allSecrets, note: "" },
  { id: "uncovered", label: VAULTS_TEXT.uncovered, note: VAULTS_TEXT.uncoveredNote },
  { id: "dangling", label: VAULTS_TEXT.dangling, note: VAULTS_TEXT.danglingNote },
];

/** PRD §6.7's two findings are filters over the one list, not a score. */
export function SecretTable({ rows, empty, finding, base, vaultId, bundled }: SecretTableProps) {
  const display: SecretDisplay[] = rows.map((row) => {
    const ready = secretReady(row);
    const text = ready === null ? VAULT_REACH.unknown : ready ? VAULT_REACH.yes : VAULT_REACH.no;
    return {
      ref: row.ref,
      secret: cell(<Mono>{row.ref}</Mono>, row.ref),
      group: row.group,
      reachedBy: secretGroups(row),
      ready: observed(row.ready, text, text),
      lastUsed: secretWhen(row),
    };
  });
  const columns: TableColumn<SecretDisplay>[] = bundled
    ? [
        ...secretColumns(),
        {
          key: "ref",
          heading: "",
          kind: "text",
          sort: false,
          render: (row) => <RotateSecret vaultId={vaultId} secretRef={row.ref} />,
        },
      ]
    : secretColumns();
  return (
    <div className="grid gap-3">
      <SectionLabel>{VAULTS_TEXT.findings}</SectionLabel>
      <div className="flex flex-wrap gap-3">
        {FILTERS.map((item) => (
          <Link
            key={item.id}
            href={item.id === "all" ? base : `${base}?finding=${item.id}`}
            title={item.note}
            className={item.id === finding ? "text-accent-text" : "text-muted hover:text-fg"}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <Table
        columns={columns}
        rows={display}
        rowKey={(row) => row.group + row.ref}
        empty={empty}
        dense
      />
    </div>
  );
}
