import { describe, expect, it } from "vitest";
import {
  type ReachView,
  inheritedLines,
  modeOf,
  ownStep,
  reachLine,
  reachSaid,
  setByLabel,
  suggestions,
} from "./reach";
import type { Viewer } from "./types";

const VIEWER: Viewer = {
  user: { id: "u1", email: "jo@acme.example", name: "Jo" },
  role: { level: "org-admin", at: "acme" },
  edition: "enterprise",
  staff: false,
  teams: [
    { path: "acme.marketing", name: "Marketing", admin: true },
    { path: "acme.marketing.interns", name: "Marketing interns", admin: true },
  ],
  visibility: { boundaries: true, logs: true },
  waiting: {},
  adminHere: true,
};

function view(over: Partial<ReachView> = {}): ReachView {
  return {
    scope: "acme.marketing",
    effective: { mode: "allow", hosts: ["pypi.org", "crates.io"], setBy: "acme.marketing" },
    chain: [
      { node: "acme", name: "acme", mode: "on", hosts: ["competitor.example"], when: null },
      {
        node: "acme.marketing",
        name: "marketing",
        mode: "allow",
        hosts: ["pypi.org", "crates.io"],
        when: null,
      },
    ],
    suggested: ["pypi.org", "registry.npmjs.org"],
    canEdit: true,
    ...over,
  };
}

describe("the composed answer, in words", () => {
  it("says the mode, the count and the plural", () => {
    expect(reachSaid({ mode: "off", hosts: ["ignored"] })).toBe("off");
    expect(reachSaid({ mode: "allow", hosts: [] })).toBe("allow-list, nothing on it yet");
    expect(reachSaid({ mode: "allow", hosts: ["a"] })).toBe("allow-list, 1 host");
    expect(reachSaid({ mode: "allow", hosts: ["a", "b"] })).toBe("allow-list, 2 hosts");
    expect(reachSaid({ mode: "on", hosts: [] })).toBe("on, nothing denied");
    expect(reachSaid({ mode: "on", hosts: ["a"] })).toBe("on, except 1 host");
    expect(reachSaid({ mode: "on", hosts: ["a", "b"] })).toBe("on, except 2 hosts");
  });

  it("reads a mode it does not know as the narrowest, never wider", () => {
    expect(modeOf("anything")).toBe("off");
    expect(modeOf(undefined)).toBe("off");
    expect(modeOf("on")).toBe("on");
  });
});

describe("setBy is a level's own word, never a path", () => {
  it("names the level, the team, and a harness by its name", () => {
    expect(setByLabel("acme", VIEWER)).toBe("Organisation");
    expect(setByLabel("acme.marketing", VIEWER)).toBe("Marketing");
    // A team the viewer is not on still reads as its last segment, never the
    // dotted path (`levelLabel`'s fallback).
    expect(setByLabel("acme.eng", VIEWER)).toBe("eng");
    expect(setByLabel("harness:h1", VIEWER, { h1: "Support" })).toBe("Support");
    expect(setByLabel("harness:h1", VIEWER)).toBe("h1");
    expect(setByLabel(null, VIEWER)).toBe("");
  });

  it("reach_line_says_the_mode_and_who_set_it", () => {
    expect(reachLine(view().effective, VIEWER)).toBe("allow-list, 2 hosts · set by Marketing");
    expect(reachLine(null, VIEWER)).toBe("not set");
  });
});

describe("the Reach section's three parts", () => {
  it("puts inherited above, one line per node that holds a file", () => {
    expect(inheritedLines(view(), VIEWER)).toEqual([
      { node: "acme", text: "Organisation: on, except 1 host" },
    ]);
  });

  it("edits this node's own file when it has one", () => {
    expect(ownStep(view())).toEqual({ mode: "allow", hosts: ["pypi.org", "crates.io"] });
  });

  it("has nothing of its own to edit when this node holds no file", () => {
    // C32: absent is not `off` written down. The three writes act on *this*
    // node's file, so a list drawn from what was inherited would offer a
    // Remove that removes nothing — there is no list until the node has one.
    const none = view({
      chain: [{ node: "acme", name: "acme", mode: "on", hosts: [], when: null }],
      effective: { mode: "on", hosts: [], setBy: "acme" },
    });
    expect(ownStep(none)).toBeNull();
    expect(suggestions(none)).toEqual([]);
  });

  it("offers the starter list under allow only, marking what is there", () => {
    expect(suggestions(view())).toEqual([
      { host: "pypi.org", present: true },
      { host: "registry.npmjs.org", present: false },
    ]);
    const denying = view({
      chain: [{ node: "acme.marketing", name: "marketing", mode: "on", hosts: [], when: null }],
    });
    expect(suggestions(denying)).toEqual([]);
  });
});
