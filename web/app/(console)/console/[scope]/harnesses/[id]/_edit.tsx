"use client";

import { useRouter } from "next/navigation";
import { refusalSentence } from "@/lib/views/refusals";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import type { HarnessView } from "@/lib/views/harness";
import { fill } from "@/lib/views/requests";
import type { PixelIcon } from "@/lib/views/types";
import { HARNESS, HARNESS_WORDS as WORDS } from "@/content/screens/harness";
import { Button } from "../../../../ui/button";
import { Confirm } from "../../../../ui/confirm";
import { Field } from "../../../../ui/field";
import { Modal } from "../../../../ui/modal";
import { Notice } from "../../../../ui/notice";
import { PermissionNotCleared } from "../../../../ui/permission-not-cleared";
import { PixelEditor } from "../../../../ui/pixel-editor";
import { Textarea } from "../../../../ui/textarea";

const BLANK: PixelIcon = { palette: [], rows: Array<string>(16).fill(".".repeat(16)) };

/**
 * 04 §5's edit and delete verbs. The delete confirmation names what it takes
 * with it — *this removes the harness and nothing in it: N files keep their
 * history* — because the preview is the confirmation (§18).
 */
export function EditHarness({ view, mayChange }: { view: HarnessView; mayChange: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; remedy?: string } | null>(null);
  const [name, setName] = useState(view.def.name);
  const [description, setDescription] = useState(view.def.description);
  const [icon, setIcon] = useState<PixelIcon>(view.def.icon ?? BLANK);

  if (!mayChange) {
    // S6, P13: the refusal is rendered where the verbs would be and names who
    // decides (04 §5's sentence). There is no disabled button.
    return <PermissionNotCleared decider={refusalSentence("harness.change")} />;
  }

  async function call(method: "PATCH" | "DELETE", body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await request(`/v1/harnesses/${view.def.id}`, await getToken(), {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setOpen(false);
      setConfirming(false);
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
      <Button explain={HARNESS.verbs.edit.explain} onClick={() => setOpen(true)}>
        {HARNESS.verbs.edit.label}
      </Button>
      <Button variant="danger" explain={HARNESS.verbs.delete.explain} onClick={() => setConfirming(true)}>
        {HARNESS.verbs.delete.label}
      </Button>
      {error && (
        <Notice tone="warn">
          <p>{error.message}</p>
          {error.remedy && <p className="text-muted">{error.remedy}</p>}
        </Notice>
      )}
      {open && (
        <Modal title={HARNESS.verbs.edit.label} onClose={() => setOpen(false)} size="lg">
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void call("PATCH", { name, description, icon });
            }}
          >
            <Field
              label={WORDS.editName}
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Textarea
              label={WORDS.editDescription}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <PixelEditor value={icon} onChange={setIcon} eraseLabel={WORDS.editErase} clearLabel={WORDS.editClear} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{WORDS.deleteCancel}</Button>
              <Button variant="primary" type="submit" busy={busy}>
                {WORDS.editSave}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {confirming && (
        <Confirm
          title={HARNESS.verbs.delete.label}
          takes={<p>{fill(WORDS.deleteTakes, { n: String(view.header.fileCount) })}</p>}
          verb={HARNESS.verbs.delete.label}
          cancel={WORDS.deleteCancel}
          busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={() => void call("DELETE")}
        />
      )}
    </>
  );
}
