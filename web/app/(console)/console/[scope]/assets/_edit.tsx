"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { ASSETS, ASSETS_TEXT } from "@/content/screens/assets";
import { Button } from "../../../ui/button";
import { Field } from "../../../ui/field";
import { Modal } from "../../../ui/modal";
import { Notice } from "../../../ui/notice";
import { Textarea } from "../../../ui/textarea";

export interface EditAssetProps {
  assetId: string;
  name: string;
  description: string;
  /** The `?scope=` the write takes — `org`, `team:<path>` or `me` (03 §4):
   *  the node whose copy is being changed, not the URL's segment. */
  scope: string;
}

/**
 * `PATCH /v1/assets/{id}?scope=` (WS3a) — the row's Edit. It opens in the
 * library's dialog (01 §7.10); there is no drawer component and this task
 * did not add one. Only the fields that changed are sent, because a body
 * carrying an unchanged description would still write a commit.
 */
export function EditAsset({ assetId, name, description, scope }: EditAssetProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; remedy?: string } | null>(null);
  const [draft, setDraft] = useState({ name, description });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const body: { name?: string; description?: string } = {};
    if (draft.name !== name) body.name = draft.name;
    if (draft.description !== description) body.description = draft.description;
    try {
      if (Object.keys(body).length > 0) {
        await request(`/v1/assets/${assetId}?scope=${scope}`, await getToken(), {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      setOpen(false);
      router.refresh();
    } catch (error) {
      const api = error instanceof ApiError ? error : null;
      setFailure({ message: api?.message ?? String(error), remedy: api?.remedy });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" explain={ASSETS.verbs.edit.explain} onClick={() => setOpen(true)}>
        {ASSETS.verbs.edit.label}
      </Button>
      {open && (
        <Modal title={ASSETS_TEXT.editTitle} onClose={() => setOpen(false)}>
          <form className="grid gap-4" onSubmit={(event) => void save(event)}>
            <Field
              label={ASSETS_TEXT.editName}
              name="name"
              value={draft.name}
              required
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <Textarea
              label={ASSETS_TEXT.editDescription}
              name="description"
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
            {/* 02 rule 21: the server's own words, beside the control. */}
            {failure && (
              <Notice tone="warn">
                <p>{failure.message}</p>
                {failure.remedy && <p className="text-muted">{failure.remedy}</p>}
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{ASSETS_TEXT.cancel}</Button>
              <Button variant="primary" type="submit" busy={busy}>
                {ASSETS_TEXT.editSubmit}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
