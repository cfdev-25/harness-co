#!/usr/bin/env node
/**
 * The CI drift check (02 rule 13, D24): re-fetches `api`'s OpenAPI document
 * and regenerates `lib/api.generated.ts` into a scratch directory, then
 * diffs both against the committed `openapi.json` and `lib/api.generated.ts`.
 * Never overwrites the committed files — that is `types:generate`'s job.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const origin = process.env.HARNESS_API_ORIGIN ?? "http://127.0.0.1:8400";
const scratch = mkdtempSync(join(tmpdir(), "harness-openapi-"));

try {
  const response = await fetch(`${origin}/openapi.json`);
  if (!response.ok) {
    throw new Error(`Fetching ${origin}/openapi.json failed: ${response.status} ${response.statusText}`);
  }
  const freshOpenapi = `${JSON.stringify(JSON.parse(await response.text()), null, 2)}\n`;
  const scratchOpenapi = join(scratch, "openapi.json");
  writeFileSync(scratchOpenapi, freshOpenapi);

  const scratchTypes = join(scratch, "api.generated.ts");
  execFileSync("npx", ["openapi-typescript", scratchOpenapi, "-o", scratchTypes], {
    cwd: root,
    stdio: "inherit",
  });

  const committedOpenapi = readFileSync(join(root, "openapi.json"), "utf8");
  const committedTypes = readFileSync(join(root, "lib/api.generated.ts"), "utf8");
  const freshTypes = readFileSync(scratchTypes, "utf8");

  let drift = false;
  if (committedOpenapi !== freshOpenapi) {
    console.error("openapi.json is stale — run `npm run types:generate`.");
    drift = true;
  }
  if (committedTypes !== freshTypes) {
    console.error("lib/api.generated.ts is stale — run `npm run types:generate`.");
    drift = true;
  }
  if (!drift) console.log("Generated types match api's OpenAPI document.");
  process.exit(drift ? 1 : 0);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
