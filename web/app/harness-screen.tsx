"use client";

/* One harness: everything that could be in it, ticked where it is. A harness
   starts empty and holds only what someone puts in it, so this is one list
   rather than a "contents" list and an "add" list. */

import { useCallback, useEffect, useState } from "react";
import { Api, Harness, HarnessAssetRow, HarnessDetail, TreeNode } from "@/lib/types";
import { HarnessDialog } from "./harness-tiles";
import { PixelArt } from "./pixel-editor";
import { Badge, Button, EmptyState, KindTag, Mono, Notice } from "./ui";

function Heading({ children }: { children: string }) {
  return (
    <h2 className="pb-2 text-[11px] font-bold tracking-[0.1em] text-muted uppercase">{children}</h2>
  );
}

export function HarnessScreen({
  harness,
  unit,
  api,
  onChanged,
  onClosed,
  onError,
}: {
  harness: Harness;
  unit: TreeNode;
  api: Api;
  onChanged: () => void;
  onClosed: () => void;
  onError: (cause: unknown) => void;
}) {
  const [detail, setDetail] = useState<HarnessDetail>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<HarnessDetail>(`/v1/harnesses/${encodeURIComponent(harness.id)}`)
      .then(setDetail)
      .catch(onError);
  }, [api, harness.id, onError]);

  useEffect(load, [load]);

  /* The whole list is sent every time. A harness's contents are a set, and
     replacing it outright is one request with no ordering to get wrong. */
  async function save(rows: HarnessAssetRow[]) {
    setBusy(true);
    try {
      await api(`/v1/harnesses/${encodeURIComponent(harness.id)}/assets`, {
        method: "PUT",
        body: JSON.stringify({
          assets: rows
            .filter((row) => row.assigned)
            .map((row) => ({ kind: row.kind, name: row.name })),
        }),
      });
      load();
      onChanged();
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  }

  function toggle(row: HarnessAssetRow) {
    if (!detail) return;
    void save(
      detail.assets.map((item) =>
        item.kind === row.kind && item.name === row.name
          ? { ...item, assigned: !item.assigned }
          : item,
      ),
    );
  }

  function setAll(assigned: boolean) {
    if (!detail) return;
    void save(detail.assets.map((item) => ({ ...item, assigned })));
  }

  async function remove() {
    const held = detail?.assets.filter((row) => row.assigned).length ?? 0;
    const message =
      `Delete the harness “${harness.name}”?\n\n` +
      (held
        ? `${held} ${held === 1 ? "thing is" : "things are"} in it. Nothing is deleted — they ` +
          "stay where they are and keep their history; they just will not be in this harness."
        : "It is empty.");
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      await api(`/v1/harnesses/${encodeURIComponent(harness.id)}`, { method: "DELETE" });
      onClosed();
      onChanged();
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  }

  const rows = detail?.assets ?? [];
  const held = rows.filter((row) => row.assigned).length;
  const kinds = [...new Set(rows.map((row) => row.kind))].sort();
  const mine = harness.org_unit_id === unit.id;

  return (
    <div className="grid gap-6 pt-5 pb-4">
      <header className="flex flex-wrap items-start gap-4">
        <PixelArt icon={harness.icon} size={88} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[19px] font-bold tracking-[-0.02em]">{harness.name}</h1>
            <Mono title={harness.org_unit_path}>{harness.org_unit_path}</Mono>
          </div>
          <p className="mt-1.5 max-w-[46rem] text-[13px] leading-relaxed text-muted">
            {harness.description || "No description yet."}
          </p>
        </div>
        <span className="flex gap-2">
          <Button size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void remove()}>
            Delete
          </Button>
        </span>
      </header>

      <section className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-3 pb-1">
          <Heading>What is in this harness</Heading>
          <span className="flex items-center gap-3">
            <Mono>
              {held} of {rows.length}
            </Mono>
            <Button size="sm" disabled={busy || !rows.length} onClick={() => setAll(true)}>
              Add all
            </Button>
            <Button size="sm" disabled={busy || !held} onClick={() => setAll(false)}>
              Empty it
            </Button>
          </span>
        </div>

        {!mine && (
          <div className="pb-3">
            <Notice>
              This harness belongs to {harness.org_unit_path.split(".").pop()}. Changing it changes
              it for everyone there.
            </Notice>
          </div>
        )}

        {detail === undefined ? (
          <EmptyState>Loading…</EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState>
            Nothing is published at this org unit yet, so there is nothing to put in a harness.
          </EmptyState>
        ) : (
          <div className="grid gap-4">
            {kinds.map((kind) => (
              <div key={kind}>
                <div className="pb-1.5">
                  <KindTag kind={kind} />
                </div>
                <ul className="m-0 grid list-none gap-1 p-0">
                  {rows
                    .filter((row) => row.kind === kind)
                    .map((row) => (
                      <li
                        key={`${row.kind}/${row.name}`}
                        className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 ${
                          row.assigned ? "border-accent/40 bg-accent-soft/30" : "border-line bg-surface"
                        }`}
                      >
                        <label className="flex min-w-0 items-center gap-2.5 text-[13px] font-semibold">
                          <input
                            type="checkbox"
                            className="size-4 accent-accent"
                            checked={row.assigned}
                            disabled={busy}
                            onChange={() => toggle(row)}
                          />
                          <span className="truncate">{row.name}</span>
                        </label>
                        {row.org_unit_path && row.org_unit_path !== harness.org_unit_path && (
                          <Mono title={row.org_unit_path}>
                            from {row.org_unit_path.split(".").pop()}
                          </Mono>
                        )}
                        {!row.asset_id && (
                          <span className="ml-auto">
                            <Badge tone="warn">nothing here by that name</Badge>
                          </span>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {editing && (
        <HarnessDialog
          harness={harness}
          unit={unit}
          api={api}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
            onChanged();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}
