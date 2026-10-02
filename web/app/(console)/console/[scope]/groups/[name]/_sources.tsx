"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { GROUPS, GROUPS_TEXT } from "@/content/screens/groups";
import { Button } from "../../../../ui/button";
import { Modal } from "../../../../ui/modal";
import { Notice } from "../../../../ui/notice";
import { Select } from "../../../../ui/select";

export interface ChangeSourcesProps {
  name: string;
  sources: string;
}

/** `PATCH /v1/groups/{name}` (00 §4.11) — D41's one rule with two values. The
 *  group's name is its key, so it is never part of the body. */
export function ChangeSources({ name, sources }: ChangeSourcesProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [chosen, setChosen] = useState(sources);

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      await request(`/v1/groups/${encodeURIComponent(name)}`, await getToken(), {
        method: "PATCH",
        body: JSON.stringify({ sources: chosen }),
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
      <Button explain={GROUPS.verbs.changeSources.explain} onClick={() => setOpen(true)}>
        {GROUPS.verbs.changeSources.label}
      </Button>
      {open && (
        <Modal title={GROUPS.verbs.changeSources.label} onClose={() => setOpen(false)}>
          <div className="grid gap-4">
            <Select
              label={GROUPS_TEXT.createGroupSources}
              hint={GROUPS.columns.sources.help}
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
            >
              <option value="vault">{GROUPS_TEXT.sourcesVaultOnly}</option>
              <option value="vault-or-local">{GROUPS_TEXT.sourcesVaultOrLocal}</option>
            </Select>
            {failure && <Notice tone="warn">{failure}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{GROUPS_TEXT.cancel}</Button>
              <Button variant="primary" busy={busy} onClick={() => void submit()}>
                {GROUPS.verbs.changeSources.label}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
