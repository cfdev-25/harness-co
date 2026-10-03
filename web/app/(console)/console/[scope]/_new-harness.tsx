"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { scopeHref, scopeSegment } from "@/lib/scope";
import { getToken } from "@/lib/token.client";
import { type HarnessCard, type PersonalChoices, modelLine } from "@/lib/views/harness";
import type { PixelIcon, Scope } from "@/lib/views/types";
import { HARNESSES, HARNESSES_WORDS as WORDS } from "@/content/screens/harnesses";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { LABEL } from "../../ui/control";
import { Field } from "../../ui/field";
import { Modal } from "../../ui/modal";
import { Notice } from "../../ui/notice";
import { PixelArt } from "../../ui/pixel-art";
import { PixelEditor, blankIcon } from "../../ui/pixel-editor";
import { Select } from "../../ui/select";
import { Switch } from "../../ui/switch";
import { Textarea } from "../../ui/textarea";

/** The one quiet affordance this dialog has: skip the drawing, or take it up. */
const QUIET = "justify-self-start text-xs text-accent-text hover:underline";

/**
 * 04 §4: one button with the choice inside — *start from a copy* is a select
 * in the form, not a second verb. Creating is never refused (PRD §17.4), so
 * there is no `PermissionNotCleared` here. The write is `POST /v1/harnesses`
 * (00 §4.11) followed by `router.refresh()`; nothing is optimistic (D21).
 *
 * It lives at `[scope]/` and not in `harnesses/` because W5-D15 gave it a
 * second caller: the store's *New harness from selection* is this dialog
 * with the ids already in it. A screen may read a private part of an
 * ancestor route (02 rule 2); a copy would have drifted the first time
 * either changed.
 *
 * W5-D9: it creates **at the current level** when the viewer administers it;
 * otherwise the button says where it will land — *New harness in yours* —
 * and posts `scope: "me"`, because a person's own branch is always theirs.
 * `HarnessIn.scope` is the segment (`me`, `org`, a dotted team path), never
 * the `team:` spelling a query string uses.
 *
 * D108: the drawing is made here, in the editor the harness page's Edit
 * uses — a pet nobody is asked for at the one moment they are naming the
 * thing is a pet nobody draws. *Skip, I'll draw it later* says what skipping
 * gets, and an untouched grid sends no `icon` at all, because sixteen rows
 * of dots is not a drawing the server should store.
 *
 * W7-D4: on a personal account it asks two more things, and both are written
 * **on the harness** — *Web access* is `HarnessDef.reach`, *Outside keys* is
 * one grant scoped to this harness. The caller decides whether to ask them by
 * passing `personal`, because the groups come from a fetch and a dialog does
 * not fetch (02 rule 2); an enterprise caller passes none and the form is the
 * one it has always been.
 */
