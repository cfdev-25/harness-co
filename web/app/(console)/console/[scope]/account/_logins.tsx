"use client";

import { cell } from "@/lib/views/cells";
import type { Column } from "@/lib/views/types";
import { ACCOUNT, ACCOUNT_TEXT } from "@/content/screens/account";
import { HOW_TEXT } from "@/content/screens/how";
import { CommandBlock } from "../../../ui/command-block";
import { Table } from "../../../ui/table";

export interface Login {
  tool: string;
  present: string;
  asOf: string;
  command: string;
}

interface LoginDisplay {
  tool: string;
  present: string;
  asOf: string;
  createIt: ReturnType<typeof cell>;
}

const KEYS = ["tool", "present", "asOf", "createIt"] as const;

/**
 * D45: the console cannot probe a machine, so the logins come from the last
 * session's `login` slots and are labelled *as of your last session*. A
 * missing one shows the command that creates it, from the shared sheet (P14).
 */
export function Logins({ rows, empty }: { rows: Login[]; empty: string }) {
  const columns: Column<LoginDisplay>[] = KEYS.map((key) => ({
    key,
    heading: ACCOUNT.columns[key].heading,
    help: ACCOUNT.columns[key].help,
    kind: key === "present" ? "scale" : key === "createIt" ? "fact" : "text",
    scale: ACCOUNT.columns[key].scale,
    sort: false,
  }));
  const display: LoginDisplay[] = rows.map((row) => ({
    tool: row.tool,
    present: row.present,
    asOf: row.asOf,
    createIt:
      row.present === "satisfied"
        ? cell("—", "")
        : cell(
            <CommandBlock
              label={ACCOUNT.columns.createIt.heading}
              command={row.command}
              copyLabel={HOW_TEXT.copy}
              copiedLabel={HOW_TEXT.copied}
            />,
            row.command,
          ),
  }));
  return (
    <div className="grid gap-2">
      <Table columns={columns} rows={display} rowKey={(row) => row.tool} empty={empty} dense />
      <p className="text-xs text-faint">{ACCOUNT_TEXT.loginsAsOf}</p>
    </div>
  );
}
