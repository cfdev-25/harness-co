"use client";

import {
  DIFFERENCES,
  hasConflict,
  type HarnessFileRow,
  type VersionId,
} from "@/lib/views/harness";
import type { Column } from "@/lib/views/types";
import { COMMAND_SHEET } from "@/content/commands.generated";
import { EMPTY } from "@/content/empty";
import { HARNESS, HARNESS_WORDS as WORDS } from "@/content/screens/harness";
import { UI } from "@/content/ui";
import { CommandBlock } from "../../../../ui/command-block";
import { Notice } from "../../../../ui/notice";
import { SectionLabel } from "../../../../ui/section-label";
import { Table } from "../../../../ui/table";

interface Row extends Record<string, unknown> {
  assetId: string;
  kind: string;
  name: string;
  lastEditor: string;
  note: string;
  when: string;
  differs: string;
  owner: string;
  href: string;
}

/**
 * The two bulk verbs act on the person's machine, so they are rows of the
 * shared sheet and nothing else — label, command and note as the CLI prints
 * them (D40, P9, P14). 05 §6 has no *offer everything* row today, so the
 * offer half is the sheet's per-file row; reported rather than invented.
 */
function sheetRow(prefix: string): { what: string; run: string; note?: string } {
  for (const group of COMMAND_SHEET) {
    for (const row of group.rows) if (row.run.startsWith(prefix)) return row;
  }
  return { what: prefix, run: prefix };
}

/**
 * 04 §5's flat file table. *Differs* exists in the Differences view alone
 * (P12) and is plain text, never a `ScaleTag` — a comparison state is not a
 * scale. The last-editor column is whatever the selected version says,
 * because the server composed the rows for that version (P12).
 */
export function FilesView({
  rows,
  base,
  version,
  as,
  identical,
}: {
  rows: HarnessFileRow[];
  base: string;
  version: VersionId;
  as: string | null;
  identical: boolean;
}) {
  const differences = version === DIFFERENCES;
  const query = new URLSearchParams({ version });
  if (as) query.set("as", as);

  const columns: Column<Row>[] = [
    { key: "kind", heading: HARNESS.columns.type.heading, kind: "text", help: HARNESS.columns.type.help },
    { key: "name", heading: HARNESS.columns.name.heading, kind: "text", help: HARNESS.columns.name.help },
    // 06 K-M1 (`file_owner_matches_winning_branch`): the founder opens a
    // harness and sees every file's owner. 04 §5's column list omits it;
    // reported, and carried here because the milestone row names it.
    { key: "owner", heading: HARNESS.columns.owner.heading, kind: "text", help: HARNESS.columns.owner.help },
    {
      key: "lastEditor",
      heading: HARNESS.columns.lastEditor.heading,
      kind: "text",
      help: HARNESS.columns.lastEditor.help,
    },
    { key: "note", heading: HARNESS.columns.note.heading, kind: "text", sort: false, help: HARNESS.columns.note.help },
    { key: "when", heading: HARNESS.columns.when.heading, kind: "time", help: HARNESS.columns.when.help },
  ];
  if (differences) {
    columns.push({
      key: "differs",
      heading: HARNESS.columns.differs.heading,
      kind: "text",
      help: HARNESS.columns.differs.help,
    });
  }

  const table: Row[] = rows.map((row) => ({
    assetId: row.assetId,
    // W5-D10: the organization decided this, not the harness — `required` into
    // every session, `recommended` into every new harness. `on-request` is the
    // ordinary case and says nothing, because the row being here says it.
    kind: row.loads && row.loads !== "on-request" ? `${row.kind} · ${row.loads}` : row.kind,
    name: row.name,
    lastEditor: row.lastEditor?.name ?? "",
    note: row.lastEditor?.note ?? "",
    when: row.lastEditor?.at ?? "",
    differs: row.differs ? WORDS.differs[row.differs] : "",
    owner: row.owner,
    href: `${base}/files/${row.assetId}?${query.toString()}`,
  }));

  return (
    <div className="grid gap-4 pt-4">
      {identical && <Notice>{WORDS.identical}</Notice>}
      {differences && hasConflict(rows) && (
        <div data-conflict>
          <Notice tone="warn">{WORDS.differs.conflict}</Notice>
        </div>
      )}
      {table.length === 0 ? (
        // 04 §5's empty state links the sheet, because what fills a harness
        // happens on the person's machine (D40).
        <div className="grid justify-items-start gap-3 py-10">
          <p className="max-w-md text-md text-muted">{EMPTY["harness.files"].sentence}</p>
          <CommandBlock
            label={EMPTY["harness.files"].verb?.label ?? ""}
            command={EMPTY["harness.files"].verb?.command ?? ""}
            copyLabel={UI.copy.copy}
            copiedLabel={UI.copy.copied}
          />
        </div>
      ) : (
        <Table
          columns={columns}
          rows={table}
          rowKey={(row) => row.assetId}
          rowHref={(row) => row.href}
          empty={EMPTY["harness.files"].sentence}
        />
      )}
      {differences && (
        <div data-bulk className="grid gap-3 border-t border-hairline pt-4">
          <SectionLabel>{WORDS.bulk.label}</SectionLabel>
          <p className="text-base text-muted">{WORDS.bulk.note}</p>
          {[sheetRow("harness offer"), sheetRow("harness reset --all")].map((row) => (
            <CommandBlock
              key={row.run}
              label={row.what}
              command={row.run}
              hint={row.note}
              copyLabel={UI.copy.copy}
              copiedLabel={UI.copy.copied}
            />
          ))}
        </div>
      )}
    </div>
  );
}
