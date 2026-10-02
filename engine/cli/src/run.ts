import { stdin, stdout } from "node:process";
import type { Proxy } from "./proxy/proxy.js";
import { adapters } from "./adapters/registry.js";
import type { Adapter, Composed, PreflightReport } from "@harness/compose/contracts";
import { deliveredCounts, deliveredSets, loadSet } from "./adapters/layout.js";
import { type Frame, bootScreen, modelBrief, reachBrief } from "./screens.js";
import { colorMode } from "./style.js";
import { api, preflightApi } from "./api.js";
import { harvestAgentCredentials, seedAgentCredentials } from "./auth.js";
import { type Me, rowCompose, rowFetch, rowHydrate, whoIs } from "./boot.js";
import { readCredentials } from "./credentials.js";
import { closeSession } from "./exit.js";
import { loading } from "./loading.js";
import { prepareFence } from "./fence.js";
import { differs, worktreeTree } from "./git.js";
import { readVersions, subscription } from "./hydrate.js";
import { blocker, once, refuse, say } from "./output.js";
import { preflight } from "./preflight/preflight.js";
import { renderReport } from "./report.js";
import { exitReview, joinHarness, leaveHarness, onDisk, removeOwnCopy } from "./review.js";
import { assetsRoot, readSelection, selectionPath } from "./selection.js";
import { createSession, flushPendingClose, writeReport } from "./session.js";
import { forwardSignals, spawnConfined } from "./spawn.js";
import { supervise } from "./supervise.js";
import { pushKey } from "./commands/push.js";
import { pushFile } from "./commands/new.js";

export interface RunArgv {
	provider?: string;
	harnessFlag?: string;
	team?: boolean;
	as?: string;
	model?: string;
	offline?: boolean;
	nonInteractive?: boolean;
	json?: boolean;
	sections?: string[];
	passthrough: string[];
}

/**
 * Row 0, zero I/O. A typo'd provider word is the one failure this command must
 * not have, so it is never passed through (§13 `cli.provider_unknown`).
 * With no word, `listed` narrows the registry to what the organisation actually
 * lists, so a machine with two adapters installed and one approved runtime is
 * not ambiguous — 03 §5.2 step 1 makes the same choice from the same set.
 */
export function selectAdapter(word: string | undefined, listed?: readonly string[]): Adapter {
	const known = Object.keys(adapters);
	if (word !== undefined) {
		const found = adapters[word];
		if (found === undefined) refuse("cli.provider_unknown", `"${word}" is not a provider this CLI knows. You have: ${known.join(", ")}.`, `harness run ${known[0]}`);
		return found;
	}
	const candidates = listed === undefined ? known : known.filter((id) => listed.includes(id));
	if (candidates.length === 1) return adapters[candidates[0]];
	refuse("cli.provider_ambiguous", `Say which provider: ${(candidates.length > 0 ? candidates : known).join(", ")}.`, `harness run ${known[0]}`);
}

/**
 * §6's boot table, and nothing else. Each row is one call; the first `Blocker`
 * ends the boot. `spawn: false` is `harness preflight` — the same path, stopped
 * at row 10 with the proxy closed again (00 §3).
 */
