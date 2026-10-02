"use client";

import { useState } from "react";
import { cell, sorted } from "@/lib/views/cells";
import {
  type MatrixDimension,
  type MatrixRow,
  type ModelProviderDisplay,
  type ModelProviderRow,
  type RoutingMatrix,
  dimensionLabel,
  endpointsOf,
  modelProviderColumns,
  needsKey,
  noneConnected,
  routedSubjects,
  signIn,
  statusOf,
  subjectLabels,
} from "@/lib/views/providers";
import { PROVIDERS_TEXT } from "@/content/screens/providers";
import { Chip } from "../../../../ui/chip";
import { Mono } from "../../../../ui/mono";
import { Notice } from "../../../../ui/notice";
import { Segmented } from "../../../../ui/segmented";
import { Table, type TableColumn } from "../../../../ui/table";
import { RoutingMatrixTable } from "./_matrix";
import { DeleteModelProvider } from "./_delete";
import { RemoveApproval, RoutingVerb } from "./_routing";
import { SetUp } from "./_set-up";

export interface ModelProviderTableProps {
  rows: ModelProviderRow[];
  /** 04 §10: *Set up*, *Approve for…* and *Delete* are an organization admin's;
   *  for anyone else the row without a key is simply a row without a key (P13). */
  orgAdmin: boolean;
  /** W6-D5: *Set default…* is `adminHere` — at a team that is the team admin,
   *  whose one cell is their own team's default within *approved for* (D42). */
  adminHere: boolean;
  matrix: RoutingMatrix;
  /** The matrix rows for the *By team* view, and the team a team admin may set. */
  byTeam: MatrixRow[];
  only: string | null;
  empty: string;
}

/**
 * One row per provider and its endpoints per wire format (04 §10). W6-D5 folded
 * Routing in: *Default for* and *Approved for* are columns of this table, with
 * the two verbs that write them, and the *By team* toggle shows the old matrix
 * as a read of the same routing. W6-D6 made *Reachable* into **Status**, and a
 * provider that needs a key carries neither verb and says why.
 */
