import { describe, expect, it } from "vitest";
import { HOW_HREF, OS_IDS, detectOs, howTabs } from "@/lib/views/how";
import { HOW_SETUP, HOW_TEXT } from "@/content/screens/how";

/**
 * V1 for *How this works*' two tabs and its one guess (04 §16, §16.1). The
 * tabs are routes, so the helper is where the two URLs live and this is where
 * they are kept honest — the same shape `lib/views/logs.ts` has for Logs.
 */

describe("howTabs — Set up and Reference (04 §16)", () => {
  it("is two tabs, Set up first", () => {
    expect(howTabs("setup").map((tab) => tab.label)).toEqual([
      HOW_TEXT.tabs.setUp,
      HOW_TEXT.tabs.reference,
    ]);
  });

  it("marks exactly the route that is open", () => {
    expect(howTabs("setup").map((tab) => tab.current)).toEqual([true, false]);
    expect(howTabs("reference").map((tab) => tab.current)).toEqual([false, true]);
  });

  it("keeps the reference at /console/how, so every scale anchor still resolves", () => {
    expect(HOW_HREF.reference).toBe("/console/how");
    expect(HOW_HREF.setup).toBe("/console/how/setup");
    expect(howTabs("setup").map((tab) => tab.href)).toEqual([HOW_HREF.setup, HOW_HREF.reference]);
  });
});

describe("detectOs — step 1's keystroke (04 §16.1)", () => {
  it("reads a user agent", () => {
    expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectOs("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });

  it("falls back to the deprecated platform, then to the commonest machine", () => {
    expect(detectOs("", "Win32")).toBe("windows");
    expect(detectOs("", "Linux aarch64")).toBe("linux");
    expect(detectOs("", "")).toBe("mac");
  });

  it("has a keystroke for every machine it can answer", () => {
    for (const id of OS_IDS) {
      expect(HOW_SETUP.os.keys[id].length, id).toBeGreaterThan(0);
      expect(HOW_SETUP.os.options[id].length, id).toBeGreaterThan(0);
    }
  });
});
