import { REFUSALS, type Refusal, type RefusalId } from "@/content/refusals";

/**
 * The one substitution step in the console (05 §7 R10).
 *
 * Every sentence in `content/` that names a person or a team writes it as
 * `{team}`, `{admin}` or `{owner}`; this puts the viewer's own chain in. It
 * lives here rather than in `cells.ts` because a refusal is what it was
 * written for, and nothing else in `lib/views/` may define a second copy —
 * `lib/views/requests.ts` re-exports this one.
 *
 * An unknown placeholder is left as it stands rather than blanked, so a
 * missing name is visible in the sentence instead of silently deleting a word.
 */
export function fill(template: string, names: Record<string, string | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => names[key] ?? whole);
}

export type { Refusal, RefusalId };

/** The sentence a screen renders where the verb would be (04 §19, P13). */
export function refusal(id: RefusalId, names: Record<string, string | undefined> = {}): Refusal {
  const entry: Refusal = REFUSALS[id];
  return {
    sentence: fill(entry.sentence, names),
    ask: entry.ask
      ? { label: fill(entry.ask.label, names), where: fill(entry.ask.where, names) }
      : undefined,
  };
}

/** The common case: the sentence alone, for `PermissionNotCleared.decider`. */
export function refusalSentence(
  id: RefusalId,
  names: Record<string, string | undefined> = {},
): string {
  return fill(REFUSALS[id].sentence, names);
}
