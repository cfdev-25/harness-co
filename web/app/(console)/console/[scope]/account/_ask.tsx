"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { fill } from "@/lib/views/refusals";
import { ACCOUNT, ACCOUNT_TEXT } from "@/content/screens/account";
import { Button } from "../../../ui/button";
import { Field } from "../../../ui/field";
import { Modal } from "../../../ui/modal";
import { Notice } from "../../../ui/notice";
import { Textarea } from "../../../ui/textarea";

export interface AskProps {
  team: { path: string; name: string } | null;
  /** 07 §3: at *n* = 0 the one verb is the upgrade, not the ask. */
  personal: boolean;
}

/**
 * D43: a role request is the request primitive with a `subject`, so *Ask to be
 * a team admin* is `POST /v1/requests { subject: { kind: "role", … } }` and
 * nothing else. *Create a team* is the personal edition's one upgrade (07 §1).
 */
export function Ask({ team, personal }: AskProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [name, setName] = useState("");

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      if (personal) {
        await request("/v1/org-units", await getToken(), {
          method: "POST",
          body: JSON.stringify({ kind: "team", name }),
        });
      } else {
        await request("/v1/requests", await getToken(), {
          method: "POST",
          body: JSON.stringify({
            title: fill(ACCOUNT_TEXT.askLabel, { team: team?.name ?? "" }),
            reasoning: reason,
            subject: { kind: "role", level: "team-admin", team: team?.path ?? "" },
          }),
        });
      }
      setDone(true);
      setOpen(false);
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid justify-items-start gap-3">
      {personal ? (
        <p className="text-base text-muted">{ACCOUNT_TEXT.createTeamNote}</p>
      ) : (
        <p className="text-base text-muted">{ACCOUNT.verbs.askToBeAdmin.explain}</p>
      )}
      <Button variant="primary" onClick={() => setOpen(true)}>
        {personal
          ? ACCOUNT_TEXT.createTeamTitle
          : fill(ACCOUNT_TEXT.askLabel, { team: team?.name ?? "" })}
      </Button>
      {done && <Notice tone="ok">{ACCOUNT_TEXT.askSent}</Notice>}
      {open && (
        <Modal
          title={personal ? ACCOUNT_TEXT.createTeamTitle : ACCOUNT_TEXT.askTitle}
          onClose={() => setOpen(false)}
        >
          <div className="grid gap-4">
            {personal ? (
              <Field
                label={ACCOUNT_TEXT.createTeamName}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            ) : (
              <Textarea
                label={ACCOUNT_TEXT.askReason}
                hint={ACCOUNT_TEXT.askReasonHint}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
            {failure && <Notice tone="warn">{failure}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{ACCOUNT_TEXT.cancel}</Button>
              <Button variant="primary" busy={busy} onClick={() => void submit()}>
                {personal ? ACCOUNT_TEXT.createTeamSubmit : ACCOUNT_TEXT.askSubmit}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
