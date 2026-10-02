import { describe, expect, it } from "vitest";
import { cell, observed, records, related, sortKey, sorted, str, when } from "./cells";

describe("cells", () => {
  it("narrows an open record to the fields a column reads", () => {
    expect(str(undefined)).toBe("");
    expect(str(7)).toBe("");
    expect(records([{ a: 1 }, 2])).toEqual([{ a: 1 }, {}]);
  });

  it("keeps an observed fact observed, with its `at`", () => {
    const fact = observed({ provenance: "observed", at: "2026-01-01T00:00:00Z" }, "reachable now");
    expect(fact.provenance).toBe("observed");
    expect(fact.at).toBe("2026-01-01T00:00:00Z");
  });

  it("renders All teams as the flag, never as a list (P4)", () => {
    expect(related({ unit: "teams", items: [], all: true }, "teams")).toEqual({
      unit: "teams",
      items: [],
      all: true,
    });
  });

  it("falls back to the column's unit when the server sends an unknown one", () => {
    expect(related({ unit: "widgets", items: [] }, "groups").unit).toBe("groups");
  });

  it("sorts a Cell on its plain words and a Related on its first label", () => {
    expect(sortKey(cell("x", "Beta"))).toBe("beta");
    expect(sortKey({ unit: "teams", items: [{ label: "Zed" }] })).toBe("zed");
    const rows = [{ k: cell("b", "b") }, { k: cell("a", "a") }];
    expect(sorted(rows, "k", "asc").map((row) => row.k.text)).toEqual(["a", "b"]);
    expect(sorted(rows, "k", "desc").map((row) => row.k.text)).toEqual(["b", "a"]);
  });

  it("reads a date and leaves an unparseable one alone", () => {
    expect(when("2026-09-25T22:44:16.835944+00:00")).toBe("2026-09-25 22:44");
    expect(when("not a date")).toBe("not a date");
    expect(when(null)).toBe("");
  });
});
