/**
 * The console view types that `content/` is authored against.
 *
 * These are `console 00 §4` types (`ScaleId`, `Tone`, `ScaleRegistry` — §4.6;
 * `Viewer` — §4.1; `Related` — §4.7), not engine types: neither is declared
 * in `engine/compose/src/contracts.ts` (the engine's `00 §4` transcribed —
 * checked directly), because they aren't engine contracts.
 *
 * `web/lib/views/types.ts` (`docs/console/02-web-standards.md` rule 14, "the
 * one hand-written type file") landed during this task, with a structurally
 * identical transcription of the same console 00 §4 sections. This file
 * re-exports the slice `content/` needs from there — type-only, so it costs
 * nothing at runtime and does not create a module cycle even though
 * `lib/views/scales.ts` and `lib/views/words.ts` import *values*
 * (`SCALES`, `WORDS`) the other way, from `content/`. `content/` still adds
 * nothing `lib/views/types.ts` doesn't already have except `ScreenContent`,
 * which is 05 §3's own shape and has no `00 §4` equivalent.
 */
import type { Related, ScaleId, Viewer } from "@/lib/views/types";

export type { ScaleId, Tone, ScaleRegistry } from "@/lib/views/types";

/** console 00 §4.7. A relationship cell's unit. */
export type RelatedUnit = Related["unit"];

/** console 00 §4.1. The two visibility switches an org admin may hide from a member. */
export type Visibility = Viewer["visibility"];

/** console 00 §4.1. `Viewer.edition` — an org with zero teams renders as `"personal"` (K9, 07). */
export type Edition = Viewer["edition"];

/**
 * 05 §3's per-screen content shape. `Empty` defaults to `string` rather than
 * `keyof typeof EMPTY` to avoid a circular import between `types.ts` and
 * `empty.ts`; every `screens/<screen>.ts` module instantiates it with
 * `EmptyId` (from `./empty`) so the constraint still holds where it matters.
 */
export interface ScreenContent<Column extends string, Verb extends string, Empty extends string = string> {
  title: string;
  /** One sentence; may be `""` for the harness repository view (05 §3) — and,
   *  by the same reasoning, for any other screen whose visible heading comes
   *  from the object it displays rather than from static content. */
  lede: string;
  /**
   * 01 §7.5: the rest of the readme behind the page's name, for a screen
   * that already had explanatory prose somewhere the new header has no room
   * for — a tab's own sentence, most often. One paragraph per entry, after
   * the lede. A screen whose lede says it all has none.
   */
  about?: readonly string[];
  columns: Record<Column, { heading: string; unit?: RelatedUnit; scale?: ScaleId; help: string }>;
  verbs: Record<Verb, { label: string; explain: string }>;
  empty: Empty;
}
