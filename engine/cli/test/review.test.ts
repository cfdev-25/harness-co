import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureRepo, g, worktreeTree } from "../src/git.js";
import { type Ui } from "../src/prompt.js";
import { exitReview, refuseIfRequired } from "../src/review.js";
import { assetsRoot } from "../src/selection.js";

let boot: string;
const said: string[] = [];
const KINDS = ["skill", "tool", "prompt", "memory"];

/** Two delivered keys, recorded in `versions.json` as compose would (01 §7.5). */
beforeEach(async () => {
	process.env.HARNESS_HOME = await mkdtemp(join(tmpdir(), "harness-rev-"));
	said.length = 0;
	vi.spyOn(console, "log").mockImplementation((line: string) => void said.push(line));
	await ensureRepo();
	for (const key of ["skill/brief", "tool/crm-sync"]) {
		await mkdir(join(assetsRoot(), key), { recursive: true });
		await writeFile(join(assetsRoot(), key, "asset.json"), JSON.stringify({ id: key, kind: key.split("/")[0] }));
		await writeFile(join(assetsRoot(), key, "body.md"), "delivered\n");
	}
	await writeFile(
		join(assetsRoot(), "versions.json"),
		JSON.stringify({
			"skill/brief": { id: "skill/brief", kind: "skill", from: "acme", commit: "c", tree: "t", required: false },
			"tool/crm-sync": { id: "tool/crm-sync", kind: "tool", from: "acme", commit: "c", tree: "t", required: false },
		}),
	);
	boot = await worktreeTree();
	await g("update-ref", "refs/harness/remote", await g("commit-tree", boot, "-m", "hydrate"));
});

const dirty = (key: string) => writeFile(join(assetsRoot(), key, "body.md"), "mine\n");

/** What the agent leaves behind at the seam: `<kind>/<name>/`, no sidecar. */
async function made(key: string, file: string): Promise<void> {
	await mkdir(join(assetsRoot(), key), { recursive: true });
	await writeFile(join(assetsRoot(), key, file), "# made\n");
}

const sidecar = (key: string) => readFile(join(assetsRoot(), key, "asset.json"), "utf8").then((text) => JSON.parse(text) as { id: string; kind: string });

/** A `Ui` that answers as told: the menu choice, the ticked rows, the message. */
function ui(answers: { select: number | null; checklist?: number[] | null; line?: string }): Ui {
	return {
		select: async () => answers.select,
		checklist: async () => answers.checklist ?? [],
		line: async () => answers.line ?? "",
	};
}

