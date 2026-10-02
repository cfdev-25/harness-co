import type { ReactNode } from "react";

/**
 * The console's own layout. The root layout owns the fonts and the theme
 * boot; this group exists so the console's chrome, its component library and
 * its screens sit together and the public site shares nothing but tokens.
 */
export default function ConsoleGroupLayout({ children }: { children: ReactNode }) {
  return children;
}
