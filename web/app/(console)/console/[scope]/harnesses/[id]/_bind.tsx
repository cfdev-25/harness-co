"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { HARNESS_WORDS as WORDS } from "@/content/screens/harness";
import { Button } from "../../../../ui/button";
import { Checkbox } from "../../../../ui/checkbox";
import { Modal } from "../../../../ui/modal";
import { Notice } from "../../../../ui/notice";

/**
 * W7-D8's two verbs on *Applies here* (04 §5):
 * `POST /v1/harnesses/{id}/boundaries { ids }` and
 * `DELETE /v1/harnesses/{id}/boundaries/{boundary id}`.
 *
 * Both act on the boundary's own `scope.harnesses`, so both are refused by the
 * api for anyone who does not administer the node that set the row; the panel
 * draws them only where that answer is yes, because a verb that only refuses
 * is worse than none (P13). A boundary id is `<node path>/<id>` and carries a
 * slash, so the DELETE encodes it — the route reads the rest of the path.
 *
 * Nothing is optimistic: `router.refresh()` refetches and the panel shows what
 * is now so (D21).
 */
export function BindBoundary({
  harnessId,
  choices,
}: {
  harnessId: string;
  /** The chain's harness-scoped boundaries this harness is not bound to. */
  choices: Array<{ id: string; value: string; kind: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; remedy?: string } | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);

  async function submit() {
    // Nothing ticked is nothing asked for: the route takes one id at least,
    // and a request that is certain to be refused is not worth making.
    if (ticked.length === 0) return;
    setBusy(true);
    setFailure(null);
    try {
      await request(`/v1/harnesses/${harnessId}/boundaries`, await getToken(), {
        method: "POST",
        body: JSON.stringify({ ids: ticked }),
      });
      setOpen(false);
      setTicked([]);
      router.refresh();
    } catch (error) {
      const failed = error instanceof ApiError ? error : null;
      setFailure({ message: failed?.message ?? String(error), remedy: failed?.remedy });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" explain={WORDS.aside.bindExplain} onClick={() => setOpen(true)}>
        {WORDS.aside.bind}
      </Button>
      {open && (
        <Modal title={WORDS.aside.bindTitle} onClose={() => setOpen(false)}>
          <div className="grid gap-4">
            <div className="grid gap-2">
              {choices.map((boundary) => (
                <Checkbox
                  key={boundary.id}
                  label={boundary.value}
                  hint={boundary.kind}
                  checked={ticked.includes(boundary.id)}
                  onChange={(event) =>
                    setTicked((was) =>
                      event.target.checked
                        ? [...was, boundary.id]
                        : was.filter((id) => id !== boundary.id),
                    )
                  }
                />
              ))}
              <p className="text-xs text-faint">{WORDS.aside.bindHint}</p>
            </div>
            {failure && (
              <Notice tone="warn">
                <p>{failure.message}</p>
                {failure.remedy && <p>{failure.remedy}</p>}
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{WORDS.aside.bindCancel}</Button>
              <Button variant="primary" busy={busy} onClick={() => void submit()}>
                {WORDS.aside.bindSubmit}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * The row's own verb. No confirmation: *Remove* on Boundaries lifts a deny for
 * every harness it covered and asks first, while this takes one harness off
 * one row and the verb that puts it back is on the same panel.
 */
export function UnbindBoundary({
  harnessId,
  boundaryId,
}: {
  harnessId: string;
  boundaryId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function unbind() {
    setBusy(true);
    setFailure(null);
    try {
      await request(
        `/v1/harnesses/${harnessId}/boundaries/${encodeURIComponent(boundaryId)}`,
        await getToken(),
        { method: "DELETE" },
      );
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
        variant="ghost"
        busy={busy}
        explain={WORDS.aside.unbindExplain}
        onClick={() => void unbind()}
      >
        {WORDS.aside.unbind}
      </Button>
      {failure && <Notice tone="warn">{failure}</Notice>}
    </>
  );
}
