import { join } from "node:path";
import { rm } from "node:fs/promises";
import { readVersions } from "./hydrate.js";
import { rowCompose, rowFetch, rowHydrate, whoIs } from "./boot.js";
import { adopt } from "./commands/adopt.js";
import { auth } from "./commands/auth.js";
import { commands } from "./commands/commands.js";
import { diff } from "./commands/diff.js";
import { importSetup } from "./commands/import.js";
import { keysAdd } from "./commands/keys.js";
import { log } from "./commands/log.js";
import { login, whoami } from "./commands/login.js";
import { newHarness, pushFile } from "./commands/new.js";
import { offer, withdraw } from "./commands/offer.js";
import { providers, type ProviderVerb } from "./commands/providers.js";
import { keyFor, pushKey } from "./commands/push.js";
import { joinHarness, leaveHarness, refuseIfRequired, removeOwnCopy, resolveHarness } from "./review.js";
import { reset } from "./commands/reset.js";
import { openLink } from "./commands/open.js";
import { setup, unregister } from "./commands/setup.js";
import { status } from "./commands/status.js";
import { switchHarness } from "./commands/switch.js";
import { assetsRoot } from "./selection.js";
import { readCredentials } from "./credentials.js";
import { blocker, isBlocker, isRefusal, say } from "./output.js";
import { bad } from "./style.js";
import { type RunArgv, run } from "./run.js";

export const VERSION = "0.1.0";

/** §11.20's three verbs; anything else after `providers` is a usage error. */
const PROVIDER_VERBS = ["approve", "beta", "decline"] as const;

/** 03's sections, which `preflight` takes as bare words (§11.13). */
const SECTIONS = ["identity", "harness", "provider", "model", "credentials", "reach", "assets", "drift", "local", "env"] as const;

/** Flags `run`'s grammar must not mistake for a harness name (§6). */
const RESERVED = new Set(["--help", "-h", "--version", "-v", "--team", "--offline", "--non-interactive", "--json", "--unregister"]);
const VALUED = new Set(["--as", "--model", "--message", "--title", "--from", "--api-url", "--token", "--workspace", "--logout", "--reason", "--teams", "--harness"]);

interface Parsed {
	words: string[];
	flags: Set<string>;
	values: Record<string, string>;
	passthrough: string[];
	dashed: string[];
}

/** One pass over argv. Everything after `--` is the provider's, verbatim and unread. */
export function parse(argv: string[], valued: ReadonlySet<string> = VALUED): Parsed {
	const cut = argv.indexOf("--");
	const before = cut < 0 ? argv : argv.slice(0, cut);
	const parsed: Parsed = { words: [], flags: new Set(), values: {}, passthrough: cut < 0 ? [] : argv.slice(cut + 1), dashed: [] };
	for (let at = 0; at < before.length; at++) {
		const arg = before[at];
		if (!arg.startsWith("-")) {
			parsed.words.push(arg);
		} else if (valued.has(arg)) {
			const value = before[at + 1];
			if (value === undefined) throw usage(`${arg} needs a value.`);
			parsed.values[arg] = value;
			at += 1;
		} else {
			parsed.flags.add(arg);
			if (!RESERVED.has(arg)) parsed.dashed.push(arg);
		}
	}
	return parsed;
}

/** §12 rule 5: a usage error is exit 2, and is never a `Blocker`. */
class Usage extends Error {}
const usage = (message: string) => new Usage(message);

/**
 * §6's grammar: exactly one undashed word before `--` is the provider; at most
 * one dashed word that is not a reserved flag is the harness.
 */
export function parseRun(argv: string[], sections: readonly string[] = []): RunArgv {
	const parsed = parse(argv);
	// §11.13 takes section names as bare words alongside the provider word, so a
	// section is partitioned out before §6's "exactly one undashed word" applies.
	const named = parsed.words.filter((word) => sections.includes(word));
	parsed.words = parsed.words.filter((word) => !sections.includes(word));
	if (parsed.words.length > 1) {
		throw usage(`\`harness run\` takes one provider name; provider arguments go after \`--\`, e.g. \`harness run ${parsed.words[0]} -- ${parsed.words.slice(1).join(" ")}\`.`);
	}
	if (parsed.dashed.length > 1) throw usage(`\`harness run\` takes one harness flag; you gave ${parsed.dashed.join(" and ")}.`);
	return {
		provider: parsed.words[0],
		// `--<name>` is the shorthand; `--harness <name>` is the spelling every
		// other verb takes (D118) and the one a `harness://` link generates
		// (W5-D13), so `run` reads both and neither is a second grammar.
		harnessFlag: parsed.dashed[0]?.replace(/^--/, "") ?? parsed.values["--harness"],
		team: parsed.flags.has("--team"),
		as: parsed.values["--as"],
		model: parsed.values["--model"],
		offline: parsed.flags.has("--offline"),
		nonInteractive: parsed.flags.has("--non-interactive"),
		json: parsed.flags.has("--json"),
		sections: named,
		passthrough: parsed.passthrough,
	};
}

