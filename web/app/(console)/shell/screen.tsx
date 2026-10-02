"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export interface ScreenProps {
  /** The sub-header bar (`SubHeader`) — the only header a screen has, and
   *  the one sticky thing it adds (01 §7.5). */
  bar?: ReactNode;
  aside?: ReactNode;
  asideSide?: "start" | "end";
  children: ReactNode;
}

/**
 * What a screen renders inside `main`. The bar publishes its own height as
 * `--sub-h` so the sub-sidebar can stick below it (01 §4.1); it is never a
 * second scroll container.
 */
export function Screen({ bar, aside, asideSide = "start", children }: ScreenProps) {
  const root = useRef<HTMLDivElement>(null);
  const sub = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = sub.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      root.current?.style.setProperty("--sub-h", `${Math.round(entry.contentRect.height)}px`);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const body = aside ? (asideSide === "end" ? "body with-aside-end" : "body with-aside") : "body";
  return (
    <div ref={root} className="screen">
      <div ref={sub} className="sub">
        {bar}
      </div>
      <div className={body}>
        {aside && asideSide === "start" && <aside aria-label="Panel">{aside}</aside>}
        <div className="min-w-0">{children}</div>
        {aside && asideSide === "end" && <aside aria-label="Panel">{aside}</aside>}
      </div>
    </div>
  );
}
