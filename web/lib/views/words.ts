import { WORDS } from "@/content/words";

/**
 * The vocabulary's one reader (05 §5, §10). `ui/word` calls it; nothing else
 * does, and no component takes prose (P8).
 */
export type WordId = keyof typeof WORDS;

export { WORDS };

export function wordOf(id: WordId) {
  return WORDS[id] ?? null;
}
