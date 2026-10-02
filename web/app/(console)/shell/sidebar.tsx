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

const ITEM = "flex items-center gap-2 rounded-md px-2 py-2 text-base no-underline";

function Item({ item, current }: { item: NavItem; current: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={`${ITEM} ${current ? "bg-accent-soft font-semibold text-accent-text" : "text-muted hover:text-fg"}`}
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
  return (
    <nav
      aria-label={inDrawer ? "Console menu" : "Console"}
      className="flex flex-col gap-5 border-r border-line px-2 py-4"
    >
      {navFor(scope, viewer).map((group) => (
        <div key={group.label} className="grid gap-1">
          {/* A group whose one row says the same word as the heading — Logs,
              now that Sessions and Endpoints are its tabs — is one row, not a
              heading and a row saying it twice. */}
          {!(group.items.length === 1 && group.items[0].label === group.label) && (
            <p className="truncate px-2 pb-1 text-2xs font-bold tracking-eyebrow text-faint uppercase">
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
