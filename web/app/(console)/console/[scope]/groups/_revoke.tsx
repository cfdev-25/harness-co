"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { GROUPS, GROUPS_TEXT } from "@/content/screens/groups";
import { Button } from "../../../ui/button";
import { Confirm } from "../../../ui/confirm";
import { Notice } from "../../../ui/notice";

export interface RevokeGrantProps {
  grantId: string;
  /** What stops resolving: the group's aliases, so the confirmation is the
   *  preview rather than a second dialog asking twice (02 rule 22). */
  aliases: string[];
}

/** `DELETE /v1/grants/{id}` (00 §4.11) — the row's verb on the grants table. */
export function RevokeGrant({ grantId, aliases }: RevokeGrantProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function revoke() {
    setBusy(true);
    setFailure(null);
    try {
      await request(`/v1/grants/${grantId}`, await getToken(), { method: "DELETE" });
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
        explain={GROUPS.verbs.revokeGrant.explain}
        onClick={() => setConfirming(true)}
      >
        {GROUPS.verbs.revokeGrant.label}
      </Button>
      {failure && <Notice tone="warn">{failure}</Notice>}
      {confirming && (
        <Confirm
          title={GROUPS_TEXT.revokeTitle}
          takes={
            aliases.length === 0 ? (
              <p>{GROUPS_TEXT.revokeTakesNone}</p>
            ) : (
              <>
                <p>{GROUPS_TEXT.revokeTakes}</p>
                <ul className="list-disc pl-5">
                  {aliases.map((alias) => (
                    <li key={alias}>{alias}</li>
                  ))}
                </ul>
              </>
            )
          }
          verb={GROUPS_TEXT.revokeVerb}
          cancel={GROUPS_TEXT.cancel}
          busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => void revoke()}
        />
      )}
    </>
  );
}
