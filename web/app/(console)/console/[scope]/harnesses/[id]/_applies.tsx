import type { HarnessView } from "@/lib/views/harness";
import { boundTo, boundaryLists } from "@/lib/views/harness";
import { scopeHref } from "@/lib/scope";
import { mayRemove } from "@/lib/views/boundaries";
import { fill } from "@/lib/views/refusals";
import { type EffectiveReach, reachSaid, reachSetByNote } from "@/lib/views/reach";
import type { Scope, Viewer } from "@/lib/views/types";
import { HIDDEN } from "@/content/empty";
import { navFor } from "../../../../shell/nav";
import { HARNESS_WORDS as WORDS } from "@/content/screens/harness";
import { REACH_TEXT } from "@/content/screens/boundaries";
import { HiddenView } from "../../../../ui/hidden-view";
import { Line } from "../../../../ui/line";
import { ScaleTag } from "../../../../ui/scale-tag";
import { SectionLabel } from "../../../../ui/section-label";
import { BindBoundary, UnbindBoundary } from "./_bind";
import { Commands } from "./_commands";

export interface AppliesHereProps {
  view: HarnessView;
  scope: Scope;
  viewer: Viewer;
  /**
   * `HarnessView.reach` — the chain's reach narrowed by the harness's own
   * step (D131, W5-D7). `null` only for a response written before the field
   * landed, where the line reads *not set* rather than guessing at `off`.
   */
  reach: EffectiveReach | null;
}

/** *Reach: allow-list, 6 hosts*, with *set by Marketing* under it. The aside
 *  is one narrow column and `Line` truncates, so the answer and the node that
 *  decided it are the row's name and its note rather than one clipped
 *  sentence. The words are Reach's own (`lib/views/reach.ts`), so this row,
 *  the header cell above it and the Boundaries screen cannot disagree. */
function appliesReach(view: HarnessView, viewer: Viewer, reach: EffectiveReach | null) {
  const what = reach === null ? REACH_TEXT.notSet : reachSaid(reach);
  return {
    name: fill(WORDS.aside.reachAs, { what }),
    note: reachSetByNote(reach, viewer, harnessName(view)) || undefined,
  };
}

/** `setBy` may be this harness itself (`harness:<id>`), and an id is never
 *  shown to a person: the page already knows the name. */
function harnessName(view: HarnessView): Record<string, string> {
  return { [view.def.id]: view.def.name };
}

/**
 * 04 §5's *Applies here*: what holds on this harness — its reach, the
 * boundaries covering it, and the security groups whose grants cover it,
 * **in full** (P17 — a refusal you cannot look up is a bug).
 *
 * A row links to the screen that sets it only when this level *has* that
 * screen for this viewer — `navFor` is the one function that decides which
 * screens a level has (01 §4.4), so the section and the sidebar cannot
 * disagree. Everyone else reads the same words without a link, because a
 * link that only refuses is worse than plain text (P13). At *me* there is no
 * Boundaries screen and no Security groups screen: an organization's
 * boundary is not a person's to change. When an organization admin has
 * turned boundaries
 * off for this person the block is a `HiddenView` naming the decision, never
 * a shorter list (P10, S7).
 */
export function AppliesHere({ view, scope, viewer, reach }: AppliesHereProps) {
  const hidden = view.hidden?.boundaries;
  const has = new Set(navFor(scope, viewer).flatMap((group) => group.items.map((i) => i.key)));
  const boundariesHref = has.has("boundaries") ? scopeHref(scope, "/boundaries") : undefined;
  // W7-D8: `HarnessView.boundaries` is every boundary on the chain, so the
  // rows that reach this harness are separated from the harness-scoped ones it
  // could be bound to. The verbs go only to a viewer the api would let write
  // the row — the rule *Remove* on Boundaries already follows, asked again
  // here, because binding edits the row where it was set.
  const { here, bindable } = boundaryLists(view.boundaries, view.def.id);
  const mayWrite = (boundary: (typeof here)[number]) =>
    mayRemove(boundary, scope, viewer.role.level);
  const choices = bindable
    .filter(mayWrite)
    .map((boundary) => ({ id: boundary.id, value: boundary.value, kind: boundary.kind }));
  return (
    <div className="grid content-start gap-6 border-l border-hairline px-4 py-5">
      <h2 className="text-md font-bold tracking-[-0.01em]">{WORDS.aside.title}</h2>
      <Line {...appliesReach(view, viewer, reach)} href={boundariesHref} />
      <section className="grid gap-2">
        <SectionLabel>{WORDS.aside.boundaries}</SectionLabel>
        {hidden ? (
          <HiddenView view="boundaries" note={HIDDEN.boundaries} />
        ) : here.length === 0 ? (
          <p className="text-base text-muted">{WORDS.aside.noBoundaries}</p>
        ) : (
          here.map((boundary) => (
            <Line
              key={boundary.id}
              name={boundary.value}
              note={boundary.setBy?.path ?? boundary.reason}
              href={boundariesHref}
              aside={
                <span className="flex items-center gap-2">
                  <ScaleTag scale="holds" value={boundary.holds} size="sm" />
                  {/* Only a row this level bound to this harness: one that
                      applies to every harness is not this page's to change. */}
                  {boundTo(boundary) !== null && mayWrite(boundary) && (
                    <UnbindBoundary harnessId={view.def.id} boundaryId={boundary.id} />
                  )}
                </span>
              }
            />
          ))
        )}
        {!hidden && choices.length > 0 && (
          <div className="justify-self-start">
            <BindBoundary harnessId={view.def.id} choices={choices} />
          </div>
        )}
      </section>
      <section className="grid gap-2">
        <SectionLabel>{WORDS.aside.groups}</SectionLabel>
        {view.groups.length === 0 ? (
          <p className="text-base text-muted">{WORDS.aside.noGroups}</p>
        ) : (
          view.groups.map((group) => (
            <Line
              key={group.grant}
              name={group.name}
              note={group.grant}
              href={
                has.has("groups")
                  ? scopeHref(scope, `/groups/${encodeURIComponent(group.name)}`)
                  : undefined
              }
            />
          ))
        )}
      </section>
      <Commands />
    </div>
  );
}
