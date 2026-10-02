import type { Tone } from "@/lib/views/types";

export interface DotProps {
  tone?: Tone;
  glow?: boolean;
}

const FILL: Record<Tone, string> = {
  ok: "bg-ok", hold: "bg-hold", warn: "bg-warn", accent: "bg-accent", neutral: "bg-faint",
};

const GLOW: Record<Tone, string> = {
  ok: "ring-3 ring-ok/20", hold: "ring-3 ring-hold/20", warn: "ring-3 ring-warn/20",
  accent: "ring-3 ring-accent/25", neutral: "ring-3 ring-faint/20",
};

/** An 8px status point. Never alone — it sits beside the word (01 §10). */
export function Dot({ tone = "neutral", glow = false }: DotProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 shrink-0 rounded-full ${FILL[tone]} ${glow ? GLOW[tone] : ""}`}
    />
  );
}