export function ModelProviderTable(props: ModelProviderTableProps) {
  const { rows, orgAdmin, adminHere, matrix, byTeam, only, empty } = props;
  const [sort, setSort] = useState({ key: "provider", dir: "asc" as "asc" | "desc" });
  const [view, setView] = useState<"rows" | "byTeam">("rows");
  const [done, setDone] = useState<string | null>(null);
  const labels = subjectLabels(matrix);
  const byId = new Map(rows.map((row) => [row.id, row]));

  /** The subjects under one side of the row, grouped by dimension — the word
   *  *Teams* above its chips rather than beside each one, because three
   *  dimensions beside three chips is a column nobody can read. */
  function subjects(row: ModelProviderRow, side: unknown, removable: boolean) {
    const items = routedSubjects(side, labels);
    if (items.length === 0) return PROVIDERS_TEXT.none;
    const dimensions: MatrixDimension[] = ["teams", "harnesses", "providers"];
    return (
      <span className="grid gap-2">
        {dimensions.map((dimension) => {
          const held = items.filter((item) => item.dimension === dimension);
          if (held.length === 0) return null;
          return (
            <span key={dimension} className="grid gap-1">
              <span className="text-2xs tracking-eyebrow text-muted uppercase">
                {dimensionLabel(dimension)}
              </span>
              <span className="flex flex-wrap items-center gap-1">
                {held.map((item) => (
                  <span key={item.id} className="flex items-center gap-1">
                    <Chip>{item.label}</Chip>
                    {removable && orgAdmin && (
                      <RemoveApproval
                        row={row}
                        matrix={matrix}
                        dimension={dimension}
                        subject={item.id}
                      />
                    )}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    );
  }

  const display: ModelProviderDisplay[] = rows.map((row) => {
    const endpoints = endpointsOf(row);
    return {
      provider: row.id,
      endpoints: cell(
        <span className="grid gap-1">
          {endpoints.map((endpoint) => (
            <Mono key={endpoint.format} title={endpoint.url}>
              {`${endpoint.format} · ${endpoint.url}`}
            </Mono>
          ))}
        </span>,
        endpoints.map((endpoint) => endpoint.format).join(" "),
      ),
      models: row.models.join(", "),
      credentialAlias: cell(
        row.credential ? <Chip>{row.credential}</Chip> : orgAdmin ? <SetUp row={row} onDone={setDone} /> : "—",
        row.credential ?? "",
      ),
      status: statusOf(row),
      defaultFor: cell(subjects(row, row.defaultFor, false)),
      approvedFor: cell(subjects(row, row.approvedFor, true)),
      verbs: row.id,
    };
  });

  const columns: TableColumn<ModelProviderDisplay>[] = modelProviderColumns().map((column) => {
    const verbs = column.key === "defaultFor" || column.key === "approvedFor";
    if (!verbs || !(adminHere || orgAdmin)) return column;
    return {
      ...column,
      sort: false as const,
      render: (shown: ModelProviderDisplay) => {
        const row = byId.get(shown.provider);
        if (!row) return null;
        const verb = column.key === "defaultFor" ? "default" : "approve";
        const shownCell = verb === "default" ? shown.defaultFor.value : shown.approvedFor.value;
        // W6-D6: excluded, and the row says so where the verb would be (P13 is
        // about permission; this is about the provider).
        if (needsKey(row)) {
          // Said once, in the first of the two cells: a row says why it is out
          // where its verb would be, not twice across the table.
          return verb === "default" ? (
            <span className="grid gap-1">
              {shownCell}
              <span className="text-base text-muted">{PROVIDERS_TEXT.needsKeyNote}</span>
            </span>
          ) : (
            shownCell
          );
        }
        const mayWrite = verb === "default" ? adminHere : orgAdmin;
        return (
          <span className="grid gap-2">
            {shownCell}
            {/* W7-D2: a sign-in row keeps both verbs — the broker allows that
                session — and says what choosing it means, in the same cell the
                keyless row says why it is out. */}
            {verb === "default" && signIn(row) && (
              <span className="text-base text-muted">{PROVIDERS_TEXT.signInNote}</span>
            )}
            {mayWrite && <RoutingVerb row={row} matrix={matrix} verb={verb} only={only} />}
          </span>
        );
      },
    };
  });
  if (orgAdmin) {
    columns.push({
      key: "verbs",
      heading: "",
      kind: "text",
      sort: false,
      render: (shown) => {
        const row = byId.get(shown.verbs);
        return row ? <DeleteModelProvider row={row} /> : null;
      },
    });
  }

  return (
    <div className="grid gap-4">
      {/* W7-D2: *a session has nowhere to send a request* is no longer true
          when a runtime signs in to one of these itself, so the sign-in line
          below replaces it rather than sitting under it. */}
      {noneConnected(rows) && !rows.some(signIn) && (
        <Notice tone="hold">{PROVIDERS_TEXT.firstRun.model}</Notice>
      )}
      {/* W7-D2's honesty line, said once for the screen rather than per row:
          what a sign-in session gives up is where the request goes, and that
          is the same sentence for every provider on the list. */}
      {rows.some(signIn) && <Notice tone="accent">{PROVIDERS_TEXT.signInReach}</Notice>}
      {done && <Notice tone="ok">{done}</Notice>}
      <div className="flex justify-end">
        <Segmented
          label={PROVIDERS_TEXT.viewLabel}
          value={view}
          options={[
            { id: "rows", label: PROVIDERS_TEXT.views.rows },
            { id: "byTeam", label: PROVIDERS_TEXT.views.byTeam },
          ]}
          onChange={(id) => setView(id === "byTeam" ? "byTeam" : "rows")}
        />
      </div>
      {view === "byTeam" ? (
        <RoutingMatrixTable rows={byTeam} empty={empty} />
      ) : (
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
      )}
    </div>
  );
}
