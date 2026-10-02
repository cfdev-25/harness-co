"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

/**
 * The one tooltip mechanism (01 §11): opens on hover *and* on focus, is a
 * `role="tooltip"` tied by `aria-describedby`, and Escape dismisses it.
 * `title=` is never the only help. Shared by `Button.explain`, `Word` and
 * `HelpMark` so the three cannot drift.
 *
 * W6-D94: the bubble is drawn **through a portal**, not inside the trigger.
 * A `(?)` in a table heading used to render its bubble inside the `<th>`,
 * where `Table`'s `overflow-x-auto` wrapper clipped it and the viewport's
 * right edge cut the last column's help in half. The bubble is now a
 * `position: fixed` node appended to `document.body` — or to the open
 * `<dialog>` the trigger sits in, because the top layer paints over the body
 * and a bubble at the body would hide behind the backdrop — and placed from
 * the trigger's bounding rect: below and left-aligned by default, flipped
 * above when there is no room below, right-aligned when it would cross the
 * right edge, never closer than `GUTTER` to any edge. It is placed again
 * while open on scroll (capture, so an `overflow` ancestor counts) and on
 * resize, by writing the two offsets onto the node rather than through
 * state, so a scroll does not re-render the screen behind it.
 *
 * The hook therefore returns a rendered `element` rather than props to
 * spread: a portal is an element, not a bag of attributes. It is `null`
 * until the trigger's node exists, which is to say until the browser has
 * mounted it — the server renders no bubble, and neither does the first
 * client render, so hydration matches.
 */
export interface Tip {
  open: boolean;
  id: string;
  anchor: Partial<{
    "aria-describedby": string;
    /** The hook measures from the trigger, so it holds the trigger's node. */
    ref: (node: HTMLElement | null) => void;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
    onKeyDown: (event: KeyboardEvent) => void;
  }>;
  /** The bubble, already rendered — a portal — or `null`. */
  element: ReactNode | null;
}

/** The smallest distance the bubble keeps from a viewport edge, and the gap
 *  it leaves between itself and its trigger. 8px, as 01 §11 now says. */
const GUTTER = 8;

const TIP_CLASS =
  "pointer-events-none fixed z-30 w-max max-w-xs rounded-md border border-line bg-overlay px-2 py-1 text-xs font-normal text-fg normal-case shadow-overlay";

/** Measured at the origin, invisible, until the effect places it. The object
 *  is hoisted so React never rewrites the styles the effect wrote. */
const UNPLACED: CSSProperties = { top: 0, left: 0, visibility: "hidden" };

export interface Spot {
  top: number;
  left: number;
}

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Where the bubble goes, in viewport coordinates. Pure, so the flip and the
 * right-align are a unit test and not a screenshot.
 */
export function tipSpot(
  trigger: Box,
  size: { width: number; height: number },
  view: { width: number; height: number },
): Spot {
  // Left-aligned with the trigger; right-aligned with it when that would
  // cross the right edge; clamped into the gutter when the bubble is wider
  // than the room either way.
  let left = trigger.left;
  if (left + size.width > view.width - GUTTER) left = trigger.right - size.width;
  left = Math.min(Math.max(left, GUTTER), Math.max(GUTTER, view.width - GUTTER - size.width));

  // Below by default; above when there is no room below and there is room
  // above. When neither fits, below stands and the clamp keeps it on screen.
  let top = trigger.bottom + GUTTER;
  if (top + size.height > view.height - GUTTER && trigger.top - GUTTER - size.height >= GUTTER) {
    top = trigger.top - GUTTER - size.height;
  }
  top = Math.min(Math.max(top, GUTTER), Math.max(GUTTER, view.height - GUTTER - size.height));
  return { top, left };
}

export function useTip(text?: string): Tip {
  const [open, setOpen] = useState(false);
  // Where the portal goes is read during render, so it is state, set when
  // the trigger attaches: `document.body`, or the `<dialog>` the trigger is
  // inside. Null until then, which is to say on the server and on the first
  // client render — so hydration matches and there is no bubble to clip.
  const [into, setInto] = useState<HTMLElement | null>(null);
  // The two nodes are measured in an effect, never during render.
  const trigger = useRef<HTMLElement | null>(null);
  const bubble = useRef<HTMLSpanElement | null>(null);
  const id = useId();

  const close = useCallback(() => setOpen(false), []);
  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") setOpen(false);
  }, []);
  const holdTrigger = useCallback((node: HTMLElement | null) => {
    trigger.current = node;
    setInto(node ? (node.closest("dialog") ?? document.body) : null);
  }, []);
  const holdBubble = useCallback((node: HTMLSpanElement | null) => {
    bubble.current = node;
  }, []);

  useEffect(() => {
    const from = trigger.current;
    const node = bubble.current;
    if (!open || !from || !node) return;
    const place = () => {
      const box = node.getBoundingClientRect();
      const spot = tipSpot(
        from.getBoundingClientRect(),
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      node.style.top = `${spot.top}px`;
      node.style.left = `${spot.left}px`;
      node.style.visibility = "visible";
    };
    place();
    // Capture, so a scroll inside `Table`'s `overflow-x-auto` wrapper — which
    // does not bubble — moves the bubble with the trigger.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, into, text]);

  if (!text) return { open: false, id, anchor: {}, element: null };

  const anchor: Tip["anchor"] = {
    "aria-describedby": open ? id : undefined,
    ref: holdTrigger,
    onPointerEnter: () => setOpen(true),
    onPointerLeave: close,
    onFocus: () => setOpen(true),
    onBlur: close,
    onKeyDown,
  };

  if (!open || !into) return { open, id, anchor, element: null };

  return {
    open,
    id,
    anchor,
    element: createPortal(
      <span id={id} role="tooltip" ref={holdBubble} className={TIP_CLASS} style={UNPLACED}>
        {text}
      </span>,
      into,
    ),
  };
}
