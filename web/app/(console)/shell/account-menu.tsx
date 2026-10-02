"use client";

import Link from "next/link";
import { useRef } from "react";
import { scopeHref } from "@/lib/scope";
import { applyTheme, THEMES } from "@/lib/theme";
import type { Viewer } from "@/lib/views/types";
import { MENU_CLASS, MENU_ITEM, useMenu } from "./use-menu";

export interface AccountMenuProps {
  viewer: Viewer;
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

export function AccountMenu({ viewer }: AccountMenuProps) {
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<HTMLDivElement>(null);
  const menu = useMenu(button, items);
  return (
    <div className="relative" onKeyDown={menu.onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-label={viewer.user.name}
        onClick={() => menu.setOpen(!menu.open)}
        className="size-8 cursor-pointer rounded-full border border-line bg-sunken font-mono text-xs text-fg"
      >
        {initials(viewer.user.name)}
      </button>
      {menu.open && (
        <div ref={items} role="menu" aria-label={viewer.user.name} className={MENU_CLASS}>
          <Link role="menuitem" href={scopeHref({ kind: "me" }, "/account")} className={MENU_ITEM}>
            Account
          </Link>
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              role="menuitem"
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                applyTheme(theme.id);
                menu.close();
              }}
            >
              Theme: {theme.label}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM}
            onClick={async () => {
              // The session is a cookie (02 rule 7); a bare link to /login would bounce straight back in.
              const { createBrowserClient } = await import("@supabase/ssr");
              await createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!).auth.signOut();
              window.location.assign("/login");
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
