"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import type { GroupEntry } from "@/lib/views/groups";
import { fill } from "@/lib/views/refusals";
import { GROUPS, GROUPS_TEXT } from "@/content/screens/groups";
import { Button } from "../../../../ui/button";
import { Confirm } from "../../../../ui/confirm";
import { Field } from "../../../../ui/field";
import { Modal } from "../../../../ui/modal";
import { Notice } from "../../../../ui/notice";
import { Select } from "../../../../ui/select";

/**
 * *Add an entry* and *Remove* — 04 §8. Both are one write:
 * `PATCH /v1/groups/{name} { entries }` replaces the whole list, so each hands
 * back the held entries verbatim with one added or one taken out (03 §4.5).
 */
function usePatch(name: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function patch(entries: GroupEntry[], done: () => void) {
    setBusy(true);
    setFailure(null);
    try {
      await request(`/v1/groups/${encodeURIComponent(name)}`, await getToken(), {
        method: "PATCH",
        body: JSON.stringify({ entries }),
      });
      done();
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return { busy, failure, patch };
}

/** `writes.validate_group`: an entry names *the origin* it is used at. A path
 *  is refused here rather than sent, and the origin is what goes on the wire. */
function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch {
    return null;
  }
}

export interface AddEntryProps {
  name: string;
  entries: GroupEntry[];
  /** `GET /v1/console/vaults` — the vaults an entry may name, fetched by the
   *  page so this component does not. */
  vaults: string[];
}

export function AddEntry({ name, entries, vaults }: AddEntryProps) {
  const { busy, failure, patch } = usePatch(name);
  const [open, setOpen] = useState(false);
  const [upstreamError, setUpstreamError] = useState<string | null>(null);
  const [form, setForm] = useState({
    alias: "",
    vault: vaults.find((id) => id === "bundled") ?? vaults[0] ?? "",
    ref: "",
    upstream: "",
    header: "Authorization",
    prefix: "Bearer ",
  });

  function submit() {
    const upstream = originOf(form.upstream);
    if (upstream === null) {
      setUpstreamError(GROUPS_TEXT.addEntryUpstreamOrigin);
      return;
    }
    setUpstreamError(null);
    const entry = {
      alias: form.alias,
      secret: { vault: form.vault, ref: form.ref },
      upstream,
      attach: { header: form.header, prefix: form.prefix },
    };
    void patch([...entries, entry], () => setOpen(false));
  }

  return (
    <>
      <Button variant="primary" explain={GROUPS.verbs.addEntry.explain} onClick={() => setOpen(true)}>
        {GROUPS.verbs.addEntry.label}
      </Button>
      {open && (
        <Modal title={GROUPS_TEXT.addEntryTitle} onClose={() => setOpen(false)}>
          <div className="grid gap-4">
            <Field
              label={GROUPS_TEXT.addEntryAlias}
              value={form.alias}
              onChange={(event) => setForm({ ...form, alias: event.target.value })}
            />
            <Select
              label={GROUPS_TEXT.addEntryVault}
              value={form.vault}
              onChange={(event) => setForm({ ...form, vault: event.target.value })}
            >
              {vaults.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </Select>
            <Field
              id="ref"
              label={GROUPS_TEXT.addEntryRef}
              hint={GROUPS_TEXT.addEntryRefHint}
              value={form.ref}
              onChange={(event) => setForm({ ...form, ref: event.target.value })}
            />
            <Field
              id="upstream"
              label={GROUPS_TEXT.addEntryUpstream}
              hint={GROUPS_TEXT.addEntryUpstreamHint}
              error={upstreamError ?? undefined}
              value={form.upstream}
              onChange={(event) => setForm({ ...form, upstream: event.target.value })}
            />
            <Field
              label={GROUPS_TEXT.addEntryHeader}
              value={form.header}
              onChange={(event) => setForm({ ...form, header: event.target.value })}
            />
            <Field
              label={GROUPS_TEXT.addEntryPrefix}
              value={form.prefix}
              onChange={(event) => setForm({ ...form, prefix: event.target.value })}
            />
            {failure && <Notice tone="warn">{failure}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{GROUPS_TEXT.cancel}</Button>
              <Button variant="primary" busy={busy} onClick={submit}>
                {GROUPS_TEXT.addEntrySubmit}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export interface RemoveEntryProps {
  name: string;
  entries: GroupEntry[];
  index: number;
  alias: string;
}

export function RemoveEntry({ name, entries, index, alias }: RemoveEntryProps) {
  const { busy, failure, patch } = usePatch(name);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant="danger"
        explain={GROUPS.verbs.removeEntry.explain}
        onClick={() => setConfirming(true)}
      >
        {GROUPS.verbs.removeEntry.label}
      </Button>
      {failure && <Notice tone="warn">{failure}</Notice>}
      {confirming && (
        <Confirm
          title={fill(GROUPS_TEXT.removeEntryTitle, { alias })}
          takes={<p>{fill(GROUPS_TEXT.removeEntryTakes, { alias })}</p>}
          verb={GROUPS.verbs.removeEntry.label}
          cancel={GROUPS_TEXT.cancel}
          busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() =>
            void patch(
              entries.filter((_, position) => position !== index),
              () => setConfirming(false),
            )
          }
        />
      )}
    </>
  );
}
