"use client";

import { ReactNode, useEffect } from "react";
import { readTheme } from "@/lib/theme";

export function PublicTheme({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
    return () => {
      document.documentElement.setAttribute("data-theme", readTheme());
    };
  }, []);

  return children;
}
