"use client";

import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * The one menu behaviour (01 §11): click to open — never hover — arrows,
 * Home/End, Escape, and focus back on the button. Shared by the account menu
 * and the scope switcher so the two cannot drift.
 */
export function useMenu(
  button: RefObject<HTMLButtonElement | null>,
  menu: RefObject<HTMLDivElement | null>,
) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, [button]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    const away = (event: MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && !menu.current?.contains(target) && target !== button.current) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, button, menu]);

  function onKeyDown(event: React.KeyboardEvent) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const at = items.findIndex((item) => item === document.activeElement);
    if (event.key === "Escape") close();
    else if (event.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
    else if (event.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
    else if (event.key === "Home") items[0]?.focus();
    else if (event.key === "End") items[items.length - 1]?.focus();
    else return;
    event.preventDefault();
  }

  return { open, setOpen, close, onKeyDown };
}

export const MENU_CLASS =
  "absolute top-full right-0 z-30 mt-1 grid w-56 gap-1 rounded-md border border-line bg-overlay p-1 shadow-overlay";
export const MENU_ITEM =
  "cursor-pointer rounded-sm px-3 py-2 text-left text-base text-fg no-underline hover:bg-accent-soft";
