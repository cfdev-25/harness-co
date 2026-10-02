"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { VAULTS, VAULTS_TEXT, VAULT_CONNECT } from "@/content/screens/vaults";
import { Button } from "../../../ui/button";
import { Checkbox } from "../../../ui/checkbox";
import { Field } from "../../../ui/field";
import { Modal } from "../../../ui/modal";
import { Notice } from "../../../ui/notice";
import { Select } from "../../../ui/select";

/** `POST /v1/vaults` (00 §4.11). The list permission is requested with what it
 *  buys stated beside it (04 §11), never as a bare checkbox. */
export function ConnectVault() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [form, setForm] = useState({ id: "", provider: "aws", auth: "", listsSecrets: true });

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      await request("/v1/vaults", await getToken(), {
        method: "POST",
        // `VaultIn`: the id names the vault a group points at, and `auth` is a
        // block, not a line. Nothing reads it yet — 11 §5–§9 give each
        // provider its own fields, and that form is theirs to bring.
        body: JSON.stringify({
          id: form.id,
          provider: form.provider,
          auth: { method: form.auth },
          lists_secrets: form.listsSecrets,
        }),
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
      <Button variant="primary" explain={VAULTS.verbs.connectVault.explain} onClick={() => setOpen(true)}>
        {VAULTS.verbs.connectVault.label}
      </Button>
      {open && (
        <Modal title={VAULT_CONNECT.title} onClose={() => setOpen(false)}>
          <div className="grid gap-4">
            <Field
              label={VAULT_CONNECT.id}
              hint={VAULT_CONNECT.idHint}
              value={form.id}
              onChange={(event) => setForm({ ...form, id: event.target.value })}
            />
            <Select
              label={VAULT_CONNECT.provider}
              value={form.provider}
              onChange={(event) => setForm({ ...form, provider: event.target.value })}
            >
              {VAULT_CONNECT.providers.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </Select>
            <Field
              label={VAULT_CONNECT.auth}
              value={form.auth}
              onChange={(event) => setForm({ ...form, auth: event.target.value })}
            />
            <Checkbox
              label={VAULT_CONNECT.listPermission}
              hint={VAULT_CONNECT.listPermissionHint}
              checked={form.listsSecrets}
              onChange={(event) => setForm({ ...form, listsSecrets: event.target.checked })}
            />
            {failure && <Notice tone="warn">{failure}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{VAULTS_TEXT.cancel}</Button>
              <Button variant="primary" busy={busy} onClick={() => void submit()}>
                {VAULT_CONNECT.submit}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
