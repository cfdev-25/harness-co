#!/usr/bin/env node
import { compose } from "../compose.js";
import { gitReader } from "../reader-git.js";

/**
 * `compose-chain <repo.git> <chain-json>` → the `Composed` as JSON on stdout.
 *
 * The migration exporter's acceptance test (02 §11.2 step 5) is Python and
 * composition is TypeScript (00 D2, one implementation), so the two meet at a
 * process boundary rather than at a second copy of the algorithm.
 */
const [repo, chain] = process.argv.slice(2);
if (!repo || !chain) {
	process.stderr.write("usage: compose-chain <repo.git> <chain-json>\n");
	process.exit(2);
}
process.stdout.write(`${JSON.stringify(await compose(JSON.parse(chain), gitReader(repo)))}\n`);
