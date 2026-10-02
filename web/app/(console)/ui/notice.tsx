import type { ReactNode } from "react";
import type { Tone } from "@/lib/views/types";
import { Dot } from "./dot";

export interface NoticeProps {
  tone?: Tone;
  children: ReactNode;
}

export function Notice({ tone = "neutral", children }: NoticeProps) {
  return (
    <div className="flex gap-3 rounded-lg border border-line bg-sunken px-4 py-3 text-base text-muted">
      <span className="mt-1">
        <Dot tone={tone} glow />
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
