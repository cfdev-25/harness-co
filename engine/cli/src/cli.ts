#!/usr/bin/env node

import { main } from "./main.js";

// `main` never throws: §12 rule 3 is applied there, so this is only the wiring.
main().then((code) => {
	process.exitCode = code;
});
