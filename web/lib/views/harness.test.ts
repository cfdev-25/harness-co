import { describe, expect, it } from "vitest";
import { SHELL } from "@/content/shell";
import { HARNESSES_WORDS } from "@/content/screens/harnesses";
import type { Viewer } from "./types";
import {
  DIFFERENCES,
  allOrgOwned,
  asOf,
  boundaryLists,
  compareOptions,
  defaultVersion,
  differencesRows,
  fetchedVersion,
  harnessTabs,
  hasConflict,
  headerFacts,
  isConflict,
  isUnanswered,
  mayEdit,
  modelLine,
  ownerLineId,
  ownerName,
  alsoAtWord,
  readVersion,
  readView,
  shownContent,
  viewOptions,
  type FileView,
  type HarnessFileRow,
  type HarnessView,
  type HarnessCard,
  runHref,
  shortPath,
} from "./harness";

const LABELS = {
  team: "Team",
  preflight: "Preflight",
  model: "Model provider",
  groups: "Security groups",
  keys: "Keys",
  reach: "Outside endpoints",
  files: "Files",
};

function viewer(over: Partial<Viewer> = {}): Viewer {
  return {
    user: { id: "u", email: "a@b.c", name: "A" },
    role: { level: "member", at: "acme.marketing" },
    edition: "enterprise",
    staff: false,
    teams: [{ path: "acme.marketing", name: "Marketing", admin: false }],
    visibility: { boundaries: true, logs: true },
    waiting: {},
    adminHere: false,
    ...over,
  };
}

function file(over: Partial<HarnessFileRow> = {}): HarnessFileRow {
  return {
    assetId: "a1",
    kind: "prompt",
    name: "house-style",
    path: "assets/prompt/house-style",
    owner: "you",
    lastEditor: { name: "Jo", at: "2026-01-01T00:00:00Z", note: "first" },
    tree: "t1",
    ...over,
  };
}

function harness(over: Partial<HarnessView> = {}): HarnessView {
  return {
    def: { id: "h1", name: "Campaign drafts", description: "", assets: [] },
    team: { path: "acme.marketing", name: "Marketing" },
    header: {
      preflight: { value: "passing", provenance: "derived", at: "now" },
      modelProvider: { value: "anthropic", provenance: "derived" },
      groups: { value: ["marketing-keys"], provenance: "derived" },
      fileCount: 3,
    },
    reach: { mode: "allow", hosts: ["pypi.org", "crates.io"], setBy: "acme.marketing" },
    versions: [
      { id: "mine", label: "Mine" },
      { id: "team", label: "The team's" },
    ],
    files: [],
    groups: [],
    boundaries: [],
    ...over,
  };
}

describe("the compare control", () => {
  it("defaults to mine at me and to the team's above it", () => {
    expect(defaultVersion({ kind: "me" })).toBe("mine");
    expect(defaultVersion({ kind: "org" })).toBe("team");
    expect(defaultVersion({ kind: "team", path: "acme.marketing" })).toBe("team");
  });

  it("member_sees_mine_team_differences_only", () => {
    const options = compareOptions(harness(), viewer(), "files", { differences: "Differences" });
    expect(options?.map((option) => option.id)).toEqual(["mine", "team", DIFFERENCES]);
  });

  it("team_admin_sees_member_versions", () => {
    const view = harness({
      versions: [
        { id: "mine", label: "Mine" },
        { id: "team", label: "The team's" },
        { id: "member:u2", label: "Sam Ojo" },
      ],
    });
    const options = compareOptions(view, viewer({ role: { level: "team-admin", at: "acme.marketing" } }), "files", {
      differences: "Differences",
    });
    expect(options?.map((option) => option.id)).toContain("member:u2");
  });

  it("differences_hidden_in_history", () => {
    const options = compareOptions(harness(), viewer(), "history", { differences: "Differences" });
    expect(options?.map((option) => option.id)).toEqual(["mine", "team"]);
    expect(readVersion(DIFFERENCES, { kind: "me" }, "history")).toBe("mine");
  });

  it("personal_compare_control_hidden_with_one_option", () => {
    const options = compareOptions(harness(), viewer({ edition: "personal" }), "files", {
      differences: "Differences",
    });
    expect(options).toBeNull();
  });

  it("carries ?as from a member: selection and reads both copies for differences", () => {
    expect(asOf("member:u2")).toBe("u2");
    expect(asOf("team")).toBeNull();
    expect(fetchedVersion(DIFFERENCES)).toBe("mine");
    expect(fetchedVersion("team")).toBe("team");
  });

  it("falls back for a version it does not know", () => {
    expect(readVersion("nonsense", { kind: "me" }, "files")).toBe("mine");
    expect(readVersion("member:u2", { kind: "me" }, "files")).toBe("member:u2");
  });
});

