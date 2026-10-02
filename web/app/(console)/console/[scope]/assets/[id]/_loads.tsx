"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { LOADS, type LoadsState, loadsWord } from "@/lib/views/assets";
import { ASSETS, ASSETS_TEXT } from "@/content/screens/assets";
import { Confirm } from "../../../../ui/confirm";
import { Notice } from "../../../../ui/notice";
import { Segmented } from "../../../../ui/segmented";

export interface SetLoadsProps {
  assetId: string;
  loads: LoadsState;
}

const EXPLAIN: Record<LoadsState, string> = {
  required: ASSETS_TEXT.requiredExplain,
  recommended: ASSETS_TEXT.recommendedExplain,
  "on-request": ASSETS_TEXT.onRequestExplain,
};

/**
 * `PUT /v1/assets/{id}/loads` (00 §4.11, committed on the org ref through D9's
 * helper). W5-D10's three states, so a three-way choice: `required` ·
 * `recommended` · `on-request`. The route still accepts `always` and `chosen`
 * for one release; this sends the new words and nothing else.
 *
 * Moving to *required* confirms with what it takes — preflight will refuse to
 * launch any harness without it (04 §12). The other two take nothing away, so
 * they commit on the press.
 */
export function SetLoads({ assetId, loads }: SetLoadsProps) {
  const router = useRouter();
  const [choice, setChoice] = useState<LoadsState>(loads);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function commit(next: LoadsState) {
    setBusy(true);
    setFailure(null);
    try {
      await request(`/v1/assets/${assetId}/loads`, await getToken(), {
        method: "PUT",
        body: JSON.stringify({ loads: next }),
      });
      setConfirming(false);
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function choose(next: string) {
    const state = LOADS.find((one) => one === next);
    if (!state || state === choice) return;
    setChoice(state);
    if (state === "required") setConfirming(true);
    else void commit(state);
  }

  return (
    <div className="grid justify-items-start gap-3">
      <p className="text-base text-muted">{EXPLAIN[choice]}</p>
      <Segmented
        label={ASSETS.verbs.setLoads.label}
        value={choice}
        onChange={choose}
        options={LOADS.map((state) => ({ id: state, label: loadsWord(state) }))}
      />
      {failure && <Notice tone="warn">{failure}</Notice>}
      {confirming && (
        <Confirm
          title={ASSETS_TEXT.confirmTitle}
          takes={<p>{ASSETS_TEXT.confirmTakes}</p>}
          verb={ASSETS_TEXT.confirmVerb}
          cancel={ASSETS_TEXT.cancel}
          busy={busy}
          onConfirm={() => void commit("required")}
          onClose={() => {
            setConfirming(false);
            setChoice(loads);
          }}
        />
      )}
    </div>
  );
}
