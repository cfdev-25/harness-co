"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { GROUPS, GROUPS_TEXT } from "@/content/screens/groups";
import { Button } from "../../../ui/button";
import { Field } from "../../../ui/field";
import { Modal } from "../../../ui/modal";
import { Notice } from "../../../ui/notice";
import { Select } from "../../../ui/select";

/**
 * `POST /v1/groups` (00 §4.11) — an organisation admin's verb, because a group
 * names a secret and who may mint it (PRD §6.3). A group is a named set, so
 * it starts with none: `entries` is sent as the empty list `GroupIn` requires
 * and the first entry comes after, with `PATCH /v1/groups/{name}` (04 §8).
 */
export function CreateGroup() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", sources: "vault" });

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      await request("/v1/groups", await getToken(), {
        method: "POST",
        body: JSON.stringify({ ...form, entries: [] }),
      });
      setOpen(false);
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" explain={GROUPS.verbs.createGroup.explain} onClick={() => setOpen(true)}>
        {GROUPS.verbs.createGroup.label}
      </Button>
      {open && (
        <Modal title={GROUPS_TEXT.createGroupTitle} onClose={() => setOpen(false)}>
          <div className="grid gap-4">
            <Field
              label={GROUPS_TEXT.createGroupName}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <Select
              label={GROUPS_TEXT.createGroupSources}
              hint={GROUPS.columns.sources.help}
              value={form.sources}
              onChange={(event) => setForm({ ...form, sources: event.target.value })}
            >
              <option value="vault">{GROUPS_TEXT.sourcesVaultOnly}</option>
              <option value="vault-or-local">{GROUPS_TEXT.sourcesVaultOrLocal}</option>
            </Select>
            {failure && <Notice tone="warn">{failure}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{GROUPS_TEXT.cancel}</Button>
              <Button variant="primary" busy={busy} onClick={() => void submit()}>
                {GROUPS_TEXT.createGroupSubmit}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
