"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { getToken } from "@/lib/token.client";
import { type SuggestedCommand, type SuggestedCommands, scopeFor } from "@/lib/views/boundaries";
import { BOUNDARIES_TEXT as WORDS } from "@/content/screens/boundaries";
import { Button } from "../../../../ui/button";
import { Mono } from "../../../../ui/mono";
import { Notice } from "../../../../ui/notice";
import { SectionLabel } from "../../../../ui/section-label";

export interface SuggestCommandsProps {
  view: SuggestedCommands;
  /** The node the add is written at: this level, never wider. */
  scopePath: string;
  /** The organization's path: at the top the scope is `"all"` (`scopeFor`). */
  orgPath: string;
}

/**
 * W6-D10's one-click adds, under *Set here* on Boundaries → Commands.
 *
 * `presets/command-boundaries.json` is `managed: suggested`, which means it is
 * **never seeded**: a default that denies something is a decision and the
 * organization makes it. So each entry is a button, with the reason it ships
 * with, and one that is already held says so rather than being offered twice —
 * the same arrangement Reach's starter hosts have (04 §9.1).
 *
 * The reason travels with the add, because the reason is what whoever hits the
 * boundary will read, and a boundary added with somebody else's blank reason
 * is a refusal nobody can act on.
 */
export function SuggestCommands({ view, scopePath, orgPath }: SuggestCommandsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; remedy?: string } | null>(null);
  if (view.suggested.length === 0 || !view.canEdit) return null;

  async function add(one: SuggestedCommand) {
    setBusy(one.value);
    setFailure(null);
    try {
      await request("/v1/boundaries", await getToken(), {
        method: "POST",
        body: JSON.stringify({
          kind: "command",
          value: one.value,
          holds: one.holds,
          reason: one.reason,
          scope: scopeFor(scopePath, orgPath),
          at: scopePath,
        }),
      });
      router.refresh();
    } catch (error) {
      const failed = error instanceof ApiError ? error : null;
      setFailure({ message: failed?.message ?? String(error), remedy: failed?.remedy });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-suggested className="grid gap-3 pt-2">
      <SectionLabel>{WORDS.suggestedCommands}</SectionLabel>
      <p className="text-base text-muted">{WORDS.suggestedCommandsLede}</p>
      <div className="grid gap-2">
        {view.suggested.map((one) => (
          <div key={one.value} className="grid grid-cols-[1fr_auto] items-start gap-3">
            <span className="grid gap-1">
              <Mono>{one.value}</Mono>
              <span className="text-sm text-muted">{one.reason}</span>
            </span>
            {one.present ? (
              <span className="text-xs text-faint">{WORDS.alreadySet}</span>
            ) : (
              <Button size="sm" busy={busy === one.value} onClick={() => void add(one)}>
                {WORDS.addVerb}
              </Button>
            )}
          </div>
        ))}
      </div>
      {failure && (
        <Notice tone="warn">
          <p>{failure.message}</p>
          {failure.remedy && <p>{failure.remedy}</p>}
        </Notice>
      )}
    </div>
  );
}
