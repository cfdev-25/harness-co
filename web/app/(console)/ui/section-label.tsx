import type { ReactNode } from "react";

/** The eyebrow. Reserved for this and for table headings (01 §6). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-2xs font-bold tracking-eyebrow text-muted uppercase">{children}</p>;
}
