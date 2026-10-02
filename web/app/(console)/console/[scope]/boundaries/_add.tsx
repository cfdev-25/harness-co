"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { type BoundaryTab, scopeFor } from "@/lib/views/boundaries";
import { SCALES } from "@/lib/views/scales";
import { BOUNDARIES, BOUNDARIES_TEXT, BOUNDARY_KINDS } from "@/content/screens/boundaries";
import { Button } from "../../../ui/button";
import { Field } from "../../../ui/field";
import { Modal } from "../../../ui/modal";
import { Notice } from "../../../ui/notice";
import { Select } from "../../../ui/select";
import { Textarea } from "../../../ui/textarea";

export interface AddBoundaryProps {
  /** The node the boundary is added at: this team and below, never wider. */
  scopePath: string;
  /** The organization's path, because at the top *below me* is `"all"` and
   *  not the organization's own name (`scopeFor`). */
  orgPath: string;
  /** The tab the form was opened from, which picks the kind it starts on
   *  (W6-D8): adding from Commands means adding a command. */
  kind: BoundaryTab;
}

/** W6-D8: the tab's own kind, so *Add a boundary* on Commands opens on
 *  `command` rather than making a person pick the thing they just clicked. */
const KIND_OF: Record<BoundaryTab, string> = {
  reach: "endpoint",
  commands: "command",
  files: "filesystem",
};

/**
 * W6-D9 — `commandPatternProblem` from `@harness/compose`, in the browser.
 *
 * `web` does not depend on the engine packages, so the two refusals the api
 * makes are asked here first, in the api's own sentences, and the form says no
 * before a round trip. The api is still the one that decides: this is the
 * question asked early, never the answer (02 rule 21).
 */
function patternProblem(pattern: string): string | null {
  const one = pattern.trim();
  if (one === "") return "A command boundary needs a pattern — the command line it holds against.";
  if (one.replace(/[*\s]/g, "") === "")
    return "A pattern of only * denies every command there is. Name the command you mean.";
  return null;
}

/**
 * `POST /v1/boundaries` (00 §4.11). W6-D9 landed command interception, so
 * `holds` is no longer a choice the form disables: a command boundary is
 * `intercepted` and nothing else — the runtime refuses the call as it is made,
 * and nothing outside the runtime can hold a command at all (engine 06 §13) —
 * while every other kind is `enforced` by the fence or the jail. The form says
 * which rather than offering a value the api would refuse. No optimistic UI:
 * the screen refetches through `router.refresh()` and shows what is now so.
 */
export function AddBoundary({ scopePath, orgPath, kind }: AddBoundaryProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; remedy?: string } | null>(null);
  const [form, setForm] = useState({ kind: KIND_OF[kind], value: "", holds: "enforced", reason: "" });
  const isCommand = form.kind === "command";
  const problem = isCommand ? patternProblem(form.value) : null;

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      await request("/v1/boundaries", await getToken(), {
        method: "POST",
        body: JSON.stringify({
          ...form,
          // A command is refused by the runtime and by nothing else, so the
          // form never sends anything but `intercepted` for one.
          holds: isCommand ? "intercepted" : form.holds,
          scope: scopeFor(scopePath, orgPath),
          at: scopePath,
        }),
      });
      setOpen(false);
      router.refresh();
    } catch (error) {
      const failed = error instanceof ApiError ? error : null;
      setFailure({
        message: failed?.message ?? String(error),
        remedy: failed?.remedy,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" explain={BOUNDARIES.verbs.add.explain} onClick={() => setOpen(true)}>
        {BOUNDARIES.verbs.add.label}
      </Button>
      {open && (
        <Modal title={BOUNDARIES_TEXT.addTitle} onClose={() => setOpen(false)}>
          <div className="grid gap-4">
            <Select
              label={BOUNDARIES_TEXT.kindLabel}
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value })}
            >
              {BOUNDARY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </Select>
            <Field
              label={BOUNDARIES_TEXT.valueLabel}
              hint={isCommand ? BOUNDARIES_TEXT.patternHint : BOUNDARIES_TEXT.valueHint}
              value={form.value}
              onChange={(event) => setForm({ ...form, value: event.target.value })}
            />
            {isCommand ? (
              <Field
                label={BOUNDARIES_TEXT.holdsLabel}
                value={BOUNDARIES_TEXT.holdsCommandFixed}
                readOnly
              />
            ) : (
              <Select
                label={BOUNDARIES_TEXT.holdsLabel}
                value={form.holds}
                onChange={(event) => setForm({ ...form, holds: event.target.value })}
              >
                {SCALES.holds.values.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.value}
                  </option>
                ))}
              </Select>
            )}
            <Textarea
              label={BOUNDARIES_TEXT.reasonLabel}
              hint={BOUNDARIES_TEXT.reasonHint}
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
            <Field label={BOUNDARIES_TEXT.scopeLabel} hint={BOUNDARIES_TEXT.scopeHint} value={scopePath} readOnly />
            {/* Said where the control is, as soon as it is typed — but never a
                disabled button: the api is what decides, and a form that
                pre-judges a refusal is a form that can be wrong (P13). */}
            {problem && form.value !== "" && <Notice tone="warn">{problem}</Notice>}
            {failure && (
              <Notice tone="warn">
                <p>{failure.message}</p>
                {failure.remedy && <p>{failure.remedy}</p>}
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{BOUNDARIES_TEXT.cancel}</Button>
              <Button
                variant="primary"
                busy={busy}
                onClick={() => void submit()}
              >
                {BOUNDARIES_TEXT.addSubmit}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
