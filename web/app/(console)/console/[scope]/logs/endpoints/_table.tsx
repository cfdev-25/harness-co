"use client";

import Link from "next/link";
import { useState } from "react";
import { cell, sorted, when } from "@/lib/views/cells";
import {
  type AttemptDisplay,
  type EndpointRow,
  allowOf,
  attemptColumns,
  endpointsRelated,
  harnessNames,
  outcomeWord,
  reasonWords,
} from "@/lib/views/logs";
import { setByLabel } from "@/lib/views/reach";
import type { Viewer } from "@/lib/views/types";
import { LOGS_TEXT } from "@/content/screens/logs";
import { Chip } from "../../../../ui/chip";
import { Disclosure } from "../../../../ui/disclosure";
import { Mono } from "../../../../ui/mono";
import { Related } from "../../../../ui/related";
import { Table } from "../../../../ui/table";
import { AllowHost } from "./_allow";

export interface AttemptTableProps {
  rows: EndpointRow[];
  viewer: Viewer;
  /** `scopeHref(scope)` — the base every session link is built from. */
  base: string;
  empty: string;
}

/**
 * W5-D4: one row per (host, outcome, reason, setBy), because a host refused
 * for two reasons is two things to do something about (engine 05 §8). Every
 * refusal says which rule refused it and who owns that rule (P11), and a
 * refused row a viewer may lift carries **Allow**; where they may not, the
 * cell is the one sentence naming who can, never a disabled button (P13).
 *
 * The outcome is a `Chip`, not a `ScaleTag`: *reached*, *refused* and
 * *stripped* are what happened, and 04 D41's reasoning holds — a column of
 * data is not a scale, and `ScaleTag` throws on a value no scale registers.
 *
 * The row still opens onto PRD §19's join — the harnesses behind it, the
 * sessions, the port and alias — so nothing the old table showed is lost.
 */
export function AttemptTable({ rows, viewer, base, empty }: AttemptTableProps) {
  const [sort, setSort] = useState({ key: "last", dir: "desc" as "asc" | "desc" });
  const display: AttemptDisplay[] = rows.map((row) => {
    const allow = allowOf(row);
    const sessions = row.sessionIds ?? [];
    return {
      // The grouping the server used, in full (host, port, alias, outcome,
      // reason, setBy): drop any one of them and two distinct rows collide.
      key: [row.host, row.port ?? "", row.alias ?? "", row.outcome,
            row.reason ?? "", row.setBy ?? ""].join("|"),
      host: cell(
        <Disclosure summary={<Mono>{row.host}</Mono>}>
          <div className="grid gap-1 pt-2 pl-5 text-base text-muted">
            <span>
              {LOGS_TEXT.reachedBy} <Related value={endpointsRelated(row)} />
            </span>
            <span>
              {LOGS_TEXT.portIs} {row.port ?? "—"}
              {row.alias ? ` · ${LOGS_TEXT.viaAliasIs} ${row.alias}` : ""}
            </span>
            {sessions.map((id) => (
              <Link key={id} href={`${base}/logs/sessions/${id}`} className="font-mono text-xs">
                {id}
              </Link>
            ))}
          </div>
        </Disclosure>,
        row.host,
      ),
      outcome: cell(<Chip>{outcomeWord(row.outcome)}</Chip>, row.outcome),
      reason: reasonWords(row.reason),
      setBy: setByLabel(row.setBy, viewer, harnessNames(row)) || "—",
      count: row.count,
      first: when(row.firstAt),
      last: when(row.lastAt),
      sessions: cell(
        sessions.length === 1 ? (
          <Link href={`${base}/logs/sessions/${sessions[0]}`}>{row.sessions}</Link>
        ) : (
          (row.sessions || "—")
        ),
        String(row.sessions),
      ),
      allow: cell(
        allow.can ? (
          <AllowHost host={row.host} scope={allow.scope} />
        ) : allow.why ? (
          <span className="text-xs text-muted">{allow.why}</span>
        ) : (
          ""
        ),
      ),
    };
  });
  return (
    <Table
      columns={attemptColumns()}
      rows={sorted(display, sort.key, sort.dir)}
      rowKey="key"
      sort={sort}
      onSort={(key) =>
        setSort((was) => ({ key, dir: was.key === key && was.dir === "asc" ? "desc" : "asc" }))
      }
      empty={empty}
    />
  );
}
