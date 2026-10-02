import { describe, expect, it } from "vitest";
import type { Viewer } from "./types";
import {
  acceptTakes,
  fill,
  has,
  outcomeNote,
  readState,
  refusesDecision,
  requestsHaveMeaning,
  rowNote,
  staleFiles,
  totals,
  type RequestView,
} from "./requests";

const WORDS = { files: "files", file: "file", roleAsk: "asked to be a {team} admin" };

function request(over: Partial<RequestView> = {}): RequestView {
  return {
    id: "r1",
    harness: { id: "h1", name: "Campaign drafts" },
    team: { path: "acme.marketing", name: "Marketing" },
    subject: { kind: "promotion", paths: ["assets/tool/crm-sync"], commit: "abc" },
    title: "Retry flaky list calls",
    reasoning: "The list endpoint times out.",
    author: { id: "u1", name: "Jo Adeyemi" },
    at: "2026-01-01T00:00:00Z",
    state: "open",
    files: [
      { assetId: "a1", path: "assets/tool/crm-sync", added: 4, removed: 2, stale: false, diff: [] },
    ],
    discussion: [],
    verbs: ["comment"],
    ...over,
  };
}

describe("the panel", () => {
  it("reads the filter from the URL and defaults to open", () => {
    expect(readState(undefined)).toBe("open");
    expect(readState("closed")).toBe("closed");
    expect(readState("settled")).toBe("open");
  });

  it("writes the row as <author> · <n> files", () => {
    expect(rowNote(request(), WORDS)).toBe("Jo Adeyemi · 1 file");
    expect(rowNote(request({ files: [] }), WORDS)).toBe("Jo Adeyemi · 0 files");
  });

  it("reads a role request's row as what it asked for (D43)", () => {
    const role = request({
      subject: { kind: "role", level: "team-admin", team: "acme.marketing" },
      files: [],
    });
    expect(rowNote(role, WORDS)).toBe("Jo Adeyemi · asked to be a Marketing admin");
  });

  it("closed_row_carries_outcome_in_line", () => {
    const words = { accepted: "accepted", declined: "declined", withdrawn: "withdrawn" };
    expect(outcomeNote(request(), words)).toBeNull();
    const closed = request({
      state: "closed",
      outcome: { decision: "declined", by: "Rae", at: "x", reason: "not yet" },
    });
    expect(outcomeNote(closed, words)).toBe("declined");
  });
});

describe("verbs", () => {
  it("reads the verbs the server sent and never computes one (K8)", () => {
    expect(has(request({ verbs: ["accept", "decline"] }), "accept")).toBe(true);
    expect(has(request(), "accept")).toBe(false);
  });

  it("member_sees_permission_not_cleared_with_withdraw", () => {
    expect(refusesDecision(request({ verbs: ["comment", "withdraw"] }))).toBe(true);
    expect(refusesDecision(request({ verbs: ["accept", "decline"] }))).toBe(false);
  });

  it("author_can_withdraw_only_open", () => {
    const closed = request({ state: "closed", verbs: ["comment"] });
    expect(has(closed, "withdraw")).toBe(false);
    expect(refusesDecision(closed)).toBe(false);
  });

  it("accept_confirm_names_team", () => {
    expect(acceptTakes(request(), "Publishes {n} files to everyone on {team}.")).toBe(
      "Publishes 1 files to everyone on Marketing.",
    );
  });

  it("names the team in the refusal rather than a fixed one", () => {
    const sentence = "Accepting a request publishes it to everyone on {team}, so a team admin decides it.";
    expect(fill(sentence, { team: "Sales" })).toContain("everyone on Sales");
    expect(fill(sentence, {})).toContain("{team}");
  });
});

describe("the change", () => {
  it("adds the tallies up", () => {
    expect(totals(request())).toEqual({ added: 4, removed: 2 });
  });

  it("stale_file_two_column_form", () => {
    const stale = request({
      files: [{ assetId: "a", path: "p", added: 1, removed: 0, stale: true, diff: [] }],
    });
    expect(staleFiles(stale)).toHaveLength(1);
    expect(staleFiles(request())).toHaveLength(0);
  });

  it("has no meaning at a personal account (07 §3)", () => {
    const viewer = (edition: Viewer["edition"]): Viewer => ({
      user: { id: "u", email: "a@b.c", name: "A" },
      role: { level: "org-admin", at: "acme" },
      edition,
      staff: false,
      teams: [],
      adminHere: true,
      visibility: { boundaries: true, logs: true },
      waiting: {},
    });
    expect(requestsHaveMeaning(viewer("personal"))).toBe(false);
    expect(requestsHaveMeaning(viewer("enterprise"))).toBe(true);
  });
});
