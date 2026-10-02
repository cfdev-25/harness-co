"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { SCALES } from "@/lib/views/scales";
import { type HarnessProviderRow, approvalOf, scopeOf } from "@/lib/views/providers";
import { PROVIDERS, PROVIDERS_TEXT } from "@/content/screens/providers";
import { Button } from "../../../ui/button";
import { Notice } from "../../../ui/notice";
import { Select } from "../../../ui/select";
import { Textarea } from "../../../ui/textarea";

/** The options are the scale's own values, so the admin's switch reads the
 *  same words as the member's `ScaleTag` and cannot drift from it (K4). */
const OPTIONS = SCALES.approval.values;

/**
 * 04 §10: the control is **in the row**. `PUT /v1/providers/harness/{id}` is a
 * whole-row write, so the pin, the wire formats and the scope the row already
 * carries go back with the approval — this verb moves the approval, not who it
 * reaches (the CLI's `harness providers` sends the same five fields). Beta and
 * *not approved* ask for their reason inline; *not approved* without one is
 * refused here, before the request, in the hint everyone who meets it reads.
 */
export function ApprovalSwitch({ row }: { row: HarnessProviderRow }) {
  const router = useRouter();
  const current = approvalOf(row);
  const [pending, setPending] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function put(approval: string, why: string) {
    setBusy(true);
    setFailure(null);
    try {
      await request(`/v1/providers/harness/${encodeURIComponent(row.id)}`, await getToken(), {
        method: "PUT",
        body: JSON.stringify({
          approval,
          reason: why || undefined,
          scope: scopeOf(row),
          pin: row.pin,
          speaks: row.speaks,
        }),
      });
      setPending(null);
      setReason("");
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function choose(value: string) {
    setFailure(null);
    // Approving takes nothing away, so it needs no reason and no second step;
    // the other two do, and the row opens the reason where the switch is.
    if (value === "approved") void put(value, "");
    else setPending(value);
  }

  const missing = pending === "not-approved" && reason.trim() === "";

  return (
    // `ui/table` moves row to row on the arrow keys (D26); inside this cell the
    // keys belong to the select and the reason.
    <div className="grid gap-2" onKeyDown={(event) => event.stopPropagation()}>
      <div className="min-w-40">
        <Select
          label={PROVIDERS.columns.approval.heading}
          labelHidden
          value={pending ?? current}
          onChange={(event) => choose(event.target.value)}
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value} title={option.meaning}>
              {option.value}
            </option>
          ))}
        </Select>
      </div>
      {pending && (
        <>
          <Textarea
            label={PROVIDERS_TEXT.declineReason}
            hint={PROVIDERS_TEXT.declineReasonHint}
            error={missing ? PROVIDERS_TEXT.declineReasonHint : undefined}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setPending(null)}>
              {PROVIDERS_TEXT.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              busy={busy}
              aria-disabled={missing || undefined}
              onClick={missing ? undefined : () => void put(pending, reason)}
            >
              {PROVIDERS_TEXT.decideSubmit}
            </Button>
          </div>
        </>
      )}
      {failure && <Notice tone="warn">{failure}</Notice>}
    </div>
  );
}
