import { describe, expect, it } from "vitest";
import { levelLabel, levelOf, levelRows } from "./level";
import type { Scope, Viewer } from "./types";

function viewer(over: Partial<Viewer> = {}): Viewer {
  return {
    user: { id: "u", email: "jo@acme.example", name: "Jo" },
    role: { level: "member", at: "acme.marketing" },
    edition: "enterprise",
    staff: false,
    teams: [
      { path: "acme.marketing", name: "Marketing", admin: false },
      { path: "acme.marketing.interns", name: "Marketing interns", admin: false },
    ],
    visibility: { boundaries: true, logs: true },
    waiting: {},
    adminHere: false,
    ...over,
  };
}

const TEAM: Scope = { kind: "team", path: "acme.marketing" };

describe("levelOf — the chip under every title (01 §7.5)", () => {
  it("says you can edit where you administer, and at your own level", () => {
    expect(levelOf({ kind: "me" }, viewer()).sentence).toBe("You · you can edit here");
    expect(levelOf({ kind: "org" }, viewer({ adminHere: true })).sentence).toBe(
      "Organisation · you can edit here",
    );
    expect(levelOf(TEAM, viewer({ adminHere: true })).sentence).toBe(
      "Marketing · you can edit here",
    );
  });

  it("says read and use where you do not", () => {
    expect(levelOf(TEAM, viewer()).sentence).toBe("Marketing · read and use");
    expect(levelOf({ kind: "org" }, viewer()).canEdit).toBe(false);
  });

  it("names a team, never its path", () => {
    expect(levelLabel(TEAM, viewer())).toBe("Marketing");
    expect(levelLabel({ kind: "team", path: "acme.marketing.interns" }, viewer())).toBe(
      "Marketing interns",
    );
    // A team the viewer is not on has no name to read, so the last segment
    // stands in — never the whole dotted address.
    expect(levelLabel({ kind: "team", path: "acme.eng" }, viewer())).toBe("eng");
  });
});

describe("levelRows — the switcher's tree (01 §4.3)", () => {
  it("is You, each team with its sub-teams indented, then Organisation", () => {
    const rows = levelRows(TEAM, viewer());
    expect(rows.map((row) => row.label)).toEqual([
      "You", "Marketing", "Marketing interns", "Organisation",
    ]);
    expect(rows.map((row) => row.depth)).toEqual([0, 0, 1, 0]);
    expect(rows.filter((row) => row.current).map((row) => row.label)).toEqual(["Marketing"]);
  });

  it("measures a sub-team's depth against the shallowest team, not the dots", () => {
    // A viewer who is only on a sub-team sees it at the top of the tree:
    // there is no parent row for it to sit under.
    const only = viewer({ teams: [{ path: "acme.marketing.interns", name: "Interns", admin: false }] });
    expect(levelRows({ kind: "me" }, only).map((row) => row.depth)).toEqual([0, 0, 0]);
  });

  it("marks the current level, and only it", () => {
    const rows = levelRows({ kind: "org" }, viewer());
    expect(rows.filter((row) => row.current).map((row) => row.label)).toEqual(["Organisation"]);
    const sub = levelRows({ kind: "team", path: "acme.marketing.interns" }, viewer());
    expect(sub.filter((row) => row.current).map((row) => row.label)).toEqual(["Marketing interns"]);
  });
});
