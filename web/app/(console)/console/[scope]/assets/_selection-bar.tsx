"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { type Brought, broughtSentence } from "@/lib/views/assets";
import type { HarnessCard, PersonalChoices } from "@/lib/views/harness";
import type { Scope } from "@/lib/views/types";
import { fill } from "@/lib/views/refusals";
import { ASSETS_TEXT } from "@/content/screens/assets";
import { Button } from "../../../ui/button";
import { Modal } from "../../../ui/modal";
import { Notice } from "../../../ui/notice";
import { Select } from "../../../ui/select";
import { NewHarness } from "../_new-harness";

export interface SelectionBarProps {
  scope: Scope;
  /** The viewer's own harnesses (`?scope=me`): the only ones they may write. */
  harnesses: HarnessCard[];
  /** What would be added — the ticked ids and the environments they brought. */
  ids: string[];
  brought: Brought[];
  /** How many the person ticked, which is not `ids.length` once a tool has
   *  brought an environment along: the bar says both. */
  picked: number;
  presets: boolean;
  /** W7-D4: the dialog below is the harnesses screen's, so a personal viewer
   *  gets the same two questions here. Absent for an enterprise one. */
  personal?: PersonalChoices;
  onClear: () => void;
}

/**
 * 04 §12's bar, W5-D15. It appears when something is ticked and offers two
 * verbs: **Add to harness**, a picker of the viewer's own harnesses, and
 * **New harness from selection**, which is the harnesses screen's own dialog
 * with the ids already in it — one dialog, not a second one that drifts.
 *
 * The environments a tool brought along are named here, before the button is
 * pressed. The route does the same expansion (`_with_environments`), so the
 * CLI reaching the same write gets the same set; this is the half a route
 * cannot do, which is telling the person first.
 */
export function SelectionBar(props: SelectionBarProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(props.harnesses[0]?.id ?? "");
  const [failure, setFailure] = useState<{ message: string; remedy?: string } | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await request(`/v1/harnesses/${target}/assets?scope=me`, await getToken(), {
        method: "POST",
        body: JSON.stringify({ ids: props.ids }),
      });
      setOpen(false);
      props.onClear();
      router.refresh();
    } catch (error) {
      const api = error instanceof ApiError ? error : null;
      setFailure({ message: api?.message ?? String(error), remedy: api?.remedy });
    } finally {
      setBusy(false);
    }
  }

  const count =
    props.picked === 1
      ? ASSETS_TEXT.browseSelectedOne
      : fill(ASSETS_TEXT.browseSelected, { n: String(props.picked) });

  return (
    <div
      data-selection-bar
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-line bg-raised px-4 py-3"
    >
      <span className="font-semibold">{count}</span>
      <Button onClick={props.onClear}>{ASSETS_TEXT.browseClear}</Button>
      <span className="grow" />
      <NewHarness
        scope={props.scope}
        cards={props.harnesses}
        canEdit={false}
        assets={props.ids}
        personal={props.personal}
        label={ASSETS_TEXT.newFromSelection}
        explain={ASSETS_TEXT.newFromSelectionExplain}
      />
      <Button
        variant="primary"
        explain={ASSETS_TEXT.addToHarnessExplain}
        onClick={() => setOpen(true)}
      >
        {ASSETS_TEXT.addToHarness}
      </Button>
      {open && (
        <Modal title={ASSETS_TEXT.addTitle} onClose={() => setOpen(false)}>
          <form className="grid gap-4" onSubmit={(event) => void add(event)}>
            {props.harnesses.length === 0 ? (
              <p className="text-base text-muted">{ASSETS_TEXT.addNoHarnesses}</p>
            ) : (
              <Select
                label={ASSETS_TEXT.addWhich}
                name="harness"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                {props.harnesses.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.name}
                  </option>
                ))}
              </Select>
            )}
            <div data-adds className="grid gap-1 text-base text-muted">
              <p>
                {props.ids.length === 1
                  ? ASSETS_TEXT.browseAddsOne
                  : fill(ASSETS_TEXT.browseAdds, { n: String(props.ids.length) })}
              </p>
              {props.brought.map((one) => (
                <p key={one.id}>{broughtSentence(one)}</p>
              ))}
              {props.presets && <p>{ASSETS_TEXT.browsePresetNote}</p>}
            </div>
            {failure && (
              <Notice tone="warn">
                <p>{failure.message}</p>
                {failure.remedy && <p className="text-muted">{failure.remedy}</p>}
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{ASSETS_TEXT.cancel}</Button>
              {/* P13: a verb that cannot be pressed is not rendered disabled
                  — with no harness of their own, the sentence above is the
                  answer and *New harness from selection* is the way on. */}
              {props.harnesses.length > 0 && (
                <Button variant="primary" type="submit" busy={busy}>
                  {ASSETS_TEXT.addSubmit}
                </Button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
