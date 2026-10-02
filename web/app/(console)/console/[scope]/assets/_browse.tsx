"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cell, type Cell } from "@/lib/views/cells";
import {
  type BrowseRow,
  browseFilter,
  browseKinds,
  fromLabel,
  withEnvironments,
} from "@/lib/views/assets";
import type { HarnessCard, PersonalChoices } from "@/lib/views/harness";
import type { Scope } from "@/lib/views/types";
import { fill } from "@/lib/views/refusals";
import { ASSETS, ASSETS_TEXT } from "@/content/screens/assets";
import { Checkbox } from "../../../ui/checkbox";
import { Table, type TableColumn } from "../../../ui/table";
import { SelectionBar } from "./_selection-bar";

export interface BrowseProps {
  rows: BrowseRow[];
  /** The viewer's own harnesses — `GET /v1/console/harnesses?scope=me`, the
   *  cards at *You*: the only ones *Add to harness* may write. */
  harnesses: HarnessCard[];
  scope: Scope;
  /** `?kind=` inside Browse. `""` is every kind, which is where it opens. */
  kind: string;
  /** `scopeHref(scope, "/assets")`, which the kind filter's links are built on. */
  base: string;
  /** `?q=` from the bar's search (01 §7.5); `""` is everything. */
  query: string;
  /** W7-D4: passed straight to the bar's *New harness from selection*, which
   *  is the harnesses screen's own dialog. Absent for an enterprise viewer. */
  personal?: PersonalChoices;
}

interface Row {
  id: string;
  pick: Cell;
  kind: string;
  name: Cell;
  description: string;
  from: string;
  held: string;
}

/**
 * The store — 04 §12, W5-D15. Everything the viewer can use in one list: the
 * winning copy of every asset on their chain and the bundled presets the
 * organisation does not hold yet. The server decides what is in it
 * (`console.browse_rows`); this screen ticks, filters and asks.
 *
 * The kind filter here is a quieter thing than the screen's kind tabs,
 * because the store opens on *all kinds*: a person looking for something does
 * not know its kind yet. It is still `?kind=`, so a link into a kind works.
 */
export function Browse({ rows, harnesses, scope, kind, base, query, personal }: BrowseProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const chosen = useMemo(() => withEnvironments(picked, rows), [picked, rows]);
  const byId = new Map(rows.map((row) => [row.id, row]));

  function toggle(id: string, on: boolean) {
    setPicked((was) => (on ? [...was, id] : was.filter((one) => one !== id)));
  }

  const shown: Row[] = browseFilter(rows, kind, query).map((row) => ({
    id: row.id,
    pick: cell(
      <Checkbox
        label=""
        aria-label={fill(ASSETS_TEXT.browseSelectLabel, { name: row.name })}
        checked={picked.includes(row.id)}
        onChange={(event) => toggle(row.id, event.target.checked)}
      />,
    ),
    kind: row.kind.replace(/_/g, " "),
    // A preset is on no branch, so it has no page and the name is plain.
    name: row.href
      ? cell(
          <Link href={row.href} className="font-semibold text-accent-text hover:underline">
            {row.name}
          </Link>,
          row.name,
        )
      : cell(<span className="font-semibold">{row.name}</span>, row.name),
    description: row.description,
    from: fromLabel(row),
    held: row.held ? ASSETS_TEXT.browseHeldYes : "",
  }));

  const columns: TableColumn<Row>[] = [
    { key: "pick", heading: "", kind: "fact", sort: false },
    { key: "kind", heading: ASSETS.columns.type.heading, kind: "chip", help: ASSETS.columns.type.help },
    { key: "name", heading: ASSETS.columns.name.heading, kind: "fact" },
    { key: "description", heading: ASSETS.columns.description.heading, kind: "text" },
    { key: "from", heading: ASSETS_TEXT.browseFrom, kind: "chip" },
    { key: "held", heading: ASSETS_TEXT.browseHeldHeading, kind: "text" },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-4">
        <nav aria-label={ASSETS_TEXT.browseAllKinds} className="flex flex-wrap gap-2 pb-1">
          <KindLink href={base} label={ASSETS_TEXT.browseAllKinds} current={kind === ""} />
          {browseKinds(rows).map((one) => (
            <KindLink
              key={one}
              href={`${base}?tab=browse&kind=${encodeURIComponent(one)}`}
              label={one.replace(/_/g, " ")}
              current={kind === one}
            />
          ))}
        </nav>
      </div>

      <div data-browse>
        <Table
          columns={columns}
          rows={shown}
          rowKey="id"
          empty={rows.length === 0 ? ASSETS_TEXT.browseEmpty : ASSETS_TEXT.browseFilteredEmpty}
        />
      </div>

      {picked.length > 0 && (
        <SelectionBar
          scope={scope}
          harnesses={harnesses}
          ids={chosen.ids}
          brought={chosen.brought}
          picked={picked.length}
          presets={chosen.ids.some((id) => byId.get(id)?.preset)}
          personal={personal}
          onClear={() => setPicked([])}
        />
      )}
    </div>
  );
}

function KindLink({ href, label, current }: { href: string; label: string; current: boolean }) {
  return (
    <Link
      href={href}
      aria-current={current ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-xs no-underline ${
        current ? "border-accent text-accent-text" : "border-line text-muted hover:text-fg"
      }`}
    >
      {label}
    </Link>
  );
}