describe("exit review (§10.0, D115)", () => {
	it("exit_review_lists_only_changed_keys", async () => {
		await dirty("skill/brief");
		const pushed: string[] = [];
		const changed = await exitReview({ boot, kinds: KINDS, harness: "H", interactive: false, push: async (key) => void pushed.push(key) });
		expect(changed).toEqual(["skill/brief"]);
		// The clean key is never offered, and nothing is pushed without an answer.
		expect(changed).not.toContain("tool/crm-sync");
		expect(pushed).toEqual([]);
	});

	it("exit_review_non_tty_prints_commands", async () => {
		await dirty("tool/crm-sync");
		const pushed: string[] = [];
		await exitReview({ boot, kinds: KINDS, harness: "H", interactive: false, push: async (key) => void pushed.push(key) });
		// Step 3: never a prompt; the exact command for each.
		expect(said.join("\n")).toContain('`harness push tool/crm-sync --message "…" --harness "H"`');
		expect(pushed).toEqual([]);
	});

	it("exit_review_pick_pushes_subset", async () => {
		await dirty("skill/brief");
		await dirty("tool/crm-sync");
		const pushed: Array<[string, string]> = [];
		await exitReview({
			boot,
			kinds: KINDS,
			harness: "H",
			interactive: true,
			ui: ui({ select: 2, checklist: [1], line: "just the tool" }),
			push: async (key, message) => void pushed.push([key, message]),
		});
		// Only a pick opens the checklist; the unticked one is left alone.
		expect(pushed).toEqual([["tool/crm-sync", "just the tool"]]);
	});

	it("all pushes every key with one message, none pushes nothing", async () => {
		await dirty("skill/brief");
		await dirty("tool/crm-sync");
		let pushed: Array<[string, string]> = [];
		await exitReview({ boot, kinds: KINDS, harness: "H", interactive: true, ui: ui({ select: 0, line: "one message" }), push: async (key, message) => void pushed.push([key, message]) });
		expect(pushed).toEqual([
			["skill/brief", "one message"],
			["tool/crm-sync", "one message"],
		]);
		expect(said.some((line) => line.includes("✓ progress saved to your H"))).toBe(true);

		pushed = [];
		await exitReview({ boot, kinds: KINDS, harness: "H", interactive: true, ui: ui({ select: 1 }), push: async (key, message) => void pushed.push([key, message]) });
		expect(pushed).toEqual([]);
		// Enter alone on the message takes the default.
		await exitReview({ boot, kinds: KINDS, harness: "H", interactive: true, ui: ui({ select: 0, line: "" }), push: async (key, message) => void pushed.push([key, message]) });
		expect(pushed).toEqual([
			["skill/brief", "Update skill/brief"],
			["tool/crm-sync", "Update tool/crm-sync"],
		]);
	});

	it("exit_review_never_touches_team_ref", async () => {
		await dirty("skill/brief");
		const refs: string[] = [];
		await exitReview({
			boot,
			kinds: KINDS,
			harness: "H",
			interactive: true,
			ui: ui({ select: 0, line: "keep mine" }),
			// The review's only outward call is `push(key, message)`: there is no
			// parameter on it that could name a ref at all, let alone a team's.
			push: async (key, message) => void refs.push(`${key}:${message}`),
		});
		expect(refs).toEqual(["skill/brief:keep mine"]);
		const after = await g("for-each-ref", "--format=%(refname)");
		expect(after.split("\n").filter((ref) => ref.includes("teams/") || ref.includes("refs/heads/org"))).toEqual([]);
	});

	it("exit_review_lists_made_directories", async () => {
		await made("skill/x", "SKILL.md");
		const pushed: string[] = [];
		await exitReview({ boot, kinds: KINDS, harness: "H", interactive: true, ui: ui({ select: 1 }), push: async (key) => void pushed.push(key) });
		// Step 4: after the changed list, and named for what it is.
		expect(said.map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""))).toContain("  skill  x  new");
		// Nothing was adopted on the way to showing it.
		expect(await sidecar("skill/x").catch(() => undefined)).toBeUndefined();
		expect(pushed).toEqual([]);
	});

	it("exit_review_non_tty_prints_adopt_commands", async () => {
		await made("skill/x", "SKILL.md");
		await exitReview({ boot, kinds: KINDS, harness: "H", interactive: false, push: async () => expect.unreachable() });
		// Step 3: the absolute path, because `adopt` takes a path and not a key.
		expect(said.join("\n")).toContain(`\`harness adopt ${join(assetsRoot(), "skill/x")}\``);
	});

	it("exit_review_keep_adopts_then_pushes", async () => {
		await made("skill/x", "SKILL.md");
		const pushed: Array<[string, string]> = [];
		await exitReview({
			boot,
			kinds: KINDS,
			harness: "H",
			interactive: true,
			ui: ui({ select: 0, line: "mine now" }),
			push: async (key, message) => void pushed.push([key, message]),
		});
		// §11.11 in place: a fresh id, the kind the path says, and nothing moved.
		const minted = await sidecar("skill/x");
		expect(minted.kind).toBe("skill");
		expect(minted.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
		// Then the ordinary push — once.
		expect(pushed).toEqual([["skill/x", "mine now"]]);
	});

	it("exit_review_lists_removed_keys_and_keeps_the_removal", async () => {
		// D120: a delivered key gone from disk is a change; keeping it removes it.
		await rm(join(assetsRoot(), "tool", "crm-sync"), { recursive: true, force: true });
		const removedKeys: string[] = [];
		const gone: string[][] = [];
		await exitReview({
			boot,
			kinds: KINDS,
			harness: "H",
			interactive: true,
			ui: ui({ select: 0 }),
			push: async () => expect.unreachable("nothing to push for a removal"),
			remove: async (key) => void removedKeys.push(key),
			removed: async (keys) => void gone.push(keys),
		});
		expect(said.join("\n").replace(/\u001b\[[0-9;]*m/g, "")).toContain("tool  crm-sync  removed");
		expect(removedKeys).toEqual(["tool/crm-sync"]);
		expect(gone).toEqual([["tool/crm-sync"]]);
	});

	it("exit_review_never_offers_to_remove_a_required_asset", async () => {
		// W5-D10: `required` is in every session's load set (03 §5.3), so the
		// review says what will happen rather than asking a question it would
		// then refuse — and `leaveHarness` refuses it anyway.
		await writeFile(
			join(assetsRoot(), "versions.json"),
			JSON.stringify({
				"skill/brief": { id: "skill/brief", kind: "skill", from: "acme", commit: "c", tree: "t", required: true },
			}),
		);
		const required = await worktreeTree();
		await rm(join(assetsRoot(), "skill", "brief"), { recursive: true, force: true });
		await exitReview({
			boot: required,
			kinds: KINDS,
			harness: "H",
			interactive: true,
			ui: { select: async () => expect.unreachable("nothing is offered, so nothing is asked"), checklist: async () => expect.unreachable(), line: async () => expect.unreachable() },
			push: async () => expect.unreachable(),
		});
		expect(said.join("\n")).toContain("`skill/brief` is required, so it stays in every harness");
		expect(said.join("\n")).not.toContain("Keep these as yours?");
	});

	it("required_assets_cannot_leave_a_harness", () => {
		const versions = {
			"skill/brief": { id: "a", kind: "skill", from: "acme", commit: "c", tree: "t", required: true },
			"tool/crm-sync": { id: "b", kind: "tool", from: "acme", commit: "c", tree: "t", required: false },
		};
		expect(() => refuseIfRequired(versions, ["tool/crm-sync"])).not.toThrow();
		expect(() => refuseIfRequired(versions, ["skill/brief"])).toThrowError(
			expect.objectContaining({ code: "cli.asset_required" }),
		);
	});

	it("exit_review_ignores_a_key_the_subscription_never_materialised", async () => {
		// 01 §8 row 0: the boot tree names every winning asset on the chain, and
		// the work tree holds only what this person is subscribed to. An absence
		// for that reason is not a removal the person made.
		await rm(join(assetsRoot(), "tool", "crm-sync"), { recursive: true, force: true });
		await exitReview({
			boot,
			kinds: KINDS,
			harness: "H",
			interactive: true,
			subscribed: (version) => version.id !== "tool/crm-sync",
			ui: { select: async () => expect.unreachable("nothing is offered, so nothing is asked"), checklist: async () => expect.unreachable(), line: async () => expect.unreachable() },
			push: async () => expect.unreachable(),
		});
		expect(said).toEqual([]);
	});

	it("exit_review_non_tty_names_removals", async () => {
		await rm(join(assetsRoot(), "tool", "crm-sync"), { recursive: true, force: true });
		await exitReview({ boot, kinds: KINDS, harness: "H", interactive: false, push: async () => expect.unreachable() });
		expect(said.join("\n")).toContain('`tool/crm-sync` was removed this session — `harness remove tool/crm-sync --harness "H"`');
	});

	it("exit_review_non_tty_names_the_sessions_harness", async () => {
		await dirty("tool/crm-sync");
		const pushed: string[] = [];
		await exitReview({ boot, kinds: KINDS, harness: "Alpha", interactive: false, push: async (key) => void pushed.push(key) });
		expect(pushed).toEqual([]);
		expect(said.join("\n")).toContain('--message "…" --harness "Alpha"');
	});

	it("exit_review_kept_callback_gets_every_kept_key_once", async () => {
		// Step 5a's hook: the keys that were actually kept, after their pushes.
		await made("skill/y", "SKILL.md");
		const kept: string[][] = [];
		await exitReview({
			boot,
			kinds: KINDS,
			harness: "H",
			interactive: true,
			ui: ui({ select: 0, line: "keep" }),
			push: async () => {},
			kept: async (keys) => void kept.push(keys),
		});
		expect(kept).toEqual([["skill/y"]]);
	});

	it("prints nothing and pushes nothing when nothing changed", async () => {
		const pushed: string[] = [];
		expect(await exitReview({ boot, kinds: KINDS, harness: "H", interactive: true, ui: { select: async () => expect.unreachable(), checklist: async () => expect.unreachable(), line: async () => expect.unreachable() }, push: async (key) => void pushed.push(key) })).toEqual([]);
		expect(said).toEqual([]);
	});
});
