"use client";

import { useRouter } from "next/navigation";
import { refusalSentence } from "@/lib/views/refusals";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { acceptTakes, fill, has, refusesDecision, type RequestView } from "@/lib/views/requests";
import { REQUESTS_WORDS as WORDS } from "@/content/screens/requests";
import { Button } from "../../../../../../ui/button";
import { Confirm } from "../../../../../../ui/confirm";
import { Line } from "../../../../../../ui/line";
import { Notice } from "../../../../../../ui/notice";
import { PermissionNotCleared } from "../../../../../../ui/permission-not-cleared";
import { SectionLabel } from "../../../../../../ui/section-label";
import { Textarea } from "../../../../../../ui/textarea";

type Pending = "accept" | "decline" | "withdraw" | null;

/**
 * 04 §7's `Screen` aside at the end: the discussion, the decision when the
 * request is closed, and the verbs. Which verbs exist is `RequestView.verbs`
 * — the server's, computed from role and authorship (K8) — and a verb the
 * viewer lacks renders as `PermissionNotCleared` naming who decides, never as
 * a disabled button (P13, S6). Every write is `request()` + `router.refresh()`
 * (D21); nothing is optimistic.
 */
export function RequestAside({ view }: { view: RequestView }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; remedy?: string } | null>(null);

  async function call(path: `/v1/${string}`, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await request(path, await getToken(), { method: "POST", body: JSON.stringify(body) });
      setPending(null);
      setReason("");
      setComment("");
      router.refresh();
    } catch (failure) {
      const api = failure instanceof ApiError ? failure : null;
      setError({ message: api?.message ?? String(failure), remedy: api?.remedy });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid content-start gap-6 border-l border-hairline px-4 py-5">
      <section className="grid gap-2">
        <SectionLabel>{WORDS.discussion}</SectionLabel>
        {view.discussion.length === 0 ? (
          <p className="text-base text-muted">{WORDS.noDiscussion}</p>
        ) : (
          view.discussion.map((entry) => (
            <Line key={entry.id} name={entry.who} note={`${entry.at} · ${entry.text}`} />
          ))
        )}
        {has(view, "comment") && (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void call(`/v1/requests/${view.id}/comments`, { text: comment });
            }}
          >
            <Textarea
              label={WORDS.commentLabel}
              value={comment}
              rows={3}
              onChange={(event) => setComment(event.target.value)}
            />
            <Button type="submit" busy={busy}>
              {WORDS.commentSubmit}
            </Button>
          </form>
        )}
      </section>

      {view.outcome && (
        <section className="grid gap-2">
          <SectionLabel>{WORDS.decision}</SectionLabel>
          <p className="text-base text-fg">{WORDS.outcomes[view.outcome.decision]}</p>
          <p className="text-base text-muted">{fill(WORDS.decisionBy, { who: view.outcome.by })}</p>
          {view.outcome.reason && <p className="text-base text-muted">{view.outcome.reason}</p>}
        </section>
      )}

      <section className="grid gap-2">
        {refusesDecision(view) && (
          <PermissionNotCleared decider={refusalSentence("requests.accept", { team: view.team.name })} />
        )}
        {has(view, "accept") && (
          <Button variant="primary" onClick={() => setPending("accept")}>
            {fill(WORDS.acceptLabel, { n: String(view.files.length) })}
          </Button>
        )}
        {has(view, "decline") && <Button onClick={() => setPending("decline")}>{WORDS.declineLabel}</Button>}
        {has(view, "withdraw") && (
          <Button variant="danger" onClick={() => setPending("withdraw")}>
            {WORDS.withdrawLabel}
          </Button>
        )}
        {error && (
          <Notice tone="warn">
            <p>{error.message}</p>
            {error.remedy && <p className="text-muted">{error.remedy}</p>}
          </Notice>
        )}
      </section>

      {pending === "accept" && (
        <Confirm
          title={WORDS.acceptTitle}
          takes={<p>{acceptTakes(view, WORDS.acceptTakes)}</p>}
          verb={WORDS.acceptConfirm}
          cancel={WORDS.cancel}
          busy={busy}
          onClose={() => setPending(null)}
          onConfirm={() => void call(`/v1/requests/${view.id}/accept`, {})}
        />
      )}
      {pending === "decline" && (
        <Confirm
          title={WORDS.declineTitle}
          takes={
            <>
              <p>{WORDS.declineTakes}</p>
              <Textarea
                label={WORDS.declineReason}
                value={reason}
                required
                rows={3}
                onChange={(event) => setReason(event.target.value)}
              />
            </>
          }
          verb={WORDS.declineConfirm}
          cancel={WORDS.cancel}
          busy={busy || reason.trim().length === 0}
          onClose={() => setPending(null)}
          onConfirm={() => void call(`/v1/requests/${view.id}/decline`, { reason })}
        />
      )}
      {pending === "withdraw" && (
        <Confirm
          title={WORDS.withdrawTitle}
          takes={<p>{WORDS.withdrawTakes}</p>}
          verb={WORDS.withdrawConfirm}
          cancel={WORDS.cancel}
          busy={busy}
          onClose={() => setPending(null)}
          onConfirm={() => void call(`/v1/requests/${view.id}/withdraw`, {})}
        />
      )}
    </div>
  );
}
