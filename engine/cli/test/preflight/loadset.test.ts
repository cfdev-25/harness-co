import { join } from "node:path";
import { compose } from "@harness/compose";
import { memoryFixture } from "@harness/compose/fixtures";
import type { Choices } from "@harness/compose/contracts";
import { expect, it } from "vitest";
import { loadSet } from "../../src/preflight/loadset.js";
import { asset, composed, harness } from "./support.js";

const FIXTURES = join(import.meta.dirname, "../../../compose/fixtures");
const view = (harnessDef: Choices["harness"], as: Choices["view"] = "mine") => ({ harness: harnessDef, view: as });

async function fixture(name: string) {
	const { reader, chain } = memoryFixture(join(FIXTURES, name));
	return compose(chain, reader);
}

it("loadset_includes_always_loaded_in_empty_harness", async () => {
	// 03 §5.3 step 2 over the shared `always-loaded` conformance case.
	const one = await fixture("always-loaded");
	expect(one.policy.required).toHaveLength(1);
	const empty = loadSet(one, view(harness({ assets: [] })));
	expect(empty.loaded.map((item) => item.id)).toEqual(one.policy.required);
	// Naming an always-loaded id twice is not an error.
	const twice = loadSet(one, view(harness({ assets: [one.policy.required[0], one.policy.required[0]] })));
	expect(twice.loaded).toHaveLength(1);
});

it("loadset_with_no_harness_is_everything_the_chain_delivered", async () => {
	// harnesses.md §0: no harness is not an empty harness.
	const one = await fixture("three-level-teams");
	expect(loadSet(one, view(null)).loaded.map((item) => item.id).sort()).toEqual(one.assets.map((item) => item.id).sort());
});

it("team_view_loads_the_shadowed_copy_and_drops_what_only_you_hold", async () => {
	// 08 §6 `--team`, C14: the work tree is untouched; the session sees the team's copies.
	const one = await fixture("override-keeps-id");
	const mine = loadSet(one, view(null)).loaded[0];
	expect(mine.from.kind).toBe("user");
	const team = loadSet(one, view(null, "team")).loaded[0];
	expect(team.from.kind).toBe("team");
	expect(team.tree).toBe(mine.shadows?.tree);
	expect(team.shadows).toBeUndefined();
	const onlyMine = composed({ assets: [{ ...asset("a1", "skill", "triage"), from: { kind: "user", path: "acme.x.dana", ref: "refs/heads/users/dana", commit: "c3" } }] });
	expect(loadSet(onlyMine, view(null, "team")).loaded).toEqual([]);
});

it("missing_assigned_id_is_a_slot_not_dropped", () => {
	// P8: `loadSet` reports it, and §5.4 turns it into the slot.
	const one = composed({ assets: [asset("a1", "skill", "triage")] });
	const { loaded, missing } = loadSet(one, view(harness({ assets: ["a1", "gone"] })));
	expect(loaded.map((item) => item.id)).toEqual(["a1"]);
	expect(missing).toEqual(["gone"]);
});
