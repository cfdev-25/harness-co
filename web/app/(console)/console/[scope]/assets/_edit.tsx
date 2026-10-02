"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { type LoadsState, type OrgAssetRow, description, loadsValue } from "@/lib/views/assets";
import { ASSETS_TEXT } from "@/content/screens/assets";
import { Confirm } from "../../../ui/confirm";

export interface Draft {
  id: string;
  name: string;
  description: string;
  loads: LoadsState;
}

export interface Failure {
  /** Which cell the server refused: the words (name, description) or loads. */
  at: "words" | "loads";
  message: string;
  remedy?: string;
}

/**
 * One row edited in place (console D109). Edit turns the row's Name,
 * Description and Loads cells into controls; Save sends only what changed —
 * `PATCH /v1/assets/{id}?scope=` for the words, then `PUT /v1/assets/{id}/loads`
 * — and stops at the first refusal, which is shown under the cell it belongs
 * to in the server's own words (02 rule 21), with the row still being edited.
 * Moving to *required* confirms with what it takes first (02 rule 22), as the
 * asset page's control does. A second Edit replaces the draft: one row at a
 * time.
 */
export function useAssetEdit(scope: string) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  /** What the row said when Edit was pressed, so only a change is sent. */
  const [was, setWas] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [confirming, setConfirming] = useState(false);

  function start(row: OrgAssetRow) {
    const current = { id: row.id, name: row.name, description: description(row), loads: loadsValue(row) };
    setWas(current);
    setDraft(current);
    setFailure(null);
  }

  function cancel() {
    setDraft(null);
    setWas(null);
    setFailure(null);
    setConfirming(false);
  }

  function set(change: Partial<Omit<Draft, "id">>) {
    setDraft((current) => (current ? { ...current, ...change } : current));
  }

  function save() {
    if (!draft || !was) return;
    if (draft.loads === "required" && was.loads !== "required") setConfirming(true);
    else void commit();
  }

  async function commit() {
    if (!draft || !was) return;
    setBusy(true);
    setFailure(null);
    const words: { name?: string; description?: string } = {};
    if (draft.name !== was.name) words.name = draft.name;
    if (draft.description !== was.description) words.description = draft.description;
    let at: Failure["at"] = "words";
    try {
      const token = await getToken();
      if (Object.keys(words).length > 0) {
        await request(`/v1/assets/${draft.id}?scope=${scope}`, token, {
          method: "PATCH",
          body: JSON.stringify(words),
        });
        // The words are written: a retry after a loads refusal must not send them again.
        setWas({ ...was, name: draft.name, description: draft.description });
      }
      at = "loads";
      if (draft.loads !== was.loads) {
        await request(`/v1/assets/${draft.id}/loads`, token, {
          method: "PUT",
          body: JSON.stringify({ loads: draft.loads }),
        });
      }
      cancel();
      router.refresh();
    } catch (error) {
      const api = error instanceof ApiError ? error : null;
      setFailure({ at, message: api?.message ?? String(error), remedy: api?.remedy });
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const confirm = confirming ? (
    <Confirm
      title={ASSETS_TEXT.confirmTitle}
      takes={<p>{ASSETS_TEXT.confirmTakes}</p>}
      verb={ASSETS_TEXT.confirmVerb}
      cancel={ASSETS_TEXT.cancel}
      busy={busy}
      onConfirm={() => void commit()}
      onClose={() => setConfirming(false)}
    />
  ) : null;

  return { draft, busy, failure, start, cancel, set, save, confirm };
}

/** The refusal as one line under the control, remedy included (02 rule 21). */
export function said(failure: Failure | null, at: Failure["at"]): string | undefined {
  if (!failure || failure.at !== at) return undefined;
  return failure.remedy ? `${failure.message} ${failure.remedy}` : failure.message;
}
