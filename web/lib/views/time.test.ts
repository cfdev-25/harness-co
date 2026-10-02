import { describe, expect, it } from "vitest";
import { absolute, relative, timeCell } from "./time";

/** V1 for the console's one clock (01 §7.7). The instant is a parameter, so
 *  these assertions do not move with the wall clock. */
const NOW = Date.parse("2026-09-25T18:00:00Z");

describe("time", () => {
  it("reads a recent instant in plain words", () => {
    expect(relative("2026-09-25T17:59:40Z", NOW)).toBe("just now");
    expect(relative("2026-09-25T17:59:00Z", NOW)).toBe("1 minute ago");
    expect(relative("2026-09-25T17:48:00Z", NOW)).toBe("12 minutes ago");
    expect(relative("2026-09-25T15:00:00Z", NOW)).toBe("3 hours ago");
    expect(relative("2026-09-23T18:00:00Z", NOW)).toBe("2 days ago");
  });

  it("says when something is still to happen, for an expiry", () => {
    expect(relative("2026-09-26T02:00:00Z", NOW)).toBe("in 8 hours");
  });

  it("falls back to the date once the relative form stops meaning anything", () => {
    expect(relative("2026-01-04T09:30:00Z", NOW)).toBe("2026-01-04");
  });

  it("keeps the absolute instant for the title", () => {
    expect(absolute("2026-09-25T17:48:16.835944+00:00")).toBe("2026-09-25 17:48 UTC");
  });

  it("reads a value with no zone as UTC, which is what `api` sends", () => {
    // A naive datetime, or a date alone, must not move by the reader's offset.
    expect(relative("2026-09-25 17:48:00", NOW)).toBe("12 minutes ago");
    expect(absolute("2026-09-25 17:48:00")).toBe("2026-09-25 17:48 UTC");
    expect(absolute("2026-01-04")).toBe("2026-01-04 00:00 UTC");
    expect(relative("2026-01-04", NOW)).toBe("2026-01-04");
  });

  it("leaves a value it cannot read alone rather than printing Invalid Date", () => {
    expect(relative("not a date", NOW)).toBe("not a date");
    expect(absolute("not a date")).toBe("not a date");
  });

  it("gives a cell both forms and the machine-readable original", () => {
    expect(timeCell("2026-09-25T17:48:00Z", NOW)).toEqual({
      relative: "12 minutes ago",
      absolute: "2026-09-25 17:48 UTC",
      iso: "2026-09-25T17:48:00Z",
    });
  });
});
