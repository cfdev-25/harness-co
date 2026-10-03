import { describe, expect, it } from "vitest";
import { BOUNDARIES_TEXT } from "@/content/screens/boundaries";
import type { BoundaryRow } from "./boundaries";
import {
  addScopeOf,
  appliesTo,
  boundaryColumns,
  claudeHolds,
  mayRemove,
  onlyFor,
  setByPath,
  scopeFor,
  splitByLevel,
  splitByOrigin,
  tabOf,
} from "./boundaries";

// The rows are `api`'s own shape (02 rule 13): `BoundaryRow.setBy` is an
// `Origin`, which names the branch as well as the unit that set it.
const org: BoundaryRow = {
  id: "1", kind: "endpoint", value: "api.example.com", holds: "enforced", reason: "",
  scope: {}, setBy: { kind: "org", path: "acme", name: "Acme", ref: "refs/heads/org" },
};
const team: BoundaryRow = {
  ...org, id: "2", value: "b", scope: { teams: ["acme.marketing"] },
  setBy: {
    kind: "team", path: "acme.marketing", name: "Marketing",
    ref: "refs/heads/teams/acme.marketing",
  },
};

describe("boundaries", () => {
  it("lists every column in full and drops only `setBy` at n = 0 (07 §3)", () => {
    expect(boundaryColumns(false).map((column) => column.key)).toEqual([
      "kind", "value", "holds", "appliesTo", "onlyFor", "setBy", "reason", "when",
    ]);
    expect(boundaryColumns(true).map((column) => column.key)).not.toContain("setBy");
  });

  it("renders an unscoped boundary as All teams (P4)", () => {
    expect(appliesTo(org).all).toBe(true);
    expect(appliesTo(team).items.map((item) => item.id)).toEqual(["acme.marketing"]);
    expect(onlyFor(org).items).toEqual([]);
  });

  it("keeps the organization's rows rather than filtering them away (P17)", () => {
    const split = splitByOrigin([org, team], "acme");
    expect(split.fromOrg.map(setByPath)).toEqual(["acme"]);
    expect(split.own.map(setByPath)).toEqual(["acme.marketing"]);
  });

  it("lets nobody below the organization lift an organization boundary", () => {
    const scope = { kind: "team", path: "acme.marketing" } as const;
    expect(mayRemove(org, scope, "team-admin")).toBe(false);
    expect(mayRemove(team, scope, "team-admin")).toBe(true);
    expect(mayRemove(org, scope, "org-admin")).toBe(true);
    expect(mayRemove(team, scope, "member")).toBe(false);
  });

  it("limits an add to the viewer's own subtree", () => {
    expect(addScopeOf({ kind: "team", path: "acme.marketing" }, "acme")).toBe("acme.marketing");
    expect(addScopeOf({ kind: "org" }, "acme")).toBe("acme");
  });

  it("puts every row under the tab its value belongs to (W6-D8)", () => {
    const of = (kind: string, value: string) => tabOf({ ...org, kind, value });
    expect(of("endpoint", "api.example.com")).toBe("reach");
    expect(of("command", "rm -rf /*")).toBe("commands");
    expect(of("filesystem", "/etc/shadow")).toBe("files");
    // The capability kind names a built-in, not a thing, so it goes under the
    // tab whose vocabulary its value is in — until it has a better home.
    expect(of("capability", "process.exec")).toBe("commands");
    expect(of("capability", "tool.deploy")).toBe("commands");
    expect(of("capability", "filesystem.write")).toBe("files");
    expect(of("capability", "~/.ssh/id_rsa")).toBe("files");
    expect(of("capability", "require:audit")).toBe("reach");
    expect(of("capability", "web_search")).toBe("reach");
  });

  it("splits the rows into what this level set and what it inherited (W6-D8)", () => {
    const atTeam = splitByLevel([org, team], "acme.marketing");
    expect(atTeam.here.map(setByPath)).toEqual(["acme.marketing"]);
    expect(atTeam.inherited.map(setByPath)).toEqual(["acme"]);
    // At the organization nothing is above, so nothing is inherited.
    const atOrg = splitByLevel([org, team], "acme");
    expect(atOrg.here.map(setByPath)).toEqual(["acme"]);
    expect(atOrg.inherited.map(setByPath)).toEqual(["acme.marketing"]);
    // At *me* a person sets no boundary of their own, so every one is inherited
    // and the *Set here* block is empty rather than wrong.
    const atMe = splitByLevel([org, team], null);
    expect(atMe.here).toEqual([]);
    expect(atMe.inherited).toHaveLength(2);
  });

  it("says Claude Code holds a pattern only where it was measured to (07 §8)", () => {
    // Its matcher splits a command line at `|`, `&&` and `;` and matches each
    // subcommand, so a pattern holding one of those never fires there.
    expect(claudeHolds("rm -rf /*")).toBe(true);
    expect(claudeHolds("git push * --force*")).toBe(true);
    expect(claudeHolds("curl * | sh")).toBe(false);
    expect(claudeHolds("a && b")).toBe(false);
    expect(claudeHolds("a; b")).toBe(false);
  });

  it("scopes an add at the organization to every team, not to the org node", () => {
    // `covers()` compares a scope against the chain's **team** nodes, and the
    // organization node is not one of them — so `{ teams: ["acme"] }` is a
    // boundary that is written, listed, and reaches nobody (engine 03 §5.1).
    expect(scopeFor("acme", "acme")).toEqual({ teams: "all" });
    expect(scopeFor("acme.marketing", "acme")).toEqual({ teams: ["acme.marketing"] });
  });

  /* W7-D8: a boundary scopes by harness like every other policy object, and
     the three shapes of `scope.harnesses` are three different boundaries. */

  it("reads the three harness shapes as three different boundaries (W7-D8)", () => {
    const bound: BoundaryRow = {
      ...org,
      scope: { teams: "all", harnesses: ["h-1"] },
      harnesses: {
        unit: "harnesses",
        items: [{ id: "h-1", label: "Drafts", href: "/console/org/harnesses/h-1" }],
      },
    };
    const waiting: BoundaryRow = { ...org, scope: { teams: "all", harnesses: [] } };

    // Absent: every harness the teams own, which is the row the screen has
    // always had — *All teams*, and no narrowing to show.
    expect(appliesTo(org)).toEqual({ unit: "teams", items: [], all: true, word: undefined });
    expect(onlyFor(org)).toEqual({ unit: "harnesses", items: [] });

    // Named: the server's names and links, never the uuids `scope` holds, and
    // *All teams* would be the wrong answer about which harnesses it reaches.
    expect(appliesTo(bound).word).toBe(BOUNDARIES_TEXT.appliesToBound);
    expect(onlyFor(bound).items.map((item) => item.label)).toEqual(["Drafts"]);

    // Empty: bound to no harness yet, which is not the same as not narrowed —
    // a dash in both cells is how the two states become indistinguishable.
    expect(appliesTo(waiting).word).toBe(BOUNDARIES_TEXT.appliesToBound);
    expect(onlyFor(waiting)).toEqual({
      unit: "harnesses",
      items: [],
      word: BOUNDARIES_TEXT.onlyForNone,
    });
  });

  it("sends the harnesses half only when the form asked for one (W7-D8)", () => {
    // `[]` is a boundary bound to no harness yet; no key at all is one that
    // applies to every harness the teams own. The wire must tell them apart.
    expect(scopeFor("acme", "acme", [])).toEqual({ teams: "all", harnesses: [] });
    expect(scopeFor("acme", "acme", ["h-1"])).toEqual({ teams: "all", harnesses: ["h-1"] });
    expect("harnesses" in scopeFor("acme", "acme")).toBe(false);
  });
});