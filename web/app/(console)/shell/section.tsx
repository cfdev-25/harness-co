"use client";

import { usePathname } from "next/navigation";
import { NAV_LABELS, navKeyOf } from "./nav";

export interface SectionProps {
  /**
   * The route, when the caller has it. The component rig has no Next router,
   * so `usePathname()` is null there and the V2 passes the path instead —
   * the same arrangement `Sidebar` has.
   */
  pathname?: string;
}

/**
 * Which screen you are on, as the second half of the header's breadcrumb —
 * *Harness › Assets* (01 §4.3).
 *
 * The name of the page belongs to the chrome, not to the page: it is the
 * sidebar row you pressed, so it is `navKeyOf` and `NAV_LABELS` and never a
 * string a screen passes. It is the document's one `<h1>` (02 rule 35); a
 * detail screen is still its section — *Harnesses*, not the harness — and
 * names the thing it is showing in its own content. The separator is the
 * component's, not the header's, so a route under no nav key leaves no
 * dangling chevron behind.
 */
export function Section({ pathname }: SectionProps) {
  const route = usePathname();
  const key = navKeyOf(pathname ?? route ?? "");
  if (key === null) return null;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className="text-muted">›</span>
      <h1 className="truncate text-md font-bold text-fg">{NAV_LABELS[key]}</h1>
    </span>
  );
}
