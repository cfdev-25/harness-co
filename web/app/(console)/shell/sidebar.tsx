"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Scope, Viewer } from "@/lib/views/types";
import { navFor, navKeyOf, pinnedNav, type NavItem } from "./nav";

export interface SidebarProps {
  scope: Scope;
  viewer: Viewer;
  /** Set inside the drawer so the `<nav>` is not a second landmark. */
  inDrawer?: boolean;
  /**
   * The route, when the caller has it. The component rig has no Next router,
   * so `usePathname()` is null there and the V2 passes the path instead.
   */
  pathname?: string;
}

/**
 * 01 §4.4, D106: an item is indented one step past its eyebrow, and both its
 * states paint the **whole row** — hovering a word and hovering the gap
 * beside it are the same gesture to the hand holding the mouse.
 */
const ITEM = "flex items-center gap-2 rounded-md py-2 ps-3 pe-2 text-base no-underline";

function Item({ item, current }: { item: NavItem; current: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={`${ITEM} ${current ? "bg-accent-soft font-semibold text-accent-text" : "text-muted hover:bg-sunken hover:text-fg"}`}
    >
      {/* 01 §4.4: the rail is 144px, so a long row truncates and carries
          its own words as a `title` rather than wrapping to two lines. */}
      <span title={item.label} className="min-w-0 flex-1 truncate">
        {item.label}
      </span>
      {item.count ? (
        <span className="rounded-full bg-hold-soft px-2 font-mono text-2xs text-hold">
          {item.count}
        </span>
      ) : null}
    </Link>
  );
}

/** `<a>` elements, one selected idiom, `navFor` decides the rest (01 §4.4). */
export function Sidebar({ scope, viewer, inDrawer = false, pathname }: SidebarProps) {
  const route = usePathname();
  const key = navKeyOf(pathname ?? route ?? "");
  const pinned = pinnedNav();
  const groups = navFor(scope, viewer);
  const grouped = groups.length > 1;
  return (
    <nav
      aria-label={inDrawer ? "Console menu" : "Console"}
      className="flex flex-col border-r border-line px-2 py-4"
    >
      {/* D106: the rows pack from the top with one fixed step between groups
          — never spread down the rail — and the eyebrows carry the grouping
          only when there is more than one group to tell apart. `navFor`
          leaves the label off the one-group case, so this is its own check
          and not a second rule about counts. */}
      {groups.map((group, index) => (
        <div
          key={group.label ?? group.items[0].key}
          className={index === 0 ? "grid gap-1" : "mt-4 grid gap-1 border-t border-hairline pt-4"}
        >
          {grouped && group.label && (
            <p className="truncate px-2 pb-1 text-2xs font-semibold tracking-eyebrow text-faint uppercase">
              {group.label}
            </p>
          )}
          {group.items.map((item) => (
            <Item key={item.key} item={item} current={item.key === key} />
          ))}
        </div>
      ))}
      <div className="mt-auto pt-4">
        <Item item={pinned} current={key === "how"} />
      </div>
    </nav>
  );
}