/** Rows 1–2, for the commands that read the composition but start no session. */
async function composition(offline: boolean) {
	const credentials = await readCredentials();
	const me = await whoIs(credentials);
	return { credentials, me, composed: await rowCompose(await rowFetch(credentials, me, offline)) };
}

async function dispatch(command: string, argv: string[]): Promise<number> {
	const parsed = parse(argv);
	const has = (flag: string) => parsed.flags.has(flag);
	const value = (flag: string) => parsed.values[flag];
	const message = () => {
		const one = value("--message");
		if (one === undefined) throw usage("`--message \"…\"` is required.");
		return one;
	};

	switch (command) {
		case "run":
			return run(parseRun(argv), true);
		case "preflight":
		case "doctor": // D101: an alias for one release.
			return run(parseRun(argv, SECTIONS), false);
		case "pull": {
			// Rows 1–3, and no selection is read (S2).
			const { composed } = await composition(has("--offline"));
			await rowHydrate(composed);
			say("Up to date. `harness status` shows what you have changed.");
			return 0;
		}
		case "switch": {
			const { composed } = await composition(false);
			return switchHarness(composed, parsed.words[0], has("--team"), has("--none"));
		}
		case "new": {
			// D116's two admin forms. `--team` takes a value here and nowhere else:
			// `run` and `switch` read it as the per-run flag (D102).
			const args = parse(argv, new Set([...VALUED, "--team"]));
			const name = args.words[0];
			if (name === undefined) throw usage('`harness new "<name>"` needs a name.');
			const team = args.values["--team"];
			if (team !== undefined && args.flags.has("--org")) throw usage("`--team <path>` and `--org` are the two forms; give one of them.");
			const { credentials, me, composed } = await composition(false);
			return newHarness(credentials, me, composed, name, args.values["--from"], args.flags.has("--org") ? "org" : team);
		}
		case "status":
			return status(has("--json"));
		case "diff":
			return diff(parsed.words[0], has("--team"), has("--git"));
		case "log":
			return log(parsed.words[0], has("--team"), has("--git"));
		case "remove": {
			if (parsed.words.length === 0) throw usage("`harness remove <path…> [--harness <name>]` needs a path.");
			const credentials = await readCredentials();
			const me = await whoIs(credentials);
			const composed = await rowCompose(await rowFetch(credentials, me, true));
			await resolveHarness(composed, value("--harness"));
			const keys = parsed.words.map(keyFor);
			// D120: against the delivery, since the directories may already be gone.
			const versions = await readVersions("refs/harness/remote");
			// W5-D10: refused before anything is deleted, not after.
			refuseIfRequired(versions, keys);
			for (const key of keys) {
				await removeOwnCopy(credentials, me, versions, key);
				await rm(join(assetsRoot(), key), { recursive: true, force: true });
			}
			await leaveHarness(composed, (file, body, note) => pushFile(credentials, me, file, body, note), versions, keys, value("--harness"));
			return 0;
		}
		case "push": {
			const path = parsed.words[0];
			if (path === undefined) throw usage("`harness push <path> --message \"…\"` needs a path.");
			const credentials = await readCredentials();
			const me = await whoIs(credentials);
			// D118: the harness is settled first, so a refusal leaves nothing loose.
			const composed = await rowCompose(await rowFetch(credentials, me, true));
			await resolveHarness(composed, value("--harness"));
			const key = keyFor(path);
			await pushKey(credentials, me, key, message());
			await joinHarness(composed, (file, body, note) => pushFile(credentials, me, file, body, note), [key], value("--harness"));
			return 0;
		}
		case "offer": {
			if (parsed.words.length === 0) throw usage("`harness offer <path> --message \"…\"` needs a path.");
			const credentials = await readCredentials();
			return offer(credentials, await whoIs(credentials), parsed.words, message(), value("--title"));
		}
		case "withdraw": {
			const id = parsed.words[0];
			if (id === undefined) throw usage("`harness withdraw <request-id>` needs a request id.");
			return withdraw(await readCredentials(), id);
		}
		case "reset": {
			// `--all` is scoped by the selected harness, which only the chain holds;
			// a single key needs no network at all.
			const harnesses = has("--all") ? (await composition(has("--offline"))).composed.harnesses : [];
			return reset(parsed.words[0], has("--all"), has("--yes"), harnesses);
		}
		case "adopt": {
			const path = parsed.words[0];
			if (path === undefined) throw usage("`harness adopt <path>` needs a path.");
			// The kinds are the organization's, so this one needs the composition.
			const { composed } = await composition(false);
			return adopt(path, has("--new-id"), composed.policy.kinds);
		}
		case "import": {
			const provider = parsed.words[0];
			if (provider === undefined) throw usage("`harness import <provider>` needs a provider.");
			return importSetup(provider, value("--from"), value("--workspace"));
		}
		case "login":
			return login(value("--api-url"), value("--token"));
		case "auth":
			return auth({ list: has("--list"), logout: value("--logout"), provider: parsed.words[0] });
		case "whoami": {
			const credentials = await readCredentials();
			return whoami(await whoIs(credentials), credentials.api_url);
		}
		case "providers": {
			const verb = parsed.words[0] as ProviderVerb | undefined;
			if (verb !== undefined && !PROVIDER_VERBS.includes(verb)) throw usage(`\`harness providers\` takes ${PROVIDER_VERBS.join(", ")}; you gave \`${verb}\`.`);
			if (verb !== undefined && parsed.words[1] === undefined) throw usage(`\`harness providers ${verb} <id>\` needs a runtime.`);
			const { credentials, composed } = await composition(false);
			return providers(credentials, composed, verb, parsed.words[1], value("--reason"), value("--teams"));
		}
		case "keys": {
			if (parsed.words[0] !== "add") throw usage("`harness keys add <provider>` is the only form.");
			const provider = parsed.words[1];
			if (provider === undefined) throw usage("`harness keys add <provider>` needs a model provider.");
			const { credentials, composed } = await composition(false);
			return keysAdd(credentials, composed, provider, value("--model"));
		}
		case "setup":
			// W5-D13: taking the link type off the machine needs no login and
			// no composition, so it runs before either is asked for.
			if (has("--unregister")) return await unregister();
			return setup((await composition(false)).composed);
		case "open":
			// W5-D13. The URL is parsed before anything is fetched, so a bad
			// link is a sentence and not a network error.
			return openLink(parsed.words[0], async () => (await composition(false)).composed);
		case "commands":
			return commands();
		default:
			throw usage(`\`${command}\` is not a harness command. \`harness commands\` lists them.`);
	}
}

