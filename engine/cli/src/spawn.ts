import { type ChildProcess, spawn } from "node:child_process";
import type { Blocker, SpawnPlan } from "@harness/compose/contracts";
import { confine } from "./sandbox/index.js";

export interface SpawnSession {
	dir: string;
	proxyPort: number;
}

/**
 * §8. The probes (row 9) go through the same `confine` call with a probe argv,
 * so the wrapper is identical (06 D88) — nothing typed after `--` can place
 * itself outside the profile, because the wrapper is prepended last.
 */
export function spawnConfined(plan: SpawnPlan, session: SpawnSession, workspace: string): { child: ChildProcess; exited: Promise<number> } {
	// `plan.argv` is already the adapter's argv plus the passthrough (03 §5.7
	// row 5) and `plan.env` is already `childEnvironment` (row 4), so the plan is
	// what runs: there is no second assembly of either here.
	const { command, args } = confine(plan, plan.argv, session);
	const child = spawn(command, args, { stdio: "inherit", env: plan.env, cwd: workspace });
	const exited = new Promise<number>((resolve, reject) => {
		// The binary vanished between `locate` and spawn (§8 step 5).
		child.once("error", () =>
			reject({ code: "cli.spawn_failed", message: `Could not start \`${plan.argv[0]}\`.`, remedy: "`harness preflight provider`" } satisfies Blocker),
		);
		child.once("exit", (code, signal) => resolve(code ?? (signal === null ? 0 : 128 + 2)));
	});
	return { child, exited };
}

/**
 * §8 step 4. `SIGINT`/`SIGTERM` are forwarded to the child; a second `SIGINT`
 * within five seconds sends `SIGKILL`. Returns the teardown so the supervisor
 * can stop listening once the child is gone.
 */
export function forwardSignals(child: ChildProcess): { interrupted: () => boolean; stop: () => void } {
	let first = 0;
	let sawInterrupt = false;
	const onSignal = (signal: "SIGINT" | "SIGTERM") => () => {
		if (signal === "SIGINT") {
			sawInterrupt = true;
			const now = Date.now();
			if (first !== 0 && now - first < 5_000) {
				child.kill("SIGKILL");
				return;
			}
			first = now;
		}
		child.kill(signal);
	};
	const handlers = { SIGINT: onSignal("SIGINT"), SIGTERM: onSignal("SIGTERM") } as const;
	process.on("SIGINT", handlers.SIGINT);
	process.on("SIGTERM", handlers.SIGTERM);
	return {
		interrupted: () => sawInterrupt,
		stop() {
			process.off("SIGINT", handlers.SIGINT);
			process.off("SIGTERM", handlers.SIGTERM);
		},
	};
}
