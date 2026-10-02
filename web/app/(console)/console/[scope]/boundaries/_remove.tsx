"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { BOUNDARIES, BOUNDARIES_TEXT } from "@/content/screens/boundaries";
import { Button } from "../../../ui/button";
import { Confirm } from "../../../ui/confirm";
import { Notice } from "../../../ui/notice";

/** `DELETE /v1/boundaries/{id}` (00 §4.11) — the row's verb. The route finds
 *  the node holding the id and refuses anyone who does not administer it. */
export function RemoveBoundary({ boundaryId }: { boundaryId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setFailure(null);
    try {
      await request(`/v1/boundaries/${boundaryId}`, await getToken(), { method: "DELETE" });
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
        explain={BOUNDARIES.verbs.remove.explain}
        onClick={() => setConfirming(true)}
      >
        {BOUNDARIES_TEXT.removeVerb}
      </Button>
      {failure && <Notice tone="warn">{failure}</Notice>}
      {confirming && (
        <Confirm
          title={BOUNDARIES_TEXT.removeTitle}
          takes={<p>{BOUNDARIES_TEXT.removeTakes}</p>}
          verb={BOUNDARIES_TEXT.removeVerb}
          cancel={BOUNDARIES_TEXT.cancel}
          busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  );
}
