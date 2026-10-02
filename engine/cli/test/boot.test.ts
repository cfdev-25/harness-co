import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Chain, ComposedAsset, PreflightReport } from "@harness/compose/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { whoIs } from "../src/boot.js";
import { ensureRepo, fetchChain, offlineChain } from "../src/git.js";
import { parseRun } from "../src/main.js";
import { loadSet } from "../src/preflight/loadset.js";
import { renderReport } from "../src/report.js";
import { assetsGitDir } from "../src/selection.js";

const said: string[] = [];
beforeEach(async () => {
	process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-boot-"));
	said.length = 0;
	vi.spyOn(console, "log").mockImplementation((line: string) => void said.push(line));
	await ensureRepo();
});

const credentials = { api_url: "http://api", token: "tok" };

describe("--as (§6, D103)", () => {
	it("as_member_requires_admin", async () => {
		// A member's own role is checked by `api` before any fetch: `?as=` answers
		// 403 and the CLI turns it into the one blocker §13 names.
		vi.stubGlobal("fetch", async (url: string) => {
			expect(url).toContain("?as=jo");
			return new Response(JSON.stringify({ code: "console.as_forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
		});
		await expect(whoIs(credentials, "jo")).rejects.toMatchObject({
			code: "cli.as_not_admin",
			message: "You are not an admin of a team jo is in, so their version is not yours to open.",
		});
		vi.unstubAllGlobals();
	});

	it("a forged claim fails again at fetch, because no such ref is advertised", async () => {
		// The second half of the same test: even if `/v1/me` were fooled, the
		// transport advertises only the person's chain (02 §6.1), so `rev-parse`
		// of the claimed ref finds nothing and the boot refuses.
		const chain: Chain = [{ kind: "user", path: "acme.jo", ref: "refs/heads/users/jo", commit: "" }];
		await expect(fetchChain("tok", join(process.env.HARNESS_HOME as string, "nope.git"), chain)).rejects.toMatchObject({
			code: "preflight.api_unreachable",
		});
	});
});

describe("--offline (§6, D113)", () => {
	it("offline_uses_last_refs", async () => {
		const recorded: Chain = [{ kind: "org", path: "acme", ref: "refs/heads/org", commit: "c0" }];
		await writeFile(join(assetsGitDir(), "chain.json"), JSON.stringify(recorded));
		expect(await offlineChain()).toEqual(recorded);

		// No file means nothing has ever been fetched here.
		await rm(join(assetsGitDir(), "chain.json"));
		await expect(offlineChain()).rejects.toMatchObject({
			code: "cli.offline_no_refs",
			message: "Nothing has been fetched on this machine yet, so there is nothing to run offline.",
		});
	});
});

describe("--team (§6, D102)", () => {
	it("team_view_loads_shadows", async () => {
		const node = (kind: "org" | "user", path: string) => ({ kind, path, ref: `refs/heads/${path}`, commit: "c" });
		const asset = (id: string, from: "org" | "user", shadows?: boolean): ComposedAsset =>
			({
				id,
				kind: "skill",
				name: id,
				from: node(from, from === "org" ? "acme" : "acme.jo"),
				tree: `${id}-mine`,
				sidecar: { id, kind: "skill" },
				...(shadows ? { shadows: { from: node("org", "acme"), tree: `${id}-team` } } : {}),
			}) as ComposedAsset;
		const composed = {
			assets: [asset("override", "user", true), asset("only-mine", "user"), asset("theirs", "org")],
			policy: { required: [], recommended: [] },
		} as never;

		// `--team` is what sets the view, and it never writes the selection.
		const argv = parseRun(["pi", "--team"]);
		expect(argv.team).toBe(true);
		const view = argv.team ? "team" : "mine";

		const team = loadSet(composed, { harness: null, view });
		// Every override loads the team's copy…
		expect(team.loaded.find((one) => one.id === "override")?.tree).toBe("override-team");
		// …a copy only the person holds is dropped, and the team's own is untouched.
		expect(team.loaded.map((one) => one.id).sort()).toEqual(["override", "theirs"]);

		const mine = loadSet(composed, { harness: null, view: "mine" });
		expect(mine.loaded.find((one) => one.id === "override")?.tree).toBe("override-mine");
		// The work tree is not read or written by any of this (S2, C14).
		expect(await readFile(join(assetsGitDir(), "HEAD"), "utf8")).toContain("ref:");
	});
});

describe("preflight (§11.13)", () => {
	it("preflight_matches_json", () => {
		const report = {
			sessionId: "s1",
			composed: { commit: { "refs/heads/org": "c0" }, tree: "t", conflicts: [] },
			choices: {
				provider: { id: "pi", approval: "approved" },
				located: { path: "/usr/local/bin/pi", version: "0.85.1" },
				harness: null,
				view: "mine",
				model: { provider: { id: "anthropic" }, model: "claude-opus-5", wireFormat: "openai-completions", endpoint: "https://api.anthropic.com" },
				grants: [],
				native: false,
			},
			slots: [],
			drift: [],
			passing: true,
			blockers: [],
			at: "2026-01-01T00:00:00Z",
		} as unknown as PreflightReport;

		renderReport(report, { json: true });
		// `--json` prints the object and nothing else (§12 rule 4)…
		expect(said).toHaveLength(1);
		expect(JSON.parse(said[0])).toEqual(report);

		said.length = 0;
		renderReport(report, {});
		// …and the rendered view derives every value from that same object.
		const text = said.join("\n");
		for (const value of ["s1", "pi", "0.85.1", "anthropic/claude-opus-5", "openai-completions"]) expect(text).toContain(value);

		said.length = 0;
		renderReport(report, { sections: ["model"] });
		expect(said.join("\n")).toContain("anthropic/claude-opus-5");
		expect(said.join("\n")).not.toContain("0.85.1");
	});
});
