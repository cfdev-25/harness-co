"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { LOGS, LOGS_TEXT } from "@/content/screens/logs";
import { Button } from "../../../../ui/button";

export interface AllowHostProps {
  host: string;
  /** `AllowAction.scope` — `org` or `team:<path>`, already in the spelling
   *  the write takes, aimed at the node the refused row named in `setBy`. */
  scope: string;
}

/**
 * W5-D4's **Allow**: the refusal in the log and the setting that caused it,
 * one click apart (D136). It writes `POST /v1/reach/hosts?scope=` against the
 * node that refused — under `allow` the host goes on the list, under `on` it
 * comes off the deny-list, and the person does not have to know which.
 *
 * The row then reads *allowed for the next session*, which is the honest
 * tense: nothing changes inside a session already running, because its plan
 * was fixed at preflight. `router.refresh()` follows, so the attempt's own
 * row comes back from the server rather than being edited here (02 rule 20).
 */
export function AllowHost({ host, scope }: AllowHostProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<{ message: string; remedy?: string } | null>(null);

  async function allow() {
    setBusy(true);
    setFailure(null);
    try {
      await request(`/v1/reach/hosts?scope=${scope}`, await getToken(), {
        method: "POST",
        body: JSON.stringify({ host }),
      });
      setDone(true);
      router.refresh();
    } catch (error) {
      const failed = error instanceof ApiError ? error : null;
      setFailure({ message: failed?.message ?? String(error), remedy: failed?.remedy });
    } finally {
      setBusy(false);
    }
  }

  if (done) return <span data-allowed className="text-xs text-ok">{LOGS_TEXT.allowedNext}</span>;
  return (
    <span className="grid gap-1">
      <Button size="sm" explain={LOGS.verbs.allow.explain} busy={busy} onClick={() => void allow()}>
        {LOGS.verbs.allow.label}
      </Button>
      {failure && (
        <span className="grid gap-1 text-xs text-warn">
          <span>{failure.message}</span>
          {failure.remedy && <span>{failure.remedy}</span>}
        </span>
      )}
    </span>
  );
}
