"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import {
  type ReachMode,
  type ReachView,
  inheritedLines,
  ownStep,
  reachLine,
  suggestions,
} from "@/lib/views/reach";
import type { Viewer } from "@/lib/views/types";
import { REACH_MODES, REACH_TEXT as WORDS } from "@/content/screens/boundaries";
import { Button } from "../../../../ui/button";
import { Field } from "../../../../ui/field";
import { Line } from "../../../../ui/line";
import { Mono } from "../../../../ui/mono";
import { Notice } from "../../../../ui/notice";
import { SectionLabel } from "../../../../ui/section-label";

export interface ReachSectionProps {
  view: ReachView;
  viewer: Viewer;
  /** The scope as `api` spells it (`lib/scope.ts scopeQuery`), which is what
   *  all four reach routes take. */
  scopeQuery: string;
}

interface Failure {
  message: string;
  remedy?: string;
}

/**
 * Reach — the section at the top of Boundaries (04 §9, W5-D5, engine D131,
 * D136). Three things, in the order a person needs them: what is inherited
 * from above, what this level sets, and the starter list.
 *
 * Every control writes through `lib/api.ts` and then `router.refresh()`
 * (02 rule 20) — no optimistic update, because reach only ever narrows and
 * the server is the one that knows whether a step did. A widening the server
 * refuses is rendered in the server's own sentence beside the control that
 * caused it (rule 21), never pre-empted by a disabled button (P13).
 *
 * `canEdit` comes from `ReachView`; without it the same three facts render as
 * text with the chip's *read and use* sentence, because a person who cannot
 * set reach still needs to know how far their own sessions go.
 */
