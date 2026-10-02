import type { Hidden } from "@/lib/views/types";
import { Notice } from "./notice";

export interface HiddenViewProps {
  view: keyof Hidden;
  /** The note from `content/empty.ts` `HIDDEN` — never a shorter list (P10). */
  note: string;
}

export function HiddenView({ view, note }: HiddenViewProps) {
  return (
    <div data-hidden-view={view} className="py-4">
      <Notice tone="hold">{note}</Notice>
    </div>
  );
}
