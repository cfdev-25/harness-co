// The entry `scripts/dev-definitions.sh` runs under `node --watch-path`:
// `dist/index.js` exports `start` and has no entry of its own, and `--watch`
// cannot wrap `--eval`, so the three lines live here instead of inline.
import { start, configFromEnv } from "../engine/definitions/dist/index.js";

const servers = await start(configFromEnv());
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => void servers.close().then(() => process.exit(0)));
}
