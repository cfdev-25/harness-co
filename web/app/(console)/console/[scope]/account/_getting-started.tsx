"use client";

import type { SetupStep } from "@/lib/views/account";
import { GETTING_STARTED } from "@/content/screens/account";
import { Button } from "../../../ui/button";
import { Icon } from "../../../ui/icons";
import { Mono } from "../../../ui/mono";

/**
 * W7-D5, 04 §17. Four rows in the order they are done: a check with the fact
 * that closed it, or the step with exactly one thing on it — a link to press.
 * Nothing here is a button that does the step for the person: three of the
 * four happen on their machine (D40), and the two commands that do them are
 * printed in one place, which the first two rows link to (D105).
 *
 * The rows are `gettingStarted(viewer)`'s, and it answers `null` for an
 * enterprise account and for a personal one that has done all four, so the
 * card is absent rather than complete.
 */
export function GettingStarted({ steps }: { steps: SetupStep[] }) {
  return (
    <div className="grid gap-4" data-getting-started>
      <ol className="grid gap-3">
        {steps.map((step) => (
          <li key={step.key} className="grid gap-1" data-step={step.key}>
            <div className="flex items-baseline gap-2">
              <span
                aria-hidden
                className={step.done ? "text-ok" : "text-faint"}
                data-check={step.done ? "done" : "todo"}
              >
                {step.done ? <Icon name="check" size={14} /> : <Icon name="minus" size={14} />}
              </span>
              <span className={step.done ? "text-base text-muted" : "text-base font-semibold text-fg"}>
                {step.step}
              </span>
              {step.done && step.fact && <span className="text-sm text-muted">— {step.fact}</span>}
            </div>
            {step.link && (
              <div className="pl-6">
                <Button href={step.link.href} variant="primary">
                  {step.link.label}
                </Button>
              </div>
            )}
            {step.note && (
              <p className="pl-6 text-sm text-muted">
                {sentence(step.note, step.noteCommand)}
              </p>
            )}
          </li>
        ))}
      </ol>
      <p className="text-xs text-faint">{GETTING_STARTED.note}</p>
    </div>
  );
}

/** `{command}` in a content sentence is monospace; the sentence stays whole
 *  in `content/` (05 R1) and the screen decides the type. */
function sentence(text: string, command?: string) {
  const [before, after = ""] = text.split("{command}");
  if (command === undefined) return text;
  return (
    <>
      {before}
      <Mono>{command}</Mono>
      {after}
    </>
  );
}
