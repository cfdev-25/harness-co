import { describe, expect, it } from "vitest";
import {
  assetColumns,
  assetsCount,
  assetsEmptyId,
  assetsLede,
  currentKind,
  description,
  edgeList,
  edges,
  browseFilter,
  browseKinds,
  fromLabel,
  isRequired,
  kindTabs,
  kindWord,
  kindsOf,
  loadsLabel,
  loadsValue,
  loadsWord,
  ofKind,
  sidecarFacts,
  usedBy,
  withEnvironments,
} from "./assets";
import type { BrowseRow } from "./assets";
import { ASSETS, ASSETS_TEXT } from "@/content/screens/assets";

const asset = {
  id: "a1", kind: "skill", name: "triage", tree: "abc", level: "org" as const,
  sidecar: { id: "a1", kind: "skill", at: "2026-09-25T10:00:00Z" },
  loads: { scale: "loads", value: "required" },
  harnesses: { unit: "harnesses", items: [], all: true },
  teams: { unit: "teams", items: [] },
  groups: { unit: "groups", items: [] },
  // `EdgeWalk.from` is an `EdgeNode` or nothing — a walk that starts at the
  // asset itself names no other node (00 §4.7).
  edges: { from: null, restsOn: [{ kind: "group", id: "crm", label: "crm", via: "needs" }], restedOnBy: [] },
};

describe("assets", () => {
  it("writes the Loads word in one place, in three states (W5-D10)", () => {
    // The cell is the word `loadsLabel` returns, not a `ScaleTag`: the
    // asset page's own Loads fact is the tag, and both read one function so
    // the table and the control cannot say different things.
    const loads = assetColumns().find((column) => column.key === "loads");
    expect(loads?.kind).toBe("text");
    expect(loadsValue(asset)).toBe("required");
    expect(isRequired(asset)).toBe(true);
    expect(loadsLabel(asset)).toBe(ASSETS_TEXT.loadsRequired);
    const suggested = { ...asset, loads: { scale: "loads", value: "recommended" } };
    expect(loadsLabel(suggested)).toBe(ASSETS_TEXT.loadsRecommended);
    expect(isRequired(suggested)).toBe(false);
    const nothing = { ...asset, loads: { scale: "loads", value: "" } };
    expect(loadsValue(nothing)).toBe("on-request");
    expect(loadsLabel(nothing)).toBe(ASSETS_TEXT.loadsOnRequest);
    expect(loadsWord("recommended")).toBe(ASSETS_TEXT.loadsRecommended);
  });

  it("reads the two words the route took before the split as what they meant", () => {
    // `PUT /v1/assets/{id}/loads` accepts `always` and `chosen` for one
    // release, and an index written before WS4 still carries them. Read, not
    // sent: nothing on this screen posts the old words any more.
    expect(loadsValue({ ...asset, loads: { scale: "loads", value: "always" } })).toBe("required");
    expect(loadsValue({ ...asset, loads: { scale: "loads", value: "when-chosen" } }))
      .toBe("on-request");
    expect(loadsValue({ ...asset, loads: { scale: "loads", value: "chosen" } })).toBe("on-request");
  });

  it("says where it is in three lines, one per level (W5-D9, 02 rule 5)", () => {
    // The page reads and renders; which sentence this level gets is a view
    // model's answer, not a page's.
    expect(assetsLede({ kind: "org" })).toBe(ASSETS.lede);
    expect(assetsLede({ kind: "me" })).toBe(ASSETS_TEXT.ledeMe);
    expect(assetsLede({ kind: "team", path: "acme.marketing" })).toBe(ASSETS_TEXT.ledeTeam);
    expect(assetsEmptyId({ kind: "org" })).toBe("assets.org");
    expect(assetsEmptyId({ kind: "me" })).toBe("assets.me");
    expect(assetsEmptyId({ kind: "team", path: "acme.marketing" })).toBe("assets.team");
    expect(assetsCount(1)).toBe(ASSETS_TEXT.countOne);
    expect(assetsCount(4)).toBe("4 assets");
  });

  it("renders W5-D9's five columns and no Type (the tab is the kind)", () => {
    expect(assetColumns().map((column) => column.key)).toEqual([
      "name", "description", "loads", "usedBy", "lastChange",
    ]);
  });

  it("reads the description from the sidecar, where WS3a writes it", () => {
    expect(description(asset)).toBe("");
    expect(description({ ...asset, sidecar: { description: "House style" } })).toBe("House style");
  });

  it("names what a delete would take the asset out of (02 rule 22)", () => {
    expect(usedBy(asset)).toEqual({ all: true, labels: [] });
    const two = {
      ...asset,
      harnesses: {
        unit: "harnesses",
        items: [
          { id: "h1", label: "Support", href: "/console/org/harnesses/h1" },
          { id: "h2", label: "Weekly newsletter", href: "/console/org/harnesses/h2" },
        ],
      },
    };
    expect(usedBy(two)).toEqual({ all: false, labels: ["Support", "Weekly newsletter"] });
  });

  it("treats a kind as data: a word when the vocabulary explains it (01 D68)", () => {
    expect(kindWord("skill")).toBe("skill");
    expect(kindWord("widget")).toBe(null);
  });

  it("has a tab per declared kind, empty ones included, in policy order", () => {
    const kinds = ["skill", "tool", "prompt"];
    const rows = [asset, { ...asset, id: "a2", kind: "tool", name: "deploy" }];
    expect(kindsOf(kinds, rows)).toEqual(["skill", "tool", "prompt"]);
    const tabs = kindTabs(kinds, rows, "tool", "/console/org/assets");
    expect(tabs.map((tab) => [tab.id, tab.count, tab.current])).toEqual([
      ["skill", 1, false],
      ["tool", 1, true],
      ["prompt", 0, false],
    ]);
    expect(tabs[2].href).toBe("/console/org/assets?kind=prompt");
    // A kind on the branch that the vocabulary does not name is still
    // reachable: it is a tab at the end.
    expect(kindsOf(kinds, [{ ...asset, kind: "widget" }])).toEqual([
      "skill", "tool", "prompt", "widget",
    ]);
  });

  it("opens on the asked kind, else the first kind with rows (02 rule 16)", () => {
    const kinds = ["skill", "tool"];
    const rows = [{ ...asset, kind: "tool" }];
    expect(currentKind(kinds, rows, "skill")).toBe("skill");
    expect(currentKind(kinds, rows, "widget")).toBe("tool");
    expect(currentKind(kinds, rows)).toBe("tool");
    expect(currentKind(kinds, [])).toBe("skill");
    expect(ofKind([asset, { ...asset, kind: "tool" }], "tool").length).toBe(1);
  });

  it("walks the edges in one direction each, never merged (P1)", () => {
    expect(edges(asset).restsOn).toEqual([{ kind: "group", id: "crm", label: "crm", via: "needs" }]);
    expect(edges(asset).restedOnBy).toEqual([]);
    expect(edgeList("nonsense")).toEqual([]);
  });

  it("shows the sidecar's own scalars and invents none", () => {
    expect(sidecarFacts(asset).map((fact) => fact.k)).toEqual(["id", "kind", "at"]);
    expect(sidecarFacts({ ...asset, sidecar: { nested: { a: 1 } } })).toEqual([]);
  });
});

