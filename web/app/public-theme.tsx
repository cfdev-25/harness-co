"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isPublicPath, readTheme } from "@/lib/theme";

/**
 * The public marketing pages always render `light`, whatever the signed-in
 * console theme is. `isPublicPath` is the one definition of which pages
 * these are (01 §10, 00 D4) — `THEME_BOOT` reads the same list, so the first
 * paint and this effect agree and there is no flash.
 */
export function PublicTheme({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!isPublicPath(pathname)) return;
    document.documentElement.setAttribute("data-theme", "light");
    return () => {
      document.documentElement.setAttribute("data-theme", readTheme());
    };
  }, [pathname]);

  return children;
}
