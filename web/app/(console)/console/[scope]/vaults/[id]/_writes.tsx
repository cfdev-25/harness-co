"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { VAULTS, VAULTS_TEXT } from "@/content/screens/vaults";
import { Button } from "../../../../ui/button";
import { Card } from "../../../../ui/card";
import { Confirm } from "../../../../ui/confirm";
import { Field } from "../../../../ui/field";
import { Modal } from "../../../../ui/modal";
import { Notice } from "../../../../ui/notice";

export interface VaultWritesProps {
  vaultId: string;
  bundled: boolean;
}

/**
 * PRD §6.2: we never write to a customer's vault, so on one the paste and
 * rotate verbs are **absent** and the card links out instead — not a disabled
 * button, and not a control that changes nothing there (P6).
 */
export function VaultWrites({ vaultId, bundled }: VaultWritesProps) {
  const router = useRouter();
  const [pasting, setPasting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [form, setForm] = useState({ ref: "", value: "" });

  async function call(path: `/v1/${string}`, body: unknown, method: string) {
    setBusy(true);
    setFailure(null);
    try {
      await request(path, await getToken(), { method, body: body ? JSON.stringify(body) : undefined });
      setPasting(false);
      setDisconnecting(false);
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        {bundled ? (
          <Button variant="primary" explain={VAULTS.verbs.pasteKey.explain} onClick={() => setPasting(true)}>
            {VAULTS.verbs.pasteKey.label}
          </Button>
        ) : (
          <Button href={`https://${vaultId}`} variant="default">
            {VAULTS_TEXT.linkOut}
          </Button>
        )}
        <Button variant="danger" explain={VAULTS.verbs.disconnect.explain} onClick={() => setDisconnecting(true)}>
          {VAULTS.verbs.disconnect.label}
        </Button>
      </div>
      {failure && <div className="pt-3"><Notice tone="warn">{failure}</Notice></div>}
      {pasting && (
        <Modal title={VAULTS.verbs.pasteKey.label} onClose={() => setPasting(false)}>
          <div className="grid gap-4">
            <Field
              label={VAULTS.columns.secret.heading}
              value={form.ref}
              onChange={(event) => setForm({ ...form, ref: event.target.value })}
            />
            <Field
              label={VAULTS.verbs.pasteKey.label}
              type="password"
              value={form.value}
              onChange={(event) => setForm({ ...form, value: event.target.value })}
            />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setPasting(false)}>{VAULTS_TEXT.cancel}</Button>
              <Button
                variant="primary"
                busy={busy}
                onClick={() => void call(`/v1/vaults/${vaultId}/secrets`, form, "POST")}
              >
                {VAULTS.verbs.pasteKey.label}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {disconnecting && (
        <Confirm
          title={VAULTS_TEXT.disconnectTitle}
          takes={<p>{VAULTS.verbs.disconnect.explain}</p>}
          verb={VAULTS_TEXT.disconnectVerb}
          cancel={VAULTS_TEXT.cancel}
          busy={busy}
          onConfirm={() => void call(`/v1/vaults/${vaultId}`, null, "DELETE")}
          onClose={() => setDisconnecting(false)}
        />
      )}
    </Card>
  );
}
