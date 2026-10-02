import type { ScaleId, Tone } from "@/lib/views/types";
import { resolveTag, tagHref } from "@/lib/views/scales";

export interface ScaleTagProps {
  scale: ScaleId;
  value: string;
  size?: "md" | "sm";
}

const TONES: Record<Tone, string> = {
  ok: "border-ok/25 bg-ok-soft text-ok", hold: "border-hold/25 bg-hold-soft text-hold",
  warn: "border-warn/30 bg-warn-soft text-warn", neutral: "border-line bg-sunken text-muted",
  accent: "border-accent/35 bg-accent-soft text-accent-text",
};

/**
 * The only badge on the console, and always a link to its scale (K4, 01 §8).
 * Tone is never a prop: it comes from the registry. An unregistered value
 * throws in development and renders neutral-with-a-title in production (D64).
 */
export function ScaleTag({ scale, value, size = "md" }: ScaleTagProps) {
  const entry = resolveTag(scale, value, process.env.NODE_ENV === "development");
  return (
    <a
      href={tagHref(scale)}
      title={entry.meaning}
      data-scale={scale}
      data-tone={entry.tone}
      className={`inline-flex items-center rounded-md border px-2 font-mono uppercase no-underline ${
        size === "sm" ? "text-2xs" : "text-xs"
      } ${TONES[entry.tone]}`}
    >
      {value}
    </a>
  );
}