/** Every verb in §11, and §12's output rules around them. */
export async function main(argv = process.argv.slice(2)): Promise<number> {
	const args = [...argv];
	if (args[0] === "--version" || args[0] === "-v") {
		say(VERSION);
		return 0;
	}
	if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") return commands();
	// No verb, or a verb that is really a provider word: `run` is the default.
	const command = args[0] !== undefined && !args[0].startsWith("-") ? (args.shift() as string) : "run";
	try {
		return await dispatch(command, args);
	} catch (thrown) {
		if (thrown instanceof Usage) {
			console.error(thrown.message);
			return 2;
		}
		// §12 rule 2: a Blocker is three lines. Rule 3: nothing else is ever a
		// stack trace to a person.
		if (isBlocker(thrown)) {
			blocker(thrown);
			return 1;
		}
		// A server refusal that names its code but no remedy (a `definitions`
		// refusal relayed by `api`) is still the organization's answer, not a
		// fault in harness: print its sentence, never the generic line.
		if (isRefusal(thrown)) {
			console.error(bad(thrown.message));
			return 1;
		}
		if (process.env.HARNESS_DEBUG === "1") console.error(thrown);
		console.error("Something went wrong in harness itself (not your organization's policy). Run with `HARNESS_DEBUG=1` for the trace.");
		return 1;
	}
}