describe("the views control", () => {
  it("drops Requests at a personal account (07 §3)", () => {
    const labels = { files: "Files", history: "History", requests: "Requests" };
    expect(viewOptions(viewer({ edition: "personal" }), labels).map((o) => o.id)).toEqual([
      "files",
      "history",
    ]);
    expect(readView("requests", viewer({ edition: "personal" }))).toBe("files");
    expect(readView("requests", viewer())).toBe("requests");
  });
});

describe("the header grid", () => {
  it("header_grid_is_two_by_three", () => {
    const cells = headerFacts(harness(), viewer(), LABELS);
    expect(cells).toHaveLength(6);
    expect(cells.map((cell) => cell.key)).toEqual([
      "team",
      "preflight",
      "model",
      "groups",
      "reach",
      "files",
    ]);
  });

  it("personal_hides_team_vocabulary", () => {
    const cells = headerFacts(harness(), viewer({ edition: "personal" }), LABELS);
    expect(cells).toHaveLength(4);
    expect(cells.map((cell) => cell.key)).toEqual(["preflight", "model", "groups", "files"]);
    expect(cells.find((cell) => cell.key === "groups")?.label).toBe("Keys");
    expect(JSON.stringify(cells)).not.toContain("Team");
  });

  it("keeps preflight derived, so the cell can say so (K3)", () => {
    const cells = headerFacts(harness(), viewer(), LABELS);
    expect(cells.find((cell) => cell.key === "preflight")?.fact.provenance).toBe("derived");
  });
});

describe("differences", () => {
  it("classifies by tree id and nothing else (03 D32)", () => {
    const mine = [file({ assetId: "a", tree: "1" }), file({ assetId: "b", tree: "2" })];
    const team = [file({ assetId: "a", tree: "9" }), file({ assetId: "c", tree: "3" })];
    const rows = differencesRows(mine, team);
    const by = Object.fromEntries(rows.map((row) => [row.assetId, row.differs]));
    expect(by).toEqual({ a: "both", b: "yours-only", c: "theirs-only" });
  });

  it("keeps a conflict the server declared", () => {
    const mine = [file({ assetId: "a", tree: "1", differs: "conflict" })];
    const team = [file({ assetId: "a", tree: "9" })];
    const rows = differencesRows(mine, team);
    expect(rows[0].differs).toBe("conflict");
    expect(hasConflict(rows)).toBe(true);
    expect(hasConflict([file()])).toBe(false);
  });

  it("drops a row whose two copies are the same tree", () => {
    expect(differencesRows([file({ tree: "1" })], [file({ tree: "1" })])).toEqual([]);
  });
});

