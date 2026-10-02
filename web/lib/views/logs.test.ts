import { describe, expect, it } from "vitest";
import { CATEGORIES, actorOf, allowOf, attemptColumns, categoryOf, commitOf, harnessNames, isCategory, isGitBacked, logColumns, matching, outcomeWord, reasonWords, routeOf, tabs, teamOf } from "./logs";

const row = {
  id: "1", at: "2026-09-25T22:44:16Z",
  actor: { id: "u1", name: "Jo Adeyemi" }, team: { path: "acme.marketing", name: "Marketing" },
  action: "grant.narrow", sentence: "Jo narrowed crm from the marketing grant",
  ref: { ref: "refs/heads/org", commit: "abcdef1234" },
};

describe("logs", () => {
  it("is one page whose tabs are routes, three of them for everyone", () => {
    expect(CATEGORIES).toEqual(["harness", "permission", "provider", "people"]);
    expect(isCategory("permission")).toBe(true);
    expect(isCategory("everything")).toBe(false);
    const member = tabs("/console/org", { adminHere: false, edition: "enterprise" });
    expect(member.map((tab) => tab.id)).toEqual(["changes", "sessions", "endpoints"]);
    expect(member.map((tab) => tab.href)).toContain("/console/org/logs/endpoints");
    const admin = tabs("/console/org", { adminHere: true, edition: "enterprise" }, "sessions");
    expect(admin.filter((tab) => tab.current).map((tab) => tab.id)).toEqual(["sessions"]);
    expect(admin.map((tab) => tab.id)).toEqual([
      "changes", "sessions", "endpoints", "permission", "provider", "people",
    ]);
    // A personal account has nobody else to administer, so it reads the three.
    expect(tabs("/console/me", { adminHere: true, edition: "personal" })).toHaveLength(3);
  });

  it("names the first tab Changes and keeps `harness` as the category", () => {
    expect(categoryOf("changes")).toBe("harness");
    expect(routeOf("harness")).toBe("changes");
    // The old route is a redirect, not a second name for the tab.
    expect(categoryOf("harness")).toBe(null);
    expect(categoryOf("nothing")).toBe(null);
    expect(categoryOf("people")).toBe("people");
  });

  it("drops the audit action at `me`: a person reads the sentence", () => {
    expect(logColumns(false).map((column) => column.key)).toContain("action");
    expect(logColumns(true).map((column) => column.key)).not.toContain("action");
  });

  it("offers a diff only for a git-backed row (P9)", () => {
    expect(isGitBacked(row)).toBe(true);
    expect(commitOf(row)).toBe("abcdef1");
    expect(isGitBacked({ ...row, ref: null })).toBe(false);
  });

  it("filters on the words a person reads, not the action string", () => {
    expect(matching([row], "narrowed")).toHaveLength(1);
    expect(matching([row], "Marketing")).toHaveLength(1);
    expect(matching([row], "grant.narrow")).toHaveLength(0);
    expect(matching([row], "")).toHaveLength(1);
  });

  it("names the actor and the team, or a dash", () => {
    expect(actorOf(row)).toBe("Jo Adeyemi");
    expect(teamOf(row)).toBe("Marketing");
    // `PersonRef` always carries an id, so a nameless actor reads as that id
    // rather than as nothing; only a ref with neither reads as a dash.
    expect(actorOf({ ...row, actor: { id: "u0" } })).toBe("u0");
    expect(actorOf({ ...row, actor: { id: "" } })).toBe("—");
    expect(teamOf({ ...row, team: null })).toBe("—");
  });

  it("groups attempts by host, outcome, reason and the level that decided", () => {
    const columns = attemptColumns();
    expect(columns.map((column) => column.key)).toEqual([
      "host", "outcome", "reason", "setBy", "count", "first", "last", "sessions", "allow",
    ]);
    expect(columns.find((column) => column.key === "count")?.kind).toBe("number");
    expect(columns.find((column) => column.key === "last")?.kind).toBe("time");
  });

  it("endpoint_reason_in_plain_words", () => {
    // 05 §6a.1's four, the boundary, and the strip that names what went.
    expect(reasonWords("reach.not-listed")).toBe("It is not on the allow-list.");
    expect(reasonWords("reach.denied")).toBe("It is on the deny-list.");
    expect(reasonWords("port")).toBe("Only port 443 is open.");
    expect(reasonWords("boundary")).toBe("A boundary denies it.");
    expect(reasonWords("stripped:web_search_20250305,mcp_servers")).toBe(
      "web_search_20250305, mcp_servers not sent: the provider may not browse on its own side either.",
    );
    // A reason this console does not know prints as it came (K2).
    expect(reasonWords("something-new")).toBe("something-new");
    expect(reasonWords(null)).toBe("—");
  });

  it("names the three outcomes and leaves an unknown one alone", () => {
    expect(outcomeWord("reached")).toBe("reached");
    expect(outcomeWord("stripped")).toBe("stripped");
    expect(outcomeWord("elsewhere")).toBe("elsewhere");
  });

  it("allow_action_narrows_off_the_open_record", () => {
    const row = {
      host: "registry.npmjs.org", outcome: "refused", count: 1, refused: 1,
      firstAt: "2026-01-01T00:00:00Z", lastAt: "2026-01-01T00:00:00Z", sessions: 0,
      harnesses: { unit: "harnesses", items: [{ id: "h1", label: "Support", href: "/x" }] },
    };
    expect(allowOf({ ...row, allow: { can: true, scope: "org" } } as never))
      .toEqual({ can: true, scope: "org", why: "" });
    expect(allowOf({ ...row, allow: { can: false, why: "Marketing's admins decide." } } as never))
      .toEqual({ can: false, scope: "", why: "Marketing's admins decide." });
    // No action at all on a row that is not a refusal.
    expect(allowOf(row as never).can).toBe(false);
    expect(harnessNames(row as never)).toEqual({ h1: "Support" });
  });
});
