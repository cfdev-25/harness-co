import { describe, expect, it } from "vitest";
import { SCALES, SCALE_IDS, lookup, resolveTag, tagHref } from "./scales";

describe("the scale registry", () => {
  it("lists every scale the registry carries, in order", () => {
    expect(SCALE_IDS).toEqual(Object.keys(SCALES));
  });

  it("links every scale to its anchor on How this works", () => {
    for (const scale of SCALE_IDS) expect(tagHref(scale)).toBe(`/console/how#${scale}`);
  });

  it("finds every registered value", () => {
    for (const scale of SCALE_IDS) {
      for (const entry of SCALES[scale].values) {
        expect(lookup(scale, entry.value)).toEqual(entry);
      }
    }
  });

  // D64, both halves: the component picks the branch from NODE_ENV.
  it("throws on an unregistered value in development", () => {
    expect(() => resolveTag("approval", "wobbly", true)).toThrow(
      'Unregistered value "wobbly" for scale "approval"',
    );
  });

  it("renders an unregistered value neutral with a title in production", () => {
    expect(resolveTag("approval", "wobbly", false)).toEqual({
      value: "wobbly",
      tone: "neutral",
      meaning: "Not yet explained",
    });
  });
});
