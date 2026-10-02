"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { fill } from "@/lib/views/refusals";
import {
  DIMENSIONS,
  type MatrixDimension,
  type ModelProviderRow,
  type RoutingMatrix,
  subjectsOf,
  withApproval,
  withDefault,
  withoutApproval,
} from "@/lib/views/providers";
import { PROVIDERS, PROVIDERS_TEXT } from "@/content/screens/providers";
import { Button } from "../../../../ui/button";
import { Modal } from "../../../../ui/modal";
import { Notice } from "../../../../ui/notice";
import { Select } from "../../../../ui/select";

export interface RoutingVerbProps {
  row: ModelProviderRow;
  /** The whole routing file as the server composed it: `PUT /v1/routing` takes
   *  both maps, so every cell this verb does not touch travels with the one it
   *  does, and the page hands the maps down rather than the browser guessing
   *  them from the rows (K2). */
  matrix: RoutingMatrix;
  verb: "default" | "approve";
  /** At a team scope the one subject a team admin may write: their own team,
   *  and only to a provider already approved for it (D42 — a select limited to
   *  what is allowed is not a refusal). `null` at the organisation. */
  only?: string | null;
}

/**
 * W6-D5's two verbs, *Set default…* and *Approve for…*, in the row that owns
 * the setting. Each picks a dimension and a subject — a team, a harness or a
 * runtime — and writes `routing.json` through the write that was already
 * there; the Routing tab is gone, not its endpoint.
 *
 * *Set default…* also approves, because a default outside *approved for* is a
 * cell that resolves to a provider the broker refuses at step 5: the server's
 * own `routing.not_approved` for a team admin is the proof that the pair has to
 * move together.
 */
export function RoutingVerb({ row, matrix, verb, only = null }: RoutingVerbProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [dimension, setDimension] = useState<MatrixDimension>("teams");
  const subjects = only === null
    ? subjectsOf(matrix, dimension)
    : subjectsOf(matrix, "teams").filter((subject) => subject.id === only);
  const [subject, setSubject] = useState("");
  const chosen = subject || subjects[0]?.id || "";
  const content = verb === "default" ? PROVIDERS.verbs.setRouting : PROVIDERS.verbs.approveFor;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    const maps = verb === "default"
      ? withDefault(matrix, only === null ? dimension : "teams", chosen, row.id)
      : withApproval(matrix, dimension, chosen, row.id);
    try {
      await request("/v1/routing", await getToken(), {
        method: "PUT",
        body: JSON.stringify(maps),
      });
      setOpen(false);
      router.refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (subjects.length === 0) return null;
  return (
    <div className="grid justify-items-start gap-2">
      <Button size="sm" explain={content.explain} onClick={() => setOpen(true)}>
        {content.label}
      </Button>
      {open && (
        <Modal
          title={fill(
            verb === "default" ? PROVIDERS_TEXT.setDefaultTitle : PROVIDERS_TEXT.approveForTitle,
            { provider: row.id },
          )}
          onClose={() => setOpen(false)}
        >
          <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            {only === null && (
              <Select
                label={PROVIDERS_TEXT.pickDimension}
                value={dimension}
                onChange={(event) => {
                  const next = DIMENSIONS.find((one) => one === event.target.value) ?? "teams";
                  setDimension(next);
                  setSubject("");
                }}
              >
                {DIMENSIONS.map((one) => (
                  <option key={one} value={one}>
                    {PROVIDERS_TEXT.dimensions[one]}
                  </option>
                ))}
              </Select>
            )}
            <Select
              label={PROVIDERS_TEXT.pickSubject}
              value={chosen}
              onChange={(event) => setSubject(event.target.value)}
            >
              {subjects.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.label}
                </option>
              ))}
            </Select>
            {failure && <Notice tone="warn">{failure}</Notice>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{PROVIDERS_TEXT.cancel}</Button>
              <Button variant="primary" type="submit" busy={busy}>
                {verb === "default"
                  ? PROVIDERS_TEXT.setDefaultSubmit
                  : PROVIDERS_TEXT.approveForSubmit}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {failure && !open && <Notice tone="warn">{failure}</Notice>}
    </div>
  );
}

/** The remove on an existing approval (W6-D5). The default that relied on it
 *  goes with it: a default outside *approved for* resolves to a refusal. */
export function RemoveApproval({
  row,
  matrix,
  dimension,
  subject,
}: {
  row: ModelProviderRow;
  matrix: RoutingMatrix;
  dimension: MatrixDimension;
  subject: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setFailure(null);
    try {
      await request("/v1/routing", await getToken(), {
        method: "PUT",
        body: JSON.stringify(withoutApproval(matrix, dimension, subject, row.id)),
      });
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
        busy={busy}
        explain={PROVIDERS.verbs.removeApproval.explain}
        onClick={() => void remove()}
      >
        {PROVIDERS_TEXT.remove}
      </Button>
      {failure && <Notice tone="warn">{failure}</Notice>}
    </>
  );
}
