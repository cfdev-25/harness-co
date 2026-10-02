"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { fill } from "@/lib/views/refusals";
import type { ModelProviderRow } from "@/lib/views/providers";
import { PROVIDERS, PROVIDERS_TEXT } from "@/content/screens/providers";
import { Button } from "../../../../ui/button";
import { Field } from "../../../../ui/field";
import { Modal } from "../../../../ui/modal";
import { Notice } from "../../../../ui/notice";

/**
 * 04 §10: a model provider row without a credential carries one verb. The
 * modal has two fields and `POST /v1/providers/model/{id}/setup` does the rest
 * in one write — the vault entry, the group, its grant to every team and the
 * organisation-wide default. The screens that show what it did are Groups and
 * Routing, so those three words are not in here. The one fact the response
 * carries that the row cannot — whether this key became the default — is
 * handed up: this button is gone by the time the refresh lands.
 */
export function SetUp({ row, onDone }: { row: ModelProviderRow; onDone: (said: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const result = await request<{ default?: boolean }>(
        `/v1/providers/model/${encodeURIComponent(row.id)}/setup`,
        await getToken(),
        { method: "POST", body: JSON.stringify({ key, model: model || undefined }) },
      );
      setOpen(false);
      setKey("");
      setModel("");
      onDone(result.default ? PROVIDERS_TEXT.setUpDoneDefault : PROVIDERS_TEXT.setUpDone);
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid justify-items-start gap-2">
      <Button variant="primary" size="sm" explain={PROVIDERS.verbs.setUp.explain} onClick={() => setOpen(true)}>
        {PROVIDERS.verbs.setUp.label}
      </Button>
      {open && (
        <Modal title={fill(PROVIDERS_TEXT.setUpTitle, { provider: row.id })} onClose={() => setOpen(false)}>
          <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            <Field
              label={PROVIDERS_TEXT.setUpKey}
              name="key"
              type="password"
              hint={PROVIDERS_TEXT.setUpKeyHint}
              value={key}
              required
              onChange={(event) => setKey(event.target.value)}
            />
            <Field
              label={PROVIDERS_TEXT.setUpModel}
              name="model"
              placeholder={row.models[0] ?? undefined}
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
            {failure && <Notice tone="warn">{failure}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{PROVIDERS_TEXT.cancel}</Button>
              <Button variant="primary" type="submit" busy={busy}>
                {PROVIDERS_TEXT.setUpSubmit}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
