import { isAbsolute } from "node:path";
import type { Composed } from "@harness/compose/contracts";
import { alert, chooseWorkspace } from "../os/picker.js";
import { shell, type Shell } from "../os/shell.js";
import { openTerminal, runLine } from "../os/terminal.js";
import { blocker, isBlocker, isRefusal, refuse, say } from "../output.js";
import { resolveHarness } from "../review.js";
import { selectAdapter } from "../run.js";

/**
 * §11.24 (W5-D13). What a `harness://` link does when the operating system
 * hands it over. There is no listener and no daemon: the console writes a
 * link, the OS finds this CLI, and this function turns the link into a
 * terminal the person is looking at.
 *
 * Everything here happens *before* there is a terminal, so every refusal is
 * a window as well as a line.
 */

export interface Link {
	harness: string;
	provider: string;
	workspace?: string;
}

const SHAPE = "harness://run?harness=<harness id>&provider=<provider id>";

/** The only shape this CLI answers to. Anything else is a sentence. */
export function parseLink(url: string | undefined): Link {
	let parsed: URL;
	try {
		parsed = new URL(url ?? "");
	} catch {
		refuse("cli.link_malformed", `\`${url ?? ""}\` is not a link this CLI understands.`, `A harness link looks like \`${SHAPE}\`.`);
	}
	const harness = parsed.searchParams.get("harness") ?? "";
	const provider = parsed.searchParams.get("provider") ?? "";
	const ok = parsed.protocol === "harness:" && parsed.hostname === "run" && (parsed.pathname === "" || parsed.pathname === "/") && harness !== "" && provider !== "";
	if (!ok) refuse("cli.link_malformed", `\`${url}\` is not a link this CLI understands.`, `A harness link looks like \`${SHAPE}\`.`);
	const workspace = parsed.searchParams.get("workspace") ?? undefined;
	// A relative path from a link would resolve against whatever directory the
	// operating system happened to launch us in, which is nobody's choice.
	if (workspace !== undefined && !isAbsolute(workspace)) {
		refuse("cli.link_malformed", `\`${workspace}\` is not an absolute path, so it names no folder on this machine.`, `A harness link looks like \`${SHAPE}\`.`);
	}
	return { harness, provider, workspace };
}

/**
 * §11.24. `load` is rows 0–2 (login, fetch, compose) — the same ones `run`
 * does, so a link is checked against the person's real composition and not
 * against the page that drew it.
 */
export async function openLink(url: string | undefined, load: () => Promise<Composed>, os: Shell = shell()): Promise<number> {
	try {
		const link = parseLink(url);
		const composed = await load();
		// The harness by id or name, and the provider both in this CLI's
		// registry and in the organisation's list. A stale bookmark for a
		// harness the person has left is a sentence, not a session.
		const harness = await resolveHarness(composed, link.harness);
		selectAdapter(link.provider);
		if (composed.policy.harnessProviders[link.provider] === undefined) {
			refuse(
				"cli.provider_not_listed",
				`Your organisation does not list \`${link.provider}\` as a runtime, so this link cannot start a session.`,
				`Runtimes you have: ${Object.keys(composed.policy.harnessProviders).join(", ") || "none"}.`,
			);
		}

		const workspace = await folder(os, link);
		if (workspace === null) return 0;

		if (!(await openTerminal(os, workspace, link.provider, harness.id))) {
			say(`No terminal this CLI knows how to open is installed. In ${workspace}, run:`);
			say(`  ${runLine(link.provider, harness.id)}`);
			return 1;
		}
		say(`Opening ${harness.name} in ${workspace}.`);
		return 0;
	} catch (thrown) {
		// No terminal exists yet, so the window is the only place a person
		// would see this; the line is printed too, for whoever typed it.
		const message = isBlocker(thrown) || isRefusal(thrown) ? thrown.message : null;
		if (message === null) throw thrown;
		await alert(os, isBlocker(thrown) ? `${message}\n\n${thrown.remedy}` : message);
		if (isBlocker(thrown)) blocker(thrown);
		else console.error(message);
		return 1;
	}
}

/** The workspace the link named, or the one the person picks. `null` is a
    cancel: nothing went wrong, and nothing was started. */
async function folder(os: Shell, link: Link): Promise<string | null> {
	if (link.workspace !== undefined) {
		if (!(await os.exists(link.workspace))) {
			refuse("cli.workspace_gone", `There is no folder at ${link.workspace} on this machine any more.`, "Use the card's own button, which asks where to run.");
		}
		return link.workspace;
	}
	const chosen = await chooseWorkspace(os);
	if (chosen.kind === "folder") return chosen.path;
	if (chosen.kind === "cancelled") {
		say(chosen.sentence);
		return null;
	}
	refuse("cli.no_picker", chosen.sentence, `In the folder you want, run: ${runLine(link.provider, link.harness)}`);
}
