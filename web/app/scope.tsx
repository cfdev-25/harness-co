"use client";

/* Who an owned asset reaches beyond its own unit (docs/scoping.md §3, §6,
   §9.3). Every asset starts reaching nobody (§4) — sharing it is the only
   control this file adds, and the only place scope is ever written from.

   `rows` always comes from the caller (`AdminApp` fetches
   `GET /v1/assets/{id}/scopes` once per owned asset when the unit's assets
   load) rather than from a fetch of this component's own: the same map also
   feeds the sub-sidebar's unshared-count marker, so there is exactly one
   place that reads this endpoint, not one per row. */

import { useState } from "react";
import { Api, AssetScopeRow, TreeNode } from "@/lib/types";
import { FlatNode } from "./admin";
import { Badge, Button, Modal, Mono, Notice } from "./ui";

/** Every unit beneath `unitId`, at any depth — a scope target can be a
    grandchild directly (docs/scoping.md §7's Ana, nested under Support). */
function descendantsOf(nodes: FlatNode[], unitId: string): FlatNode[] {
  return nodes.filter(({ trail }) => trail.some((ancestor) => ancestor.id === unitId));
}

function ScopePickerModal({
  assetId,
  assetName,
  ownerUnit,
  nodes,
  rows,
  api,
  onClose,
  onSaved,
  onError,
}: {
  assetId: string;
  assetName: string;
  ownerUnit: TreeNode;
  nodes: FlatNode[];
  rows: AssetScopeRow[];
  api: Api;
  onClose: () => void;
  onSaved: (rows: AssetScopeRow[]) => void;
  onError: (cause: unknown) => void;
}) {
  const descendants = descendantsOf(nodes, ownerUnit.id);
  /* A row naming the owner itself means "this unit and everything beneath
     it" (docs/scoping.md §3) — the same sentinel the §4.1 backfill writes —
     not one row per descendant. Enumerating descendants here would be the
     exact mistake that section warns against: it would miss every unit
     created after this click. */
  const everyoneRow = rows.find((row) => row.org_unit_id === ownerUnit.id);
  const [chosen, setChosen] = useState<Set<string>>(
    new Set(rows.filter((row) => row.org_unit_id !== ownerUnit.id).map((row) => row.org_unit_id)),
  );
  const [busy, setBusy] = useState(false);

  function keyRefFor(unitId: string): string | null {
    return rows.find((row) => row.org_unit_id === unitId)?.key_ref ?? null;
  }

  async function save(scopes: { org_unit_id: string; key_ref: string | null }[]) {
    setBusy(true);
    try {
      const saved = await api<AssetScopeRow[]>(
        `/v1/assets/${encodeURIComponent(assetId)}/scopes`,
        { method: "PUT", body: JSON.stringify({ scopes }) },
      );
      onSaved(saved);
    } catch (cause) {
      onError(cause);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Share ${assetName}`} onClose={onClose}>
      <div className="grid gap-4 p-5">
        <Notice tone={rows.length ? "ok" : "warn"}>
          {everyoneRow
            ? "Shared with everyone here — every team and person under this unit, including ones added later."
            : rows.length
              ? `Shared with ${rows.length} ${rows.length === 1 ? "team" : "teams"} below.`
              : "Not shared yet. Nobody below this unit can use it."}
        </Notice>

        {/* Leads with the one-click answer: the default costs most where it
            helps least, a team sharing with its own people. */}
        <Button
          variant="primary"
          full
          disabled={busy}
          onClick={() =>
            void save([{ org_unit_id: ownerUnit.id, key_ref: keyRefFor(ownerUnit.id) }])
          }
        >
          Share with everyone here
        </Button>

        {descendants.length > 0 && (
          <div className="border-t border-line pt-4">
            <p className="pb-2 text-[11px] font-bold tracking-[0.09em] text-muted uppercase">
              Or choose specific teams
            </p>
            <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border border-line bg-sunken p-2">
              {descendants.map(({ node, trail }) => (
                <label
                  key={node.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-accent"
                    checked={chosen.has(node.id)}
                    disabled={busy}
                    onChange={(event) => {
                      const next = new Set(chosen);
                      if (event.target.checked) next.add(node.id);
                      else next.delete(node.id);
                      setChosen(next);
                    }}
                  />
                  <span className="truncate">
                    {[...trail, node].map((entry) => entry.name).join(" / ")}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void save(
                    [...chosen].map((id) => ({ org_unit_id: id, key_ref: keyRefFor(id) })),
                  )
                }
              >
                Save selection
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** The "shared with" cell: a badge that is also the only control an owned
    row gets (docs/scoping.md §6). An inherited or below row never renders
    this — the caller shows its owning path instead and offers nothing here,
    because re-scoping downward is a separate act on this unit's own grant,
    never an edit of an ancestor's. */
export function ScopeCell({
  assetId,
  assetName,
  ownerUnit,
  nodes,
  rows,
  api,
  onSaved,
  onError,
}: {
  assetId: string;
  assetName: string;
  ownerUnit: TreeNode;
  nodes: FlatNode[];
  /** Undefined while the owning fetch (in `AdminApp`) has not reached this
      asset yet. */
  rows?: AssetScopeRow[];
  api: Api;
  onSaved: (rows: AssetScopeRow[]) => void;
  onError: (cause: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const everyone = rows?.some((row) => row.org_unit_id === ownerUnit.id) ?? false;

  return (
    <>
      <Button
        variant="bare"
        size="none"
        disabled={rows === undefined}
        onClick={() => setOpen(true)}
      >
        {rows === undefined ? (
          <Mono>…</Mono>
        ) : everyone ? (
          <Badge tone="ok">everyone here</Badge>
        ) : rows.length ? (
          <Badge tone="ok">
            {rows.length} {rows.length === 1 ? "unit" : "units"}
          </Badge>
        ) : (
          // The important state (docs/scoping.md §4): unfinished work, not a
          // neutral fact, so it gets the same tone a disabled asset does.
          <Badge tone="warn">Not shared yet</Badge>
        )}
      </Button>
      {open && rows !== undefined && (
        <ScopePickerModal
          assetId={assetId}
          assetName={assetName}
          ownerUnit={ownerUnit}
          nodes={nodes}
          rows={rows}
          api={api}
          onClose={() => setOpen(false)}
          onSaved={(saved) => {
            setOpen(false);
            onSaved(saved);
          }}
          onError={onError}
        />
      )}
    </>
  );
}
