"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { fill } from "@/lib/views/refusals";
import type { ModelProviderRow } from "@/lib/views/providers";
import { PROVIDERS, PROVIDERS_TEXT } from "@/content/screens/providers";
import { Button } from "../../../../ui/button";
import { Confirm } from "../../../../ui/confirm";
import { Notice } from "../../../../ui/notice";

/**
 * `DELETE /v1/providers/model/{id}?scope=org` (W6-D5). Model providers are a
 * `recommended` default (W6-D1): seeded into every organization and then the
 * organization's, which means every verb exists — including this one, which the
 * defaults checker found missing.
 *
 * The confirm says what the delete takes rather than asking *are you sure*
 * (04 §18); it takes nothing, because the server refuses `provider.in_use`
 * while a routing cell or a security group entry still names the provider, and
 * that refusal is shown here with the names in it.
 */
export function DeleteModelProvider({ row }: { row: ModelProviderRow }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setFailure(null);
    try {
      await request(
        `/v1/providers/model/${encodeURIComponent(row.id)}?scope=org`,
        await getToken(),
        { method: "DELETE" },
      );
      setConfirming(false);
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="danger"
        explain={PROVIDERS.verbs.deleteModelProvider.explain}
        onClick={() => setConfirming(true)}
      >
        {PROVIDERS.verbs.deleteModelProvider.label}
      </Button>
      {failure && <Notice tone="warn">{failure}</Notice>}
      {confirming && (
        <Confirm
          title={fill(PROVIDERS_TEXT.deleteTitle, { provider: row.id })}
          takes={<p>{PROVIDERS_TEXT.deleteTakes}</p>}
          verb={PROVIDERS_TEXT.deleteSubmit}
          cancel={PROVIDERS_TEXT.cancel}
          busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  );
}
