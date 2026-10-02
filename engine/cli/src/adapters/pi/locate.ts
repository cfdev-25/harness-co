import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Blocker, HarnessProvider, Located } from "@harness/compose/contracts";
import { repoRoot } from "../../paths.js";

/**
 * The commit and version this CLI was built from (D90). Pi is vendored: the
 * CLI and `pi/packages/coding-agent/dist/bundle/cli.js` are one artefact, so
 * there is nothing on the machine to go looking for — the pin is a build
 * constant and an organisation approving a different commit is told to
 * update the CLI, not to install something.
 */
export const PI_PIN = { commit: "60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759", version: "0.85.1" } as const;

/** The vendored bundle. Shared with `src/auth.ts`, which spawns the same
    bundle for `harness auth pi` — outside the jail, so `/login` can reach
    the provider. */
export function piBundle(): string {
	return resolve(repoRoot(), "pi/packages/coding-agent/dist/bundle/cli.js");
}

export async function locate(pin: HarnessProvider["pin"]): Promise<Located> {
	if (!("repo" in pin)) {
		throw {
			code: "adapter.pin_shape",
			message: "Pi is pinned to a binary version, but Pi ships vendored at a commit.",
			remedy: "Pin Pi to a repo and commit on the Providers screen.",
		} satisfies Blocker;
	}
	if (pin.commit !== PI_PIN.commit) {
		throw {
			code: "adapter.pin_mismatch",
			message: `This CLI ships Pi at ${PI_PIN.commit.slice(0, 8)}; your organisation approved ${pin.commit.slice(0, 8)}.`,
			remedy: "Update the CLI.",
		} satisfies Blocker;
	}
	const path = piBundle();
	await stat(path);
	return { path, version: PI_PIN.version };
}
