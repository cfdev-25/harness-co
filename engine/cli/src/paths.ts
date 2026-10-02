import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The checkout this CLI was installed from. Everything it has to reach
 * outside its own package — the vendored Pi bundle, the Pi extension, the
 * theme — is under `pi/` (00 §2), and a relative hop from the adapter's own
 * file broke the moment the package moved (09 M0: "a fresh checkout fails at
 * spawn"). Computed once, from this file, so the next move is one line.
 *
 * `src/` and `dist/` sit at the same depth under the package, so this is the
 * same answer under vitest and from the built CLI.
 */
export function repoRoot(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/**
 * A single path segment, and nothing that could climb out of one. Asset names
 * arrive from a branch somebody else pushed, so they are never trusted as paths.
 */
export function safeName(name: string): string {
	const clean = basename(name);
	if (name === "" || clean !== name || name === "." || name === "..") throw new Error(`Unsafe asset name: ${name}`);
	return clean;
}
