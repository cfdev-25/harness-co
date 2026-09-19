import { claude } from "./claude.js";
import { pi } from "./pi.js";
import type { Adapter } from "./types.js";

/**
 * Every agent `harness run` can boot, keyed by the id it accepts on the
 * command line.
 */
export const adapters: Record<string, Adapter> = { [pi.id]: pi, [claude.id]: claude };
