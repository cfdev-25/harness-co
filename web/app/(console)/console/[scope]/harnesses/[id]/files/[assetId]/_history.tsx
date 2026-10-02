"use client";

import type { Column } from "@/lib/views/types";
import { FILE, FILE_WORDS as WORDS } from "@/content/screens/file";
import { SectionLabel } from "../../../../../../ui/section-label";
import { Table } from "../../../../../../ui/table";

interface Row extends Record<string, unknown> {
  commit: string;
  version: string;
  branch: string;
  who: string;
  when: string;
  message: string;
}

/**
 * 04 §6 (c): the history of **both** copies, each row labelled `mine` or
 * `team`, newest first. One table, two branches — never two tables, because
 * the point is that the two copies are one file's history.
 */
export function FileHistory({
  history,
}: {
  history: Array<{ commit: string; branch: "mine" | "team"; who: string; at: string; message: string }>;
}) {
  const columns: Column<Row>[] = [
    { key: "version", heading: FILE.columns.version.heading, kind: "text", help: FILE.columns.version.help },
    { key: "branch", heading: FILE.columns.branch.heading, kind: "text", help: FILE.columns.branch.help },
    { key: "who", heading: FILE.columns.who.heading, kind: "text", help: FILE.columns.who.help },
    { key: "when", heading: FILE.columns.when.heading, kind: "time", help: FILE.columns.when.help },
    { key: "message", heading: FILE.columns.message.heading, kind: "text", sort: false, help: FILE.columns.message.help },
  ];
  const rows: Row[] = [...history]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((entry) => ({
      commit: `${entry.branch}-${entry.commit}`,
      version: entry.commit.slice(0, 7),
      branch: WORDS.branch[entry.branch],
      who: entry.who,
      when: entry.at,
      message: entry.message,
    }));

  return (
    <section data-file-history className="grid gap-2">
      <SectionLabel>{WORDS.history}</SectionLabel>
      <Table columns={columns} rows={rows} rowKey={(row) => row.commit} empty={WORDS.noChange} dense />
    </section>
  );
}
