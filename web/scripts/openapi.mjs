#!/usr/bin/env node
/**
 * Fetches `api`'s OpenAPI document and writes the committed snapshot
 * `web/openapi.json` (02 rule 13, D24). Run this, then `openapi-typescript`
 * on the result — `npm run types:generate` does both.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const origin = process.env.HARNESS_API_ORIGIN ?? "http://127.0.0.1:8400";
const out = fileURLToPath(new URL("../openapi.json", import.meta.url));

const response = await fetch(`${origin}/openapi.json`);
if (!response.ok) {
  throw new Error(`Fetching ${origin}/openapi.json failed: ${response.status} ${response.statusText}`);
}
const document = JSON.parse(await response.text());
// Re-serialise with stable formatting so the committed file has a reviewable diff.
writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Wrote ${out}`);
