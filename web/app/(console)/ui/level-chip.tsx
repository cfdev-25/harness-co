import type { Level } from "@/lib/views/level";

/**
 * Where you are, and whether you may change anything here (01 §7.5).
 *
 * Every screen's `PageHeader` carries one, so no screen needs a level control
 * of its own: the header says the level, the switcher changes it. The
 * sentence is built in `lib/views/level.ts` from the shell's words (02 rule
 * 2: a `ui/` component is given its strings), and a level's word is never the
 * dotted path.
 */
export function LevelChip({ level }: { level: Level }) {
  return (
    <p
      data-level={level.label}
      className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-2xs font-semibold ${
        level.canEdit ? "bg-accent-soft text-accent-text" : "bg-sunken text-muted"
      }`}
    >
      {level.sentence}
    </p>
  );
}