export function NewHarness({
  scope,
  cards,
  canEdit,
  assets,
  label,
  explain,
  personal,
}: {
  scope: Scope;
  cards: HarnessCard[];
  /** Whether the viewer administers this level (`levelOf(...).canEdit`). */
  canEdit: boolean;
  /** W5-D15: *New harness from selection* — the store's ticked ids, already
   *  in the new harness. The same dialog, because a second one would drift
   *  from this one the first time either changed. */
  assets?: string[];
  /** The word on the button when it is not this screen's own verb. */
  label?: string;
  explain?: string;
  /** W7-D4: present for a personal viewer and absent for an enterprise one,
   *  which is the whole of the difference between the two dialogs. */
  personal?: PersonalChoices;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; remedy?: string } | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [from, setFrom] = useState("");
  // D108: `drawing` is the skip, not an empty icon — a blank grid and a grid
  // nobody opened must send the same body, and they do: neither has a colour.
  const [icon, setIcon] = useState<PixelIcon>(blankIcon);
  const [drawing, setDrawing] = useState(true);
  // W7-D4's two questions. Web access starts on, which is what the personal
  // organization's own reach is; keys start at *None*, which is what almost
  // every first harness wants.
  const [web, setWeb] = useState(true);
  const [group, setGroup] = useState("");
  // W7-D8's third question: the harness-scoped boundaries this harness keeps.
  // Nothing ticked sends no key at all, because an empty list and no list are
  // the same new harness and the route binds neither.
  const [denies, setDenies] = useState<string[]>([]);
  const model = modelLine(personal?.setup);
  const own = canEdit ? HARNESSES.verbs.newHarness : HARNESSES.verbs.newHarnessMine;
  const verb = { label: label ?? own.label, explain: explain ?? own.explain };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await request("/v1/harnesses", await getToken(), {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          from: from || undefined,
          // D108: only a drawing with a colour in it. `create_harness` reads
          // a falsy `icon` as *none* and stores the empty rows otherwise, so
          // an untouched grid would write sixteen rows of dots for nothing.
          ...(drawing && icon.palette.length > 0 ? { icon } : {}),
          // W5-D15: the store's selection, already in it. Absent otherwise —
          // an empty list and no list are the same new harness, and the
          // route fills the organization's recommended ids either way.
          ...(assets && assets.length > 0 ? { assets } : {}),
          // The bare path, `org` or `me` — `HarnessIn.scope` is the segment,
          // never the `team:` spelling a query string uses (`scopeQuery`).
          scope: canEdit ? scopeSegment(scope) : "me",
          // W7-D4. `off` is sent; `on` is **not**, and the difference is not
          // tidiness. Absent means *inherit*, and reach only ever narrows
          // (D131): a harness that restates `on` narrows nothing today and
          // becomes a `reach-widened` conflict — which stops every session on
          // the chain (`compose.reach_widened`) — the day the organization
          // turns its own reach down on Boundaries.
          ...(personal && !web ? { reach: { mode: "off", hosts: [] } } : {}),
          ...(personal && group ? { grant: { group } } : {}),
          // W7-D8: the ticked boundaries, as the ids the console's rows carry
          // (`<node path>/<id>`). The route appends this harness to each one's
          // `scope.harnesses`; it creates no boundary, so an empty tick list
          // has nothing to say and says nothing.
          ...(personal && denies.length > 0 ? { boundaries: denies } : {}),
        }),
      });
      setOpen(false);
      setName("");
      setDescription("");
      setIcon(blankIcon());
      setDrawing(true);
      setWeb(true);
      setGroup("");
      setDenies([]);
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
      <Button variant="primary" explain={verb.explain} onClick={() => setOpen(true)}>
        {verb.label}
      </Button>
      {open && (
        <Modal title={verb.label} onClose={() => setOpen(false)}>
          <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            <Field
              label={WORDS.newName}
              name="name"
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
            <div className="grid gap-2">
              <span className={LABEL}>{WORDS.newIcon}</span>
              {drawing ? (
                <>
                  <PixelEditor
                    value={icon}
                    onChange={setIcon}
                    eraseLabel={WORDS.newErase}
                    clearLabel={WORDS.newClear}
                  />
                  <button type="button" className={QUIET} onClick={() => setDrawing(false)}>
                    {WORDS.newIconSkip}
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <PixelArt size={56} alt={WORDS.newIconNone} />
                  <span className="text-base text-muted">{WORDS.newIconNone}</span>
                  <button type="button" className={QUIET} onClick={() => setDrawing(true)}>
                    {WORDS.newIconDraw}
                  </button>
                </div>
              )}
            </div>
            <Textarea
              label={WORDS.newDescription}
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <Select
              label={WORDS.newFrom}
              name="from"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            >
              <option value="">{WORDS.newFromNone}</option>
              {cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.name}
                </option>
              ))}
            </Select>
            {personal && (
              <>
                <Switch
                  label={WORDS.newWebAccess}
                  name="web"
                  checked={web}
                  hint={web ? WORDS.newWebAccessOn : WORDS.newWebAccessOff}
                  onChange={(event) => setWeb(event.target.checked)}
                />
                <Select
                  label={WORDS.newKeys}
                  name="grant"
                  value={group}
                  hint={WORDS.newKeysHint}
                  onChange={(event) => setGroup(event.target.value)}
                >
                  <option value="">{WORDS.newKeysNone}</option>
                  {personal.groups.map((name_) => (
                    <option key={name_} value={name_}>
                      {name_}
                    </option>
                  ))}
                </Select>
                {/* W7-D8, beside the keys: what this harness may never do.
                    With nothing to choose it is one muted sentence and no
                    control — an empty checklist is furniture (P8). */}
                <div className="grid gap-2">
                  <span className={LABEL}>{WORDS.newBoundaries}</span>
                  {personal.boundaries.length === 0 ? (
                    <span className="text-base text-muted">{WORDS.newBoundariesNone}</span>
                  ) : (
                    <>
                      {personal.boundaries.map((boundary) => (
                        <Checkbox
                          key={boundary.id}
                          label={boundary.value}
                          hint={boundary.kind}
                          checked={denies.includes(boundary.id)}
                          onChange={(event) =>
                            setDenies((was) =>
                              event.target.checked
                                ? [...was, boundary.id]
                                : was.filter((id) => id !== boundary.id),
                            )
                          }
                        />
                      ))}
                      <span className="text-xs text-faint">{WORDS.newBoundariesHint}</span>
                    </>
                  )}
                </div>
                {/* Read-only: the model is set on Providers, and this line is
                    here so a first harness is not made in the dark. */}
                <p className="text-base text-muted">
                  {model.text}
                  {model.link && (
                    <>
                      {" "}
                      <a className="underline" href={scopeHref(scope, "/providers/model")}>
                        {WORDS.newModelLink}
                      </a>
                    </>
                  )}
                </p>
              </>
            )}
            {error && (
              <Notice tone="warn">
                <p>{error.message}</p>
                {error.remedy && <p className="text-muted">{error.remedy}</p>}
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{WORDS.newCancel}</Button>
              <Button variant="primary" type="submit" busy={busy}>
                {WORDS.newSubmit}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
