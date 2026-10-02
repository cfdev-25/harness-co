import type { Blocker } from "@/lib/views/types";
import { Button } from "./button";
import { Mono } from "./mono";

export interface BlockerCardProps {
  blocker: Blocker;
  /** Admins search for codes; members never see one (05 §11). */
  showCode?: boolean;
  linkLabel?: string;
}

/** The engine's sentences, verbatim; the console adds only the button (R6). */
export function BlockerCard({ blocker, showCode = false, linkLabel }: BlockerCardProps) {
  return (
    <div className="grid gap-2 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <p className="text-base text-fg">{blocker.message}</p>
        {showCode && <Mono>{blocker.code}</Mono>}
      </div>
      <p className="text-base text-muted">{blocker.remedy}</p>
      {blocker.link && linkLabel && (
        <p>
          <Button href={blocker.link}>{linkLabel}</Button>
        </p>
      )}
    </div>
  );
}
