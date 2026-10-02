"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { revokeLabel } from "@/lib/views/session";
import type { Viewer } from "@/lib/views/types";
import { SESSIONS, SESSIONS_WORDS as WORDS } from "@/content/screens/sessions";
import { Button } from "../../../../../ui/button";
import { Confirm } from "../../../../../ui/confirm";
import { Notice } from "../../../../../ui/notice";
import { Textarea } from "../../../../../ui/textarea";

/**
 * 04 §13: a reason is required and the confirmation names what revoking does
 * — the preview is the confirmation, never *Are you sure?* (§18). At
 * `edition: "personal"` the verb reads *End session* (07 §3).
 */
export function Revoke({ id, viewer }: { id: string; viewer: Viewer }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; remedy?: string } | null>(null);
  const label = revokeLabel(viewer, {
    revoke: SESSIONS.verbs.revoke.label,
    endSession: SESSIONS.verbs.endSession.label,
  });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await request(`/v1/sessions/${id}/revoke`, await getToken(), {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setOpen(false);
      router.refresh();
    } catch (failure) {
      const api = failure instanceof ApiError ? failure : null;
      setError({ message: api?.message ?? String(failure), remedy: api?.remedy });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="danger" explain={SESSIONS.verbs.revoke.explain} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {error && (
        <Notice tone="warn">
          <p>{error.message}</p>
          {error.remedy && <p className="text-muted">{error.remedy}</p>}
        </Notice>
      )}
      {open && (
        <Confirm
          title={WORDS.revoke.title}
          takes={
            <>
              <p>{WORDS.revoke.takes}</p>
              <Textarea
                label={WORDS.revoke.reason}
                value={reason}
                required
                rows={3}
                onChange={(event) => setReason(event.target.value)}
              />
            </>
          }
          verb={WORDS.revoke.confirm}
          cancel={WORDS.revoke.cancel}
          busy={busy || reason.trim().length === 0}
          onClose={() => setOpen(false)}
          onConfirm={() => void submit()}
        />
      )}
    </>
  );
}
