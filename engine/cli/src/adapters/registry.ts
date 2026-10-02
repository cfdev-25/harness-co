import type { Adapter } from "@harness/compose/contracts";
import { claudeAdapter } from "./claude/index.js";
import { pi } from "./pi/index.js";

/** Every provider `harness run <word>` can boot, keyed by that word. */
export const adapters: Record<string, Adapter> = { [pi.id]: pi, [claudeAdapter.id]: claudeAdapter };