describe("the file page", () => {
  it("owner_line_per_owner_value", () => {
    expect(ownerLineId("org")).toBe("org");
    expect(ownerLineId("team")).toBe("team");
    expect(ownerLineId("you")).toBe("you");
    expect(ownerLineId("member:Sam")).toBe("member");
    expect(ownerName("member:Sam")).toBe("Sam");
  });

  it("reads the conflict and unanswered states from the view, never computes them", () => {
    const base: FileView = { row: file(), content: { mine: "a", team: "b" }, history: [] };
    expect(isConflict(base)).toBe(false);
    expect(isConflict({ ...base, row: file({ differs: "conflict" }) })).toBe(true);
    expect(isUnanswered({ ...base, content: { mine: null, team: null } })).toBe(true);
    expect(isUnanswered(base)).toBe(false);
  });

  it("shows the copy the compare control selected", () => {
    const base: FileView = { row: file(), content: { mine: "a", team: "b" }, history: [] };
    expect(shownContent(base, "mine")).toBe("a");
    expect(shownContent(base, "team")).toBe("b");
    expect(shownContent({ ...base, content: { mine: null, team: "b" } }, "mine")).toBe("b");
  });
});

describe("the edit and delete verbs", () => {
  it("edit_refused_names_team_admin", () => {
    expect(mayEdit(harness(), viewer())).toBe(false);
    expect(mayEdit(harness(), viewer({ role: { level: "org-admin", at: "acme" } }))).toBe(true);
    expect(mayEdit(harness(), viewer({ role: { level: "team-admin", at: "acme.marketing" } }))).toBe(true);
    expect(mayEdit(harness(), viewer({ role: { level: "team-admin", at: "acme.sales" } }))).toBe(false);
    expect(mayEdit(harness(), viewer({ edition: "personal" }))).toBe(true);
  });

  it("org_file_all_versions_identical_note", () => {
    expect(allOrgOwned([file({ owner: "org" }), file({ owner: "org" })])).toBe(true);
    expect(allOrgOwned([file({ owner: "org" }), file({ owner: "you" })])).toBe(false);
    expect(allOrgOwned([])).toBe(false);
  });
});

describe("a card's other copies (W5-D9)", () => {
  it("names each level in its own word, never a dotted path (01 §4.4)", () => {
    const at = (level: "org" | "team" | "me", label: string) =>
      alsoAtWord({ level, label, href: "/console/x/harnesses/1" });
    expect(at("org", "acme")).toBe(SHELL.levels.org);
    expect(at("me", "acme.marketing.jo")).toBe(SHELL.levels.me);
    expect(at("team", "marketing")).toBe("marketing");
  });
});

describe("the launch link and its breadcrumb (W5-D13, W5-D14)", () => {
  const card = (over: Partial<HarnessCard> = {}): HarnessCard => ({
    id: "8ceca1ae-ee7b-4638-bb3e-6a77443429e8",
    name: "test-harness-1",
    description: "",
    team: { path: "acme.marketing", name: "marketing" },
    fileCount: 0,
    ...over,
  });

  it("is the one shape engine 08 §11.24 parses", () => {
    expect(runHref("h-1", "pi")).toBe("harness://run?harness=h-1&provider=pi");
  });

  it("percent-encodes the workspace, because the CLI reads it as a query value", () => {
    // A space must not be a `+`: `parseLink` reads `URL.searchParams`, which
    // would hand the CLI a folder with a plus in its name.
    expect(runHref("h-1", "pi", "/Users/corby/my projects/foo")).toBe(
      "harness://run?harness=h-1&provider=pi&workspace=%2FUsers%2Fcorby%2Fmy%20projects%2Ffoo",
    );
  });

  it("shortens a home-like prefix for display only", () => {
    expect(shortPath("/Users/corby/projects/foo")).toBe("~/projects/foo");
    expect(shortPath("/home/corby/projects/foo")).toBe("~/projects/foo");
    expect(shortPath("C:\\Users\\corby\\projects")).toBe("~\\projects");
    // Not home-like, and not a prefix of a longer name either.
    expect(shortPath("/private/tmp/harness-ws-open")).toBe("/private/tmp/harness-ws-open");
    expect(shortPath("/Usersomething/x")).toBe("/Usersomething/x");
  });

  it("resumes into the folder the session recorded, absolute on the wire", () => {
    // D107 retired `openAgainLine`: the row is a verb and a folder now, not a
    // sentence with a hostname in it, so what is left to prove is that the
    // link carries the path the CLI will accept and the card reads the short
    // one. Absence is still the whole rule for drawing it (`lastWorkspace`).
    const resumable = card({ lastWorkspace: "/Users/corby/projects/foo", lastHost: "corby-mbp" });
    expect(runHref("h-1", "pi", resumable.lastWorkspace)).toBe(
      "harness://run?harness=h-1&provider=pi&workspace=%2FUsers%2Fcorby%2Fprojects%2Ffoo",
    );
    expect(shortPath(resumable.lastWorkspace!)).toBe("~/projects/foo");
    expect(card().lastWorkspace).toBeUndefined();
  });
});