// --- the store (W5-D15) -----------------------------------------------------

const browse: BrowseRow[] = [
  { id: "b1", kind: "skill", name: "house-style", description: "How we write",
    level: "org", from: "acme", href: "/console/org/assets/b1", held: false,
    preset: false, needsEnvironment: null },
  { id: "b2", kind: "tool", name: "csv-summary", description: "",
    level: "me", from: "", href: "/console/me/assets/b2", held: true,
    preset: false, needsEnvironment: "python-data" },
  { id: "b3", kind: "environment", name: "python-data", description: "",
    level: "preset", from: "", href: null, held: false,
    preset: true, needsEnvironment: null },
];

describe("the store", () => {
  it("names the level a copy would come from, and the two words of its own", () => {
    // A team or the organisation has a name; *you* and *preset* are words the
    // console writes, which is why the server sends the level and not a label.
    expect(fromLabel(browse[0])).toBe("acme");
    expect(fromLabel(browse[1])).toBe(ASSETS_TEXT.browseYou);
    expect(fromLabel(browse[2])).toBe(ASSETS_TEXT.browsePreset);
  });

  it("filters by kind and by what is typed, over kind, name and description", () => {
    expect(browseKinds(browse)).toEqual(["environment", "skill", "tool"]);
    expect(browseFilter(browse, "", "").length).toBe(3);
    expect(browseFilter(browse, "tool", "").map((row) => row.id)).toEqual(["b2"]);
    expect(browseFilter(browse, "", "how we").map((row) => row.id)).toEqual(["b1"]);
    expect(browseFilter(browse, "", "environment").map((row) => row.id)).toEqual(["b3"]);
    expect(browseFilter(browse, "skill", "csv")).toEqual([]);
  });

  it("brings the environment a tool needs, once, and says why (W5-D15)", () => {
    const chosen = withEnvironments(["b2"], browse);
    expect(chosen.ids).toEqual(["b2", "b3"]);
    expect(chosen.brought).toEqual([
      { environment: "environment/python-data", tool: "tool/csv-summary", id: "b3" },
    ]);
    // Already ticked: brought along once, not twice.
    expect(withEnvironments(["b2", "b3"], browse).ids).toEqual(["b2", "b3"]);
    expect(withEnvironments(["b2", "b3"], browse).brought).toEqual([]);
    // Nothing answers the name: nothing is invented.
    const alone = [{ ...browse[1] }];
    expect(withEnvironments(["b2"], alone).ids).toEqual(["b2"]);
    expect(withEnvironments(["b1"], browse).brought).toEqual([]);
  });
});
