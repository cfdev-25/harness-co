import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `compose` is a sibling workspace package built from source. Resolving it to
// its source keeps these tests honest about the code that will ship, rather
// than whatever `dist/` was last built from (10 rule 17).
export default defineConfig({
	test: { include: ["test/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 30_000 },
	resolve: {
		alias: {
			"@harness/compose/contracts": fileURLToPath(new URL("../compose/src/contracts.ts", import.meta.url)),
			"@harness/compose": fileURLToPath(new URL("../compose/src/index.ts", import.meta.url)),
		},
	},
});
