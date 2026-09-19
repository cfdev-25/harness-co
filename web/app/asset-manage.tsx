"use client";

/* The manage pane of the asset screen: where this asset reaches, whether it
   is switched on, and how to hand it to another org unit. */

import { FormEvent, useCallback, useEffect, useState } from "react";
import { list } from "@/lib/api";
import { Api, Asset, Harness, LineageRow, TreeNode } from "@/lib/types";
import { AssetConflict } from "./asset-conflict";
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

/** The nearest active row above `row` on its own path — exactly what a
    collision this row shadows, or is shadowed by, would be. */
function nearestAncestorRow(row: LineageRow, rows: LineageRow[]): LineageRow | undefined {
  return rows
    .filter((other) => other.status === "active" && row.path.startsWith(`${other.path}.`))
    .sort((a, b) => b.path.length - a.path.length)[0];
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
function Lineage({
  rows,
  asset,
  api,
  onResolved,
  onError,
}: {
  rows: LineageRow[];
  asset: Asset;
  api: Api;
  onResolved: () => void;
  onError: (cause: unknown) => void;
}) {
  const [resolving, setResolving] = useState(false);
  const base = Math.min(...rows.map((row) => depthOf(row.path)));
  const here = rows.find((row) => row.asset_id === asset.id);
  /* A session resolves a name from the nearest active unit at or above it, so
     the winner for this unit is the deepest active row on its own path. */
  const chain = here
    ? rows.filter((row) => row.path === here.path || here.path.startsWith(`${row.path}.`))
    : [];
  const resolved = [...chain].reverse().find((row) => row.status === "active");
  const ancestor = here ? nearestAncestorRow(here, rows) : undefined;
  /* A collision worth opening the editor for: this copy is the one actually
     in use, and something above it is too. Every asset kind may be overridden
     — a connection included, since it names a credential rather than being
     one, and `asset_scopes.key_ref` keeps the credential the owner's
     (docs/scoping.md §5.5). */
  const canResolve =
    Boolean(here) && here?.asset_id === resolved?.asset_id && Boolean(ancestor?.version_id);

  return (
    <>
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
                  {isHere && canResolve && (
                    <Button size="sm" onClick={() => setResolving(true)}>
                      Resolve
                    </Button>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {resolving && here && ancestor && (
        <AssetConflict
          name={asset.name}
          myAssetId={asset.id}
          mine={here}
          theirs={ancestor}
          api={api}
          onClose={() => setResolving(false)}
          onError={onError}
          onResolved={() => {
            setResolving(false);
            onResolved();
          }}
        />
      )}
    </>
  );
}

/**
 * Which harnesses contain this asset's name.
 *
 * Harnesses hold names, so this is the same list the harness screen writes,
 * from the other side — and a version someone pushes of their own stays in
 * whatever harnesses named it.
 */
function Harnesses({
  asset,
  api,
  busy,
  onSet,
  onError,
}: {
  asset: Asset;
  api: Api;
  busy: boolean;
  onSet: (harnessIds: string[]) => void;
  onError: (cause: unknown) => void;
}) {
  const [harnesses, setHarnesses] = useState<Harness[]>();
  const unit = asset.org_unit_id;
  const chosen = asset.harness_ids ?? [];

  useEffect(() => {
    if (!unit) return;
    api<unknown>(`/v1/org-units/${encodeURIComponent(unit)}/harnesses`)
      .then((value) => setHarnesses(list<Harness>(value)))
      .catch(onError);
  }, [api, unit, onError]);

  return (
    <section className="rounded-lg border border-line bg-sunken p-4">
      <Heading>Harnesses</Heading>
      <p className="pb-3 text-[13px] leading-relaxed text-muted">
        {chosen.length
          ? "Sessions in these harnesses load it. Sessions in any other do not."
          : "No harness loads this yet. Tick one, or it reaches only sessions with no harness selected."}
      </p>
      {harnesses === undefined ? (
        <Mono>loading…</Mono>
      ) : harnesses.length === 0 ? (
        <Mono>no harnesses reach this org unit</Mono>
      ) : (
        <div className="grid gap-1.5">
          {harnesses.map((harness) => (
            <label key={harness.id} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={chosen.includes(harness.id)}
                disabled={busy}
                onChange={(event) =>
                  onSet(
                    event.target.checked
                      ? [...chosen, harness.id]
                      : chosen.filter((id) => id !== harness.id),
                  )
                }
              />
              <span className="truncate">{harness.name}</span>
              <Mono title={harness.org_unit_path}>{harness.org_unit_path.split(".").pop()}</Mono>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

export function AssetManage({
  asset,
  unit,
  api,
  units,
  onChanged,
  onError,
}: {
  asset: Asset;
  unit: TreeNode;
  api: Api;
  units: { node: TreeNode; trail: TreeNode[] }[];
  onChanged: () => void;
  onError: (cause: unknown) => void;
}) {
  const [rows, setRows] = useState<LineageRow[]>();
  const [busy, setBusy] = useState(false);
  const disabled = asset.status !== "active";
  const inherited = asset.org_unit_id !== unit.id;
  const owner = asset.org_unit_path?.split(".").pop();

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
        {inherited && (
          <div className="pb-3">
            <Notice>
              This {asset.kind?.replace("_", " ") ?? "asset"} belongs to {owner}. Changing it
              changes it for everyone there.
            </Notice>
          </div>
        )}
        <Heading>Where this name resolves</Heading>
        {rows === undefined ? (
          <EmptyState>Loading…</EmptyState>
        ) : rows.length ? (
          <Lineage
            rows={rows}
            asset={asset}
            api={api}
            onError={onError}
            onResolved={() => {
              onChanged();
              loadLineage();
            }}
          />
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

        <Harnesses
          asset={asset}
          api={api}
          busy={busy}
          onSet={(harnessIds) => void mutate("/harnesses", "PUT", { harness_ids: harnessIds })}
          onError={onError}
        />

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
