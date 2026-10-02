import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HelpMark } from "@/app/(console)/ui/help-mark";
import { tipSpot } from "@/app/(console)/ui/use-tip";

/**
 * W6-D94. The placement is a pure function so the flip and the right-align
 * are arithmetic here rather than a screenshot, and the portal's absence on
 * the server is a test rather than a hope — `createPortal` needs a document,
 * and a bubble in the server's markup would break hydration.
 */

const VIEW = { width: 1000, height: 800 };
const SIZE = { width: 320, height: 40 };

function trigger(left: number, top: number, width = 16, height = 16) {
  return { left, top, right: left + width, bottom: top + height };
}

describe("tipSpot", () => {
  it("sits below the trigger and left-aligned with it", () => {
    expect(tipSpot(trigger(100, 100), SIZE, VIEW)).toEqual({ left: 100, top: 124 });
  });

  it("right-aligns rather than crossing the right edge", () => {
    // A `(?)` in the last column: left-aligned the bubble would end at 1300.
    // Right-aligned it would end at the trigger's right, 996 — inside the
    // viewport but inside the gutter, so the gutter wins the last 4px.
    const spot = tipSpot(trigger(980, 100), SIZE, VIEW);
    expect(spot.left + SIZE.width).toBe(VIEW.width - 8);
    // A trigger with room to spare right-aligns exactly.
    expect(tipSpot(trigger(900, 100), SIZE, VIEW).left).toBe(916 - 320);
  });

  it("flips above when there is no room below", () => {
    const at = trigger(100, 760);
    const spot = tipSpot(at, SIZE, VIEW);
    expect(spot.top + SIZE.height).toBeLessThanOrEqual(at.top - 8);
  });

  it("keeps the gutter when the bubble is wider than the room either way", () => {
    const spot = tipSpot(trigger(10, 100), { width: 2000, height: 40 }, VIEW);
    expect(spot.left).toBe(8);
  });

  it("stays below when neither side has room, clamped into the viewport", () => {
    const spot = tipSpot(trigger(100, 20), { width: 320, height: 700 }, VIEW);
    expect(spot.top).toBeGreaterThanOrEqual(8);
    expect(spot.top + 700).toBeLessThanOrEqual(VIEW.height - 8);
  });
});

describe("the server renders no bubble", () => {
  it("renders the trigger and nothing else", () => {
    const html = renderToString(createElement(HelpMark, { text: "What this column holds." }));
    expect(html).toContain("aria-label=\"What this column holds.\"");
    expect(html).not.toContain("role=\"tooltip\"");
    expect(html).not.toContain("aria-describedby");
    // The help text appears once — as the trigger's label, not as a bubble.
    expect(html.split("What this column holds.").length - 1).toBe(1);
  });
});
