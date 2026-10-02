"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { ASSETS, ASSETS_TEXT } from "@/content/screens/assets";
import { Button } from "../../../ui/button";
import { Confirm } from "../../../ui/confirm";
import { Notice } from "../../../ui/notice";

export interface DeleteAssetProps {
  assetId: string;
  /** What the asset would leave: the row's *used by*, or every harness when
   *  the organisation loads it into all of them (PRD §15). */
  leaves: { all: boolean; labels: string[] };
  scope: string;
}

/**
 * `DELETE /v1/assets/{id}?scope=` (WS3a) — the row's Delete. The
 * confirmation is the preview (02 rule 22): it names the harnesses the asset
 * will leave. A refusal — `asset.required` for something every session loads
 * — is rendered inside the dialog, where the verb is, in the server's own
 * words (rule 21).
 */
export function DeleteAsset({ assetId, leaves, scope }: DeleteAssetProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; remedy?: string } | null>(null);

  async function remove() {
    setBusy(true);
    setFailure(null);
    try {
      await request(`/v1/assets/${assetId}?scope=${scope}`, await getToken(), {
        method: "DELETE",
      });
      setConfirming(false);
      router.refresh();
    } catch (error) {
      const api = error instanceof ApiError ? error : null;
      setFailure({ message: api?.message ?? String(error), remedy: api?.remedy });
    } finally {
      setBusy(false);
    }
  }

  const takes = (
    <>
      <p>{ASSETS_TEXT.removeTakes}</p>
      {leaves.all ? (
        <p>{ASSETS_TEXT.removeLeavesAll}</p>
      ) : leaves.labels.length === 0 ? (
        <p>{ASSETS_TEXT.removeLeavesNone}</p>
      ) : (
        <>
          <p>{ASSETS_TEXT.removeLeaves}</p>
          <ul className="list-disc pl-5">
            {leaves.labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </>
      )}
      {failure && (
        <Notice tone="warn">
          <p>{failure.message}</p>
          {failure.remedy && <p className="text-muted">{failure.remedy}</p>}
        </Notice>
      )}
    </>
  );

  return (
    <>
      <Button
        size="sm"
        variant="danger"
        explain={ASSETS.verbs.remove.explain}
        onClick={() => setConfirming(true)}
      >
        {ASSETS.verbs.remove.label}
      </Button>
      {confirming && (
        <Confirm
          title={ASSETS_TEXT.removeTitle}
          takes={takes}
          verb={ASSETS.verbs.remove.label}
          cancel={ASSETS_TEXT.cancel}
          busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  );
}
