"use client";

/* The manage pane of the asset screen: where this asset reaches, whether it
   is switched on, and how to hand it to another org unit. */

import { FormEvent, useCallback, useEffect, useState } from "react";
import { list } from "@/lib/api";
import { Api, Asset, LineageRow, TreeNode } from "@/lib/types";
import {
  Badge,
  Button,
  Chip,
  CONTROL_CLASS,
  day,
  dateTime,
  EmptyState,
  Field,
  Mono,
  Notice,
  shortId,
} from "./ui";

/** Paths are dot-separated slugs, so a segment count is the unit's depth. */
function depthOf(path: string) {
  return path.split(".").length;
}

function Heading({ children }: { children: string }) {
  return (
    <h2 className="pb-2 text-[11px] font-bold tracking-[0.1em] text-muted uppercase">{children}</h2>
  );
}

/** What this row's live version says about the one it was taken from. */
function Drift({ row, rows }: { row: LineageRow; rows: LineageRow[] }) {
  const source = rows.find((other) => other.asset_id === row.promoted_from_asset_id);
  if (row.promoted_from_seq == null) {
    /* No promotion behind the live version: if something above also has this
       name, this unit's copy has diverged from it. */
    const above = rows.some((other) => row.path.startsWith(`${other.path}.`));
    return above ? <Badge tone="accent">own changes</Badge> : null;
  }
  if (!source) return <Mono>promoted from v{row.promoted_from_seq}</Mono>;
  const behind = (source.seq ?? 0) - row.promoted_from_seq;
  return behind > 0 ? (
    <Badge tone="hold">
      {behind} behind {source.name}
    </Badge>
  ) : (
    <Badge tone="ok">matches {source.name}</Badge>
  );
}

/* Broad to narrow, one row per org unit that has this name. The indent is the
   org tree, so where a name is overridden is the shape of the list. */
function Lineage({ rows, asset }: { rows: LineageRow[]; asset: Asset }) {
  const base = Math.min(...rows.map((row) => depthOf(row.path)));
  const here = rows.find((row) => row.asset_id === asset.id);
  /* A session resolves a name from the nearest active unit at or above it, so
     the winner for this unit is the deepest active row on its own path. */
  const chain = here
    ? rows.filter((row) => row.path === here.path || here.path.startsWith(`${row.path}.`))
    : [];
  const resolved = [...chain].reverse().find((row) => row.status === "active");

  return (
    <ol className="relative m-0 grid list-none gap-1 p-0">
      {rows.map((row) => {
        const indent = (depthOf(row.path) - base) * 22;
        const isHere = row.asset_id === asset.id;
        return (
          <li
            key={row.asset_id}
            className={
              indent
                ? "relative before:absolute before:top-1/2 before:-left-3 before:h-px before:w-3 before:bg-line"
                : ""
            }
            style={{ marginLeft: `${indent}px` }}
          >
            <div
              className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border px-3 py-2.5 ${
                isHere ? "border-accent bg-accent-soft/40" : "border-line bg-surface"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13px] font-semibold">{row.name}</span>
                <Mono>{row.role}</Mono>
              </span>
              {row.version_id ? (
                <span className="flex items-center gap-2">
                  <Chip title={row.version_id}>{shortId(row.version_id)}</Chip>
                  <Mono title={dateTime(row.updated_at)}>
                    v{row.seq} · {day(row.updated_at)}
                  </Mono>
                </span>
              ) : (
                <Mono>no version pushed</Mono>
              )}
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <Drift row={row} rows={rows} />
                {row.status !== "active" && <Badge tone="warn">disabled</Badge>}
                {row.asset_id === resolved?.asset_id && <Badge tone="ok">in use here</Badge>}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function AssetManage({
  asset,
  api,
  units,
  onChanged,
  onError,
}: {
  asset: Asset;
  api: Api;
  units: { node: TreeNode; trail: TreeNode[] }[];
  onChanged: () => void;
  onError: (cause: unknown) => void;
}) {
  const [rows, setRows] = useState<LineageRow[]>();
  const [busy, setBusy] = useState(false);
  const disabled = asset.status !== "active";

  const loadLineage = useCallback(() => {
    api<unknown>(`/v1/assets/${encodeURIComponent(asset.id)}/lineage`)
      .then((value) => setRows(list<LineageRow>(value)))
      .catch(onError);
  }, [api, asset.id, onError]);

  useEffect(loadLineage, [loadLineage]);

  /* Both mutations move the ladder: a status change moves which row is in
     use, and a promotion adds or advances one below. */
  async function mutate(path: string, method: string, body: unknown) {
    setBusy(true);
    try {
      await api(`/v1/assets/${encodeURIComponent(asset.id)}${path}`, {
        method,
        body: JSON.stringify(body),
      });
      onChanged();
      loadLineage();
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  }

  function promote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = String(form.get("message") ?? "").trim();
    void mutate("/promote", "POST", {
      target_org_unit_id: form.get("target_org_unit_id"),
      ...(message ? { message } : {}),
    });
  }

  return (
    <div className="grid items-start gap-6 pt-5 pb-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="min-w-0">
        <Heading>Where this name resolves</Heading>
        {rows === undefined ? (
          <EmptyState>Loading…</EmptyState>
        ) : rows.length ? (
          <Lineage rows={rows} asset={asset} />
        ) : (
          <EmptyState>No org unit visible to you has this asset.</EmptyState>
        )}
      </section>

      <div className="grid gap-5">
        <section className="rounded-lg border border-line bg-sunken p-4">
          <Heading>Availability</Heading>
          <p className="text-[13px] leading-relaxed text-muted">
            {disabled
              ? "This asset is disabled: no session resolves it. Every version is still here."
              : "This asset is live: sessions at or below this unit resolve it unless a unit further down overrides the name."}
          </p>
          <Button
            className="mt-3"
            full
            disabled={busy}
            onClick={() => void mutate("", "PATCH", { status: disabled ? "active" : "archived" })}
          >
            {disabled ? "Enable" : "Disable"}
          </Button>
        </section>

        <section className="rounded-lg border border-line bg-sunken p-4">
          <Heading>Promote</Heading>
          <form className="grid gap-4" onSubmit={promote}>
            <Notice tone="accent">
              Copies the live version into another org unit, which keeps its own history from there.
            </Notice>
            <Field label="Destination org unit">
              <select name="target_org_unit_id" required defaultValue="" className={CONTROL_CLASS}>
                <option value="" disabled>
                  Select a unit…
                </option>
                {units
                  .filter(({ node }) => node.id !== asset.org_unit_id)
                  .map(({ node, trail }) => (
                    <option key={node.id} value={node.id}>
                      {[...trail, node].map((entry) => entry.name).join(" / ")}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Change note" name="message" placeholder={`Promote ${asset.name}`} />
            <Button variant="primary" type="submit" full disabled={busy}>
              Promote
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
