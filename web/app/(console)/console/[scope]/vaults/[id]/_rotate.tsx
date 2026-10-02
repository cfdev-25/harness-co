"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { fill } from "@/lib/views/refusals";
import { VAULTS, VAULTS_TEXT } from "@/content/screens/vaults";
import { Button } from "../../../../ui/button";
import { Field } from "../../../../ui/field";
import { Modal } from "../../../../ui/modal";
import { Notice } from "../../../../ui/notice";

export interface RotateSecretProps {
  vaultId: string;
  secretRef: string;
}

/** `POST /v1/vaults/{id}/secrets/{ref}/rotate` (04 §11) — the bundled vault's
 *  row verb. A customer's vault never renders it: we do not write there. */
export function RotateSecret({ vaultId, secretRef }: RotateSecretProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [value, setValue] = useState("");

  async function rotate() {
    setBusy(true);
    setFailure(null);
    try {
      await request(
        `/v1/vaults/${vaultId}/secrets/${secretRef}/rotate`,
        await getToken(),
        { method: "POST", body: JSON.stringify({ value }) },
      );
      setOpen(false);
      setValue("");
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" explain={VAULTS.verbs.rotate.explain} onClick={() => setOpen(true)}>
        {VAULTS.verbs.rotate.label}
      </Button>
      {open && (
        <Modal title={fill(VAULTS_TEXT.rotateTitle, { ref: secretRef })} onClose={() => setOpen(false)}>
          <div className="grid gap-4">
            <Field
              label={VAULTS_TEXT.rotateValue}
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {failure && <Notice tone="warn">{failure}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{VAULTS_TEXT.cancel}</Button>
              <Button variant="primary" busy={busy} onClick={() => void rotate()}>
                {VAULTS.verbs.rotate.label}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