describe("harnessTabs", () => {
  const views = [
    { id: "files" as const, label: "Files" },
    { id: "history" as const, label: "History" },
    { id: "requests" as const, label: "Requests" },
  ];
  const options = [
    { id: "mine" as const, label: "Mine" },
    { id: "team" as const, label: "The team's" },
    { id: "member:u_jo" as const, label: "Jo Adeyemi" },
  ];

  it("marks one tab in each set and keeps both sets apart", () => {
    const tabs = harnessTabs("/h/1", "team", "history", options, views, null);
    expect(tabs.filter((tab) => tab.group === "version" && tab.current).map((t) => t.id)).toEqual([
      "team",
    ]);
    expect(tabs.filter((tab) => tab.group === "view" && tab.current).map((t) => t.id)).toEqual([
      "history",
    ]);
  });

  it("carries `?as` onto a member's version and keeps it across a view", () => {
    const tabs = harnessTabs("/h/1", "member:u_jo", "files", options, views, "u_jo");
    const history = tabs.find((tab) => tab.id === "history");
    expect(history?.href).toBe("/h/1?version=member%3Au_jo&view=history&as=u_jo");
    const team = tabs.find((tab) => tab.id === "team");
    // Leaving a member's branch drops `?as` with it (04 §18).
    expect(team?.href).toBe("/h/1?version=team&view=files");
  });

  it("has no version set where the compare control is hidden (07 §3)", () => {
    const tabs = harnessTabs("/h/1", "mine", "files", null, views, null);
    expect(tabs.every((tab) => tab.group === "view")).toBe(true);
  });
});

describe("modelLine (W7-D4)", () => {
  const base = { installed: true, loggedIn: true, harness: false };

  it("names the key, the sign-in, or what to do — and links only for the last", () => {
    expect(modelLine({ ...base, model: "key" })).toEqual({
      text: HARNESSES_WORDS.newModelKey,
      link: false,
    });
    expect(modelLine({ ...base, model: "sign-in" })).toEqual({
      text: HARNESSES_WORDS.newModelSignIn,
      link: false,
    });
    expect(modelLine({ ...base, model: null })).toEqual({
      text: HARNESSES_WORDS.newModelNone,
      link: true,
    });
  });

  it("reads a viewer with no `setup` as neither, which is the safe half", () => {
    expect(modelLine(undefined)).toEqual({ text: HARNESSES_WORDS.newModelNone, link: true });
  });
});

describe("boundaryLists (W7-D8)", () => {
  const row = (id: string, harnesses?: string[]) => ({
    id, kind: "command", value: id, holds: "intercepted",
    scope: harnesses === undefined ? {} : { harnesses },
  });

  it("keeps a harness-scoped boundary off every harness but the ones it names", () => {
    // `HarnessView.boundaries` is every boundary on the chain, so the panel
    // would otherwise claim a deny the engine does not hold here (`covers`).
    const lists = boundaryLists(
      [row("universal"), row("mine", ["h-1"]), row("theirs", ["h-2"]), row("waiting", [])],
      "h-1",
    );
    expect(lists.here.map((one) => one.id)).toEqual(["universal", "mine"]);
    // What is left is what this harness could be bound to — and a boundary
    // bound to nothing yet is one of them.
    expect(lists.bindable.map((one) => one.id)).toEqual(["theirs", "waiting"]);
  });
});
