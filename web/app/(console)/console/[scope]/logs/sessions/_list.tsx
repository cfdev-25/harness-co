"use client";

import { shortTime } from "@/lib/views/harness";
import {
  endpointsCell,
  lastActiveFact,
  modelCell,
  providerCell,
  type SessionRow,
} from "@/lib/views/session";
import type { Column, Fact } from "@/lib/views/types";
import { EMPTY } from "@/content/empty";
import { SESSIONS, SESSIONS_WORDS as WORDS } from "@/content/screens/sessions";

import { Table } from "../../../../ui/table";

const PERSON: Column<Row> = {
  key: "person",
  heading: SESSIONS.columns.person.heading,
  kind: "text",
  help: SESSIONS.columns.person.help,
};

interface Row extends Record<string, unknown> {
  id: string;
  person: string;
  harness: string;
  provider: string;
  model: string;
  status: string;
  started: string;
  lastActive: Fact<string>;
  endpoints: string;
}

/**
 * 04 §13's list columns, in its order. *Model* reads **not metered** for a
 * native session and never `0` (P16, engine C22); *Last active* is a `Fact`
 * that is observed while the session runs and declared once it has ended.
 * At `me` on a personal account the Person column has one value and no
 * meaning, so it is not drawn (07 §3, D14).
 */
export function SessionList({
  rows,
  base,
  personal,
}: {
  rows: SessionRow[];
  base: string;
  personal: boolean;
}) {
  const columns: Column<Row>[] = [
    ...(personal ? [] : [PERSON]),
    { key: "harness", heading: SESSIONS.columns.harness.heading, kind: "text", help: SESSIONS.columns.harness.help },
    { key: "provider", heading: SESSIONS.columns.provider.heading, kind: "text", help: SESSIONS.columns.provider.help },
    { key: "model", heading: SESSIONS.columns.model.heading, kind: "text", help: SESSIONS.columns.model.help },
    {
      key: "status",
      heading: SESSIONS.columns.status.heading,
      kind: "scale",
      scale: "session",
      help: SESSIONS.columns.status.help,
    },
    { key: "started", heading: SESSIONS.columns.started.heading, kind: "time", sort: "desc", help: SESSIONS.columns.started.help },
    { key: "lastActive", heading: SESSIONS.columns.lastActive.heading, kind: "fact", help: SESSIONS.columns.lastActive.help },
    { key: "endpoints", heading: SESSIONS.columns.endpoints.heading, kind: "text", sort: false, help: SESSIONS.columns.endpoints.help },
  ];

  const table: Row[] = rows.map((row) => ({
    id: row.id,
    person: row.person.name,
    harness: row.harness?.name ?? "",
    provider: providerCell(row),
    model: modelCell(row, WORDS.notMetered),
    status: row.status,
    started: row.startedAt,
    lastActive: { ...lastActiveFact(row), value: shortTime(row.lastActiveAt) },
    endpoints: endpointsCell(row, { reached: WORDS.reached, refused: WORDS.refused }),
  }));

  return (
    <Table
      columns={columns}
      rows={table}
      rowKey={(row) => row.id}
      rowHref={(row) => `${base}/${row.id}`}
      empty={EMPTY.sessions.sentence}
    />
  );
}
