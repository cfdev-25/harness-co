"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { scopeHref } from "@/lib/scope";
import type { Scope, Viewer } from "@/lib/views/types";
import { levelLabel, levelRows } from "@/lib/views/level";
import { SHELL } from "@/content/shell";
import { Icon } from "../ui/icons";
import { navFor, navKeyOf } from "./nav";
import { MENU_CLASS, MENU_ITEM, useMenu } from "./use-menu";

export interface ScopeSwitcherProps {
  scope: Scope;
  viewer: Viewer;
}

/** Choosing goes to the same screen at the new scope where it exists. */
export function ScopeSwitcher({ scope, viewer }: ScopeSwitcherProps) {
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<HTMLDivElement>(null);
  const menu = useMenu(button, items);
  const key = navKeyOf(usePathname() ?? "");
  // The screen the viewer is on, at the level they are choosing — when that
  // level has it. `navFor` is asked with this viewer, whose `adminHere` is
  // the *current* level's, so a screen only the other level's admin holds
  // falls back to its Harnesses, which every level has.
  const at = (target: Scope) =>
    navFor(target, viewer)
      .flatMap((group) => group.items)
      .find((item) => item.key === key)?.href ?? scopeHref(target, "/harnesses");

  return (
    <div className="relative" onKeyDown={menu.onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={() => menu.setOpen(!menu.open)}
        className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-line bg-sunken px-3 text-base text-fg"
      >
        {levelLabel(scope, viewer)}
        <Icon name="chevron" size={12} />
      </button>
      {menu.open && (
        <div ref={items} role="menu" aria-label={SHELL.switcher.label} className={`${MENU_CLASS} left-0`}>
          {levelRows(scope, viewer).map((row) => (
            <Link
              key={`${row.scope.kind}:${row.scope.kind === "team" ? row.scope.path : ""}`}
              role="menuitem"
              href={at(row.scope)}
              aria-current={row.current ? "true" : undefined}
              style={{ paddingInlineStart: `${12 + row.depth * 14}px` }}
              // 01 §4.4's one selected idiom, so the current level is marked
              // by the same pair everywhere in the chrome.
              className={`${MENU_ITEM} ${row.current ? "bg-accent-soft font-semibold text-accent-text" : ""}`}
            >
              {row.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
