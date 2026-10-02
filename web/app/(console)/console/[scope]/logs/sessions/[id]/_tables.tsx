"use client";

import type { EndpointTally, ReachRow, RefusalRow, SlotRow } from "@/lib/views/session";
import type { Column } from "@/lib/views/types";
import { EMPTY } from "@/content/empty";
import { SESSIONS, SESSIONS_WORDS as WORDS } from "@/content/screens/sessions";
import { Table } from "../../../../../ui/table";

/** 04 §13's slots table. `state` and `evidence` are the two registered
 *  scales; *Resolved from* is text and never a value (engine I6). */
export function SlotsTable({ rows }: { rows: SlotRow[] }) {
  const columns: Column<SlotRow>[] = [
    { key: "need", heading: SESSIONS.columns.slotNeed.heading, kind: "text", help: SESSIONS.columns.slotNeed.help },
    {
      key: "state",
      heading: SESSIONS.columns.slotState.heading,
      kind: "scale",
      scale: "slot",
      help: SESSIONS.columns.slotState.help,
    },
    {
      key: "evidence",
      heading: SESSIONS.columns.slotEvidence.heading,
      kind: "scale",
      scale: "evidence",
      help: SESSIONS.columns.slotEvidence.help,
    },
    {
      key: "resolvedFrom",
      heading: SESSIONS.columns.resolvedFrom.heading,
      kind: "text",
      sort: false,
      help: SESSIONS.columns.resolvedFrom.help,
    },
    { key: "via", heading: SESSIONS.columns.via.heading, kind: "text", sort: false, help: SESSIONS.columns.via.help },
    {
      key: "blocker",
      heading: SESSIONS.columns.blocker.heading,
      kind: "text",
      sort: false,
      help: SESSIONS.columns.blocker.help,
    },
  ];
  return (
    <div data-slots>
      <Table columns={columns} rows={rows} rowKey={(row) => row.key} empty={EMPTY.sessions.sentence} dense />
    </div>
  );
}

/**
 * W6-D9 — the tool calls a boundary refused in this session.
 *
 * A boundary of kind `command` is `intercepted`: the runtime refuses the call
 * at the moment it is made (engine 06 §13), so the proxy log never sees it and
 * the endpoint tally never counts it. This table is the whole record that the
 * boundary did its job, which is why it is here and not only in the spool.
 */
export function RefusalsTable({ rows }: { rows: RefusalRow[] }) {
  const columns: Column<RefusalRow>[] = (
    ["refusedTool", "refusedSaid", "refusedBoundary", "refusedSetBy", "refusedWhen"] as const
  ).map((key, index) => ({
    key: (["tool", "said", "boundary", "setBy", "when"] as const)[index],
    heading: SESSIONS.columns[key].heading,
    help: SESSIONS.columns[key].help,
    kind: "text",
    sort: false,
  }));
  return (
    <div data-refusals>
      <Table columns={columns} rows={rows} rowKey={(row) => row.key} empty={EMPTY.sessions.sentence} dense />
    </div>
  );
}

/**
 * 04 §13 (3): hosts, the deny list and outside endpoints, each row naming the
 * object that decided it (PRD §7). The card used to add *they are not
 * enforced yet*; engine D133 enforces all three (`routable()` on `hosts` and
 * `reach`, `denied()` on `deny`), so it says the proxy held the session to
 * them (06 K-M4's reach clause, `reach_says_the_proxy_held_the_session`).
 */
export function ReachTable({ rows }: { rows: ReachRow[] }) {
  interface Row extends Record<string, unknown> {
    key: string;
    what: string;
    decidedBy: string;
  }
  const columns: Column<Row>[] = [
    { key: "what", heading: WORDS.reach.what, kind: "text", sort: false },
    { key: "decidedBy", heading: WORDS.reach.decidedBy, kind: "text", sort: false },
  ];
  const table: Row[] = rows.map((row) => ({
    key: row.key,
    what: row.what,
    decidedBy: row.decidedBy,
  }));
  return (
    <div data-reach className="grid gap-3">
      <p className="text-base text-muted">{WORDS.reach.enforced}</p>
      <Table
        columns={columns}
        rows={table}
        rowKey={(row) => row.key}
        empty={EMPTY["session.endpoints"].sentence}
        dense
      />
    </div>
  );
}

/** 04 §13 (4): the proxy's authoritative tally, one row per host and alias. */
export function EndpointsTable({ rows }: { rows: EndpointTally[] }) {
  interface Row extends Record<string, unknown> {
    key: string;
    host: string;
    port: number;
    alias: string;
    count: number;
    refused: number;
    firstAt: string;
    lastAt: string;
  }
  const columns: Column<Row>[] = [
    { key: "host", heading: WORDS.endpointsColumns.host, kind: "text" },
    { key: "port", heading: WORDS.endpointsColumns.port, kind: "number" },
    { key: "alias", heading: WORDS.endpointsColumns.alias, kind: "text" },
    { key: "count", heading: WORDS.endpointsColumns.count, kind: "number" },
    { key: "refused", heading: WORDS.endpointsColumns.refused, kind: "number" },
    { key: "firstAt", heading: WORDS.endpointsColumns.firstAt, kind: "time" },
    { key: "lastAt", heading: WORDS.endpointsColumns.lastAt, kind: "time" },
  ];
  const table: Row[] = rows.map((row) => ({
    key: `${row.host}-${row.port}-${row.alias ?? ""}`,
    host: row.host,
    port: row.port,
    alias: row.alias ?? "",
    count: row.count,
    refused: row.refused,
    firstAt: row.firstAt,
    lastAt: row.lastAt,
  }));
  return (
    <div data-endpoints>
      <Table
        columns={columns}
        rows={table}
        rowKey={(row) => row.key}
        empty={EMPTY["session.endpoints"].sentence}
        dense
      />
    </div>
  );
}
