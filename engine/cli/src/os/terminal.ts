import { join } from "node:path";
import { appleString, type Shell, word } from "./shell.js";

/**
 * W5-D13's last step. A session is a terminal the person watches, so the link
 * ends by opening one in the chosen folder with `harness run` already in it.
 * Nothing here is a jail or a session: that is `run`'s, unchanged.
 */

/** What the terminal will be running, as a person would type it. */
export const runLine = (provider: string, harnessId: string): string => `harness run ${provider} --harness ${harnessId}`;

/** The same, absolute, because a terminal a handler opened inherits no PATH. */
const argv = (os: Shell, provider: string, harnessId: string): string[] => [os.script, "run", provider, "--harness", harnessId];

/** A one-shot script, so the terminal ends up in the folder and nowhere else. */
function starter(os: Shell, dir: string, provider: string, harnessId: string): string {
	return `#!/bin/sh\ncd ${word(dir)} || exit 1\nexec ${word(os.node)} ${word(os.script)} run ${provider} --harness ${harnessId}\n`;
}

/**
 * Opens a terminal in `dir` running the session. `false` means this machine
 * has no terminal this CLI knows how to open, and the caller says what to
 * type instead — never a silent nothing, which is the one failure a link
 * must not have.
 */
export async function openTerminal(os: Shell, dir: string, provider: string, harnessId: string): Promise<boolean> {
	if (os.platform === "win32") {
		if (await os.has("wt")) {
			os.spawnDetached("wt", ["-d", dir, os.node, ...argv(os, provider, harnessId)]);
			return true;
		}
		os.spawnDetached("cmd", ["/c", "start", "Harness", "cmd", "/k", `cd /d "${dir}" && "${os.node}" "${os.script}" run ${provider} --harness ${harnessId}`]);
		return true;
	}

	const tmp = await os.tmp();
	const script = join(tmp, os.platform === "darwin" ? "harness-run.command" : "harness-run.sh");
	await os.write(script, starter(os, dir, provider, harnessId), 0o700);

	if (os.platform === "darwin") {
		// `open -a` hands the script to the terminal application, which runs it
		// and stays open. iTerm is honoured only when `harness open` was typed
		// in an iTerm shell: an Apple Event from a link carries no TERM_PROGRAM.
		if (os.env.TERM_PROGRAM === "iTerm.app") {
			await os.run("osascript", ["-e", `tell application "iTerm" to create window with default profile command "${appleString(script)}"`]);
			return true;
		}
		await os.run("open", ["-a", "Terminal", script]);
		return true;
	}

	if (await os.has("x-terminal-emulator")) {
		os.spawnDetached("x-terminal-emulator", ["-e", script]);
		return true;
	}
	if (await os.has("gnome-terminal")) {
		os.spawnDetached("gnome-terminal", [`--working-directory=${dir}`, "--", os.node, ...argv(os, provider, harnessId)]);
		return true;
	}
	return false;
}
