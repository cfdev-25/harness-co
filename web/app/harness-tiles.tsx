"use client";

/* The first tab: every harness this unit can work in, as tiles. Unlike the
   asset tabs this shows inherited rows too, because "which harnesses can we
   use" is the question the tab exists to answer. */

import { FormEvent, useState } from "react";
import { Api, Harness, PixelIcon, TreeNode } from "@/lib/types";
import { blankIcon, PixelArt, PixelEditor } from "./pixel-editor";
import { Badge, Button, EmptyState, Field, Modal, Mono, Notice, Toolbar } from "./ui";

/** Create and edit are the same three fields, so they are the same dialog. */
export function HarnessDialog({
  harness,
  unit,
  api,
  onClose,
  onSaved,
  onError,
}: {
  harness?: Harness;
  unit: TreeNode;
  api: Api;
  onClose: () => void;
  onSaved: (harness: Harness) => void;
  onError: (cause: unknown) => void;
}) {
  const [icon, setIcon] = useState<PixelIcon>(harness?.icon ?? blankIcon());
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get("name") ?? "").trim(),
      description: String(form.get("description") ?? ""),
      icon,
    };
    setBusy(true);
    try {
      const saved = harness
        ? await api<Harness>(`/v1/harnesses/${encodeURIComponent(harness.id)}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          })
        : await api<Harness>("/v1/harnesses", {
            method: "POST",
            body: JSON.stringify({ ...body, org_unit_id: unit.id }),
          });
      onSaved(saved);
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={harness ? `Edit ${harness.name}` : "New harness"} onClose={onClose}>
      <form className="grid gap-4 p-5" onSubmit={submit}>
        {!harness && (
          <Notice tone="accent">
            It starts empty. Once it exists you choose what goes in, from anything{" "}
            <strong className="font-semibold text-fg">{unit.name}</strong> has.
          </Notice>
        )}
        <Field
          label="Name"
          name="name"
          required
          maxLength={60}
          autoFocus
          defaultValue={harness?.name}
          placeholder="Support"
        />
        <Field
          label="What it is for"
          name="description"
          maxLength={2000}
          defaultValue={harness?.description}
          placeholder="Front line customer questions."
        />
        <Field label="Drawing">
          <PixelEditor value={icon} onChange={setIcon} />
        </Field>
        <div className="mt-1 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {harness ? "Save" : "Create harness"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function HarnessTiles({
  harnesses,
  unit,
  query,
  onOpen,
  onCreate,
}: {
  harnesses: Harness[];
  unit: TreeNode;
  query: string;
  onOpen: (harness: Harness) => void;
  onCreate: () => void;
}) {
  const needle = query.trim().toLowerCase();
  const shown = harnesses.filter(
    (harness) =>
      !needle ||
      harness.name.toLowerCase().includes(needle) ||
      harness.description.toLowerCase().includes(needle),
  );
  /* The unit's own first: those are the ones you can change here. */
  const ordered = [...shown].sort((a, b) => {
    const own = Number(b.org_unit_id === unit.id) - Number(a.org_unit_id === unit.id);
    return own || a.name.localeCompare(b.name);
  });

  return (
    <>
      <Toolbar
        count={query ? `${shown.length} / ${harnesses.length}` : String(harnesses.length)}
        actions={
          <Button variant="primary" size="sm" onClick={onCreate}>
            New harness
          </Button>
        }
      />
      {ordered.length ? (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-3 p-0">
          {ordered.map((harness) => (
            <li key={harness.id}>
              <Button
                variant="none"
                size="none"
                full
                className="h-full items-start gap-3.5 rounded-lg border border-line bg-surface p-4 text-left hover:border-accent hover:bg-overlay"
                onClick={() => onOpen(harness)}
              >
                <PixelArt icon={harness.icon} size={56} />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-[14px] font-bold">{harness.name}</strong>
                    {harness.org_unit_id !== unit.id && (
                      <Badge tone="neutral">{harness.org_unit_path.split(".").pop()}</Badge>
                    )}
                  </span>
                  <span className="line-clamp-2 text-[12px] leading-relaxed text-muted">
                    {harness.description || "No description yet."}
                  </span>
                  <Mono>
                    {harness.assigned_assets
                      ? `${harness.assigned_assets} ${harness.assigned_assets === 1 ? "thing" : "things"}`
                      : "empty"}
                  </Mono>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>
          {harnesses.length
            ? `No harnesses match “${query}”.`
            : "No harnesses reach this unit yet."}
        </EmptyState>
      )}
    </>
  );
}
