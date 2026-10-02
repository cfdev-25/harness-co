import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** V1: pure view-model functions (00 §10, 02 rule 30) — `lib/**` and its tests. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "test/unit/**/*.test.ts"],
    // vitest's "node" environment has no `window`, so `lib/api.ts` treats
    // every call as server-side and needs an origin to prefix onto the path.
    env: { HARNESS_API_ORIGIN: "http://127.0.0.1:8400" },
  },
});