export async function run(argv: RunArgv, spawn: boolean): Promise<number> {
	// A word is checked against the registry before anything else runs; with no
	// word the choice needs the organisation's list, so it waits for row 2.
	if (argv.provider !== undefined) selectAdapter(argv.provider);
	// 08 §11.1: the loading pixels, from the first moment to the landing.
	const starting = loading("starting", stdout);
	const credentials = await readCredentials().finally(() => undefined);
	await flushPendingClose(credentials);
	const me: Me = await whoIs(credentials, argv.as);

	const chain = await rowFetch(credentials, me, argv.offline === true);
	const composed = await rowCompose(chain);
	await rowHydrate(composed);
	const adapter = selectAdapter(argv.provider, Object.keys(composed.policy.harnessProviders));

	const session = await createSession();
	const fence = await prepareFence(session.dir, once());
	let proxy: Proxy | undefined;
	const startedAt = Date.now();

	const { report, context, credentials: minted } = await preflight({
		spawn,
		composed,
		adapter,
		argv: { provider: argv.provider, harnessFlag: argv.harnessFlag, team: argv.team, model: argv.model, offline: argv.offline, passthrough: argv.passthrough },
		selection: await readSelection(),
		selectionPath: selectionPath(),
		me,
		sessionId: session.id,
		sessionDir: session.dir,
		agentDir: session.agentDir,
		workspace: process.cwd(),
		assetsRoot: assetsRoot(),
		home: process.env.HOME ?? "",
		proxy: { url: fence.url, port: fence.port },
		api: preflightApi(credentials),
		fence: async (plan, forProxy) => (proxy = await fence.start(plan, forProxy)),
		notify: say,
	});
	// Row 10. `preflight` wrote the report and closed the fence on a failure or
	// on `spawn: false`; this is only the person's half of it.
	await writeReport(session.dir, report);
	// A boot that ends after Mint must not leave the broker believing a session is live: close it. A 404
	// means Mint never happened, which is fine. (A client that dies between Mint and its first tick is the
	// broker's expiry to handle — recorded in build-log as the next defect.)
	const closeAborted = () =>
		api(credentials, `/v1/sessions/${session.id}`, { method: "PATCH", body: JSON.stringify({ status: "closed", endpoints: [] }) }).catch(() => undefined);
	if (!spawn) {
		renderReport(report, argv);
		await closeAborted();
		return report.passing ? 0 : 1;
	}
	// `choices` is null only when Choose itself refused, which is never a passing report (00 §4.7).
	if (!report.passing || context === null || report.choices === null) {
		for (const one of report.blockers) blocker(one);
		for (const slot of report.slots) if (slot.blocker !== undefined) blocker(slot.blocker);
		await closeAborted();
		return 1;
	}

	// W5-D12. The last thing on the screen before the provider's own interface
	// is what this session *is* — after preflight passed, before the spawn.
	const frame = sessionFrame(composed, report, adapter.displayName);
	starting.stop();
	for (const line of bootScreen(frame, adapter.displayName, adapter.landing ?? "theirs")) say(line);

	// Row 11. A native session is handed its own stored login first (07 §11).
	if (report.choices.native) await seedAgentCredentials(adapter.id, session.agentDir);
	const { child, exited } = spawnConfined(context.plan, { dir: session.dir, proxyPort: fence.port }, process.cwd());
	const signals = forwardSignals(child);

	// Row 12.
	const notify = once();
	const watcher = supervise({
		child,
		sessionDir: session.dir,
		proxy: proxy as Proxy,
		report,
		notify,
		api: {
			audit: (events) => api(credentials, "/v1/audit/batch", { method: "POST", body: JSON.stringify({ events }) }),
			endpoints: (events) => api(credentials, `/v1/sessions/${session.id}/endpoints`, { method: "POST", body: JSON.stringify({ events }) }),
			heartbeat: (patch) => api(credentials, `/v1/sessions/${session.id}`, { method: "PATCH", body: JSON.stringify(patch) }),
			validity: () => api(credentials, `/v1/sessions/${session.id}`),
		},
	});

	const code = await exited;
	// 08 §10.0: the loading pixels again, from the child's exit to the review.
	const closing = loading("closing", stdout);
	await watcher.stop();
	signals.stop();

	// Row 13.
	if (argv.as === undefined) {
		const selection = await readSelection();
		await exitReview({
			boot: report.composed.tree,
			kinds: composed.policy.kinds,
			interactive: stdin.isTTY === true && argv.nonInteractive !== true,
			ready: () => closing.stop(),
			subscribed: subscription(composed),
			push: async (key, message) => {
				await pushKey(credentials, me, key, message, true);
			},
			// D119: the session's harness is the review's target — the person is editing
			// their version of the harness they are in. Never asked.
			harness: report.choices?.harness?.name ?? "",
			kept: async (keys) => {
				await joinHarness(composed, (path, body, message) => pushFile(credentials, me, path, body, message), keys, report.choices?.harness?.id, true);
			},
			remove: async (key) => {
				await removeOwnCopy(credentials, me, await readVersions(report.composed.tree), key, true);
			},
			removed: async (keys) => {
				await leaveHarness(composed, (path, body, message) => pushFile(credentials, me, path, body, message), await readVersions(report.composed.tree), keys, report.choices?.harness?.id, true);
			},
		});
	} else {
		closing.stop();
		say(`You are reading ${argv.as}'s version; changes cannot be pushed from here.`);
	}
	closing.stop();
	await closeSession({
		session,
		proxy: proxy as Proxy,
		close: async (endpoints) => {
			await api(credentials, `/v1/sessions/${session.id}`, { method: "PATCH", body: JSON.stringify({ status: "closed", endpoints }) });
		},
		harvest: report.choices.native ? () => harvestAgentCredentials(adapter.id, session.agentDir) : undefined,
		minutes: Math.round((Date.now() - startedAt) / 60_000),
		filesChanged: await changedSinceDelivery(),
	});
	return watcher.ended() !== undefined ? 1 : signals.interrupted() ? 130 : code;
}

/**
 * W5-D12. The one description of this session both frames draw from, built
 * once from what preflight already decided. The delivery is counted by
 * `layout.ts` (`deliveredSets`), never here.
 */
function sessionFrame(composed: Composed, report: PreflightReport, provider: string): Frame {
	const harness = report.choices?.harness ?? null;
	const { loaded } = loadSet(composed, { harness, view: report.choices?.view ?? "mine" });
	return {
		icon: harness?.icon ?? null,
		name: harness?.name ?? provider,
		description: harness?.description ?? "",
		delivered: deliveredCounts(deliveredSets(loaded)),
		model: modelBrief(report.choices),
		reach: reachBrief(report.plan?.reach),
		workspace: process.cwd(),
		width: process.stdout.columns || 80,
		mode: colorMode(),
		tty: process.stdout.isTTY === true,
	};
}

/** §10.1 step 6: the work tree against `refs/harness/remote`, counted by key. */
async function changedSinceDelivery(): Promise<number> {
	const work = await worktreeTree();
	const { readVersions } = await import("./hydrate.js");
	const keys = Object.keys(await readVersions("refs/harness/remote"));
	let changed = 0;
	for (const key of keys) {
		// An unsubscribed key is not materialised (01 §8 row 0), so its absence
		// from the work tree is not a change the person made.
		if (!(await onDisk(key))) continue;
		if (await differs("refs/harness/remote", work, key)) changed += 1;
	}
	return changed;
}