export function ReachSection({ view, viewer, scopeQuery }: ReachSectionProps) {
  const router = useRouter();
  const own = ownStep(view);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [draft, setDraft] = useState("");
  // Rule 19: state holds only what is not yet true. A radio is checked the
  // moment it is clicked, and the server's answer replaces it on the refresh;
  // without this the control would snap back for the length of a round trip.
  const [chosen, setChosen] = useState<ReachMode | null>(null);
  // `null` until this node has a file of its own: nothing is chosen here yet,
  // and the note under the radios says what it is using instead.
  const mode = chosen ?? own?.mode ?? null;
  const inherited = inheritedLines(view, viewer);
  const offered = suggestions(view);
  const query = `?scope=${scopeQuery}`;

  async function write(key: string, path: `/v1/${string}`, init: RequestInit) {
    setBusy(key);
    setFailure(null);
    try {
      await request(path, await getToken(), init);
      setDraft("");
      router.refresh();
    } catch (error) {
      const failed = error instanceof ApiError ? error : null;
      setFailure({ message: failed?.message ?? String(error), remedy: failed?.remedy });
      setChosen(null);
    } finally {
      setBusy(null);
    }
  }

  /** `PUT` is the whole file, so the mode arrives with the whole list: an
   *  allow-list is not a deny-list, and carrying one over as the other would
   *  turn *reach these three* into *reach anything but these three* in one
   *  click. The list starts empty and the radio's sentence says so (04 D87). */
  const setMode = (next: ReachMode) => {
    setChosen(next);
    return write(`mode-${next}`, `/v1/reach${query}`, {
      method: "PUT",
      body: JSON.stringify({ mode: next, hosts: [] }),
    });
  };

  const addHost = (host: string) =>
    write(`add-${host}`, `/v1/reach/hosts${query}`, {
      method: "POST",
      body: JSON.stringify({ host }),
    });

  const removeHost = (host: string) =>
    write(`remove-${host}`, `/v1/reach/hosts/${encodeURIComponent(host)}${query}`, {
      method: "DELETE",
    });

  return (
    <section data-reach className="grid gap-5">
      <div className="grid gap-1">
        <h2 className="text-md font-bold tracking-[-0.01em]">{WORDS.title}</h2>
        <p className="text-base text-muted">{WORDS.lede}</p>
      </div>

      <div className="grid gap-2">
        <SectionLabel>{WORDS.inherited}</SectionLabel>
        {inherited.length === 0 ? (
          <p className="text-base text-muted">{WORDS.inheritedNone}</p>
        ) : (
          <>
            {inherited.map((line) => <Line key={line.node} name={line.text} />)}
            {/* The composed answer, once, and only where a walk produced it:
                at the top of the walk it would only repeat the radio below. */}
            <Line name={`${WORDS.effective}: ${reachLine(view.effective, viewer)}`} />
          </>
        )}
      </div>

      <div className="grid gap-3">
        <SectionLabel>{WORDS.here}</SectionLabel>
        {!view.canEdit && <Notice tone="hold">{WORDS.readOnly}</Notice>}
        {mode === null && <p className="text-base text-muted">{WORDS.notSetHere}</p>}
        <div className="grid gap-3">
          {REACH_MODES.map((each) => (
            <label key={each} className="grid grid-cols-[auto_1fr] items-start gap-3">
              <input
                type="radio"
                name="reach-mode"
                value={each}
                checked={mode === each}
                disabled={!view.canEdit || busy !== null}
                onChange={() => void setMode(each)}
                className="mt-1"
              />
              <span className="grid gap-1">
                <span className="font-semibold text-fg">{WORDS.modes[each].label}</span>
                <span className="text-sm text-muted">{WORDS.modes[each].sentence}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* The list is this node's file, so it is shown only for the mode that
          file is in: between a mode change and the index catching up,
          `chosen` has moved and `own` has not, and an allow-list drawn
          under *Hosts a session may not reach* would be a lie. */}
      {own !== null && mode === own.mode && mode !== "off" && (
        <div className="grid gap-2">
          <SectionLabel>{mode === "allow" ? WORDS.hostsAllow : WORDS.hostsOn}</SectionLabel>
          {own.hosts.length === 0 ? (
            <p className="text-base text-muted">
              {mode === "allow" ? WORDS.noHostsAllow : WORDS.noHostsOn}
            </p>
          ) : (
            own.hosts.map((host) => (
              <Line
                key={host}
                name={host}
                aside={
                  view.canEdit ? (
                    <Button
                      size="sm"
                      variant="danger"
                      busy={busy === `remove-${host}`}
                      onClick={() => void removeHost(host)}
                    >
                      {WORDS.removeVerb}
                    </Button>
                  ) : undefined
                }
              />
            ))
          )}
          {view.canEdit && (
            <form
              className="flex items-start gap-2 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (draft.trim()) void addHost(draft.trim());
              }}
            >
              <span className="flex-1">
                <Field
                  label={WORDS.addLabel}
                  hint={WORDS.addHint}
                  name="reach-host"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </span>
              <Button variant="primary" type="submit" busy={busy === `add-${draft.trim()}`}>
                {WORDS.addVerb}
              </Button>
            </form>
          )}
        </div>
      )}

      {offered.length > 0 && view.canEdit && (
        <div className="grid gap-2">
          <SectionLabel>{WORDS.suggested}</SectionLabel>
          <p className="text-base text-muted">{WORDS.suggestedLede}</p>
          <div className="flex flex-wrap gap-2">
            {offered.map((one) =>
              one.present ? (
                <span key={one.host} className="flex h-6 items-center gap-2 rounded-md border border-hairline px-2 text-xs">
                  <Mono>{one.host}</Mono>
                  <span className="text-faint">{WORDS.alreadyAllowed}</span>
                </span>
              ) : (
                <Button
                  key={one.host}
                  size="sm"
                  busy={busy === `add-${one.host}`}
                  onClick={() => void addHost(one.host)}
                >
                  {one.host}
                </Button>
              ),
            )}
          </div>
        </div>
      )}

      {failure && (
        <Notice tone="warn">
          <p>{failure.message}</p>
          {failure.remedy && <p>{failure.remedy}</p>}
        </Notice>
      )}
    </section>
  );
}
