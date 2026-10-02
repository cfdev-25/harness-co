import { SCALES } from "@/content/scales";
import { howHref } from "@/lib/scope";
import type { ScaleId, Tone } from "./types";

/**
 * The console's one reader of the scale registry (K4, 01 §8). `ui/scale-tag`
 * is the only component that calls it; everything else is handed its strings
 * (02 rule 2).
 */
export interface ScaleValue {
  value: string;
  tone: Tone;
  meaning: string;
}

export { SCALES };

/** Registry order, listed once so nothing needs a cast to walk it (05 §9). */
export const SCALE_IDS: ScaleId[] = [
  "approval", "source", "evidence", "slot", "reach", "holds",
  "loads", "role", "request", "session", "preflight", "providerStatus", "provenance",
];

/** Every tag is a link to *How this works* at its scale's anchor. */
export function tagHref(scale: ScaleId): string {
  return SCALES[scale]?.href ?? howHref(scale);
}

export function lookup(scale: ScaleId, value: string): ScaleValue | null {
  return SCALES[scale]?.values.find((entry) => entry.value === value) ?? null;
}

/**
 * D64: an unregistered value throws in development, so a new server value is
 * caught on the first render, and renders neutral-with-a-title in production,
 * because a label must never blank a screen. The branch is a parameter so
 * both halves are testable (V1) wherever `NODE_ENV` is fixed by the bundler.
 */
export function resolveTag(scale: ScaleId, value: string, strict: boolean): ScaleValue {
  const entry = lookup(scale, value);
  if (entry) return entry;
  if (strict) throw new Error(`Unregistered value "${value}" for scale "${scale}"`);
  return { value, tone: "neutral", meaning: "Not yet explained" };
}
