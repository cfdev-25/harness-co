import type { ReactNode } from "react";

export interface CompareProps {
  left: { label: string; children: ReactNode };
  right: { label: string; children: ReactNode };
  /** Where *stale* and *conflict* live, as a `Notice` (01 §7.8). */
  notice?: ReactNode;
}

export function Compare({ left, right, notice }: CompareProps) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        {[left.label, right.label].map((label) => (
          <p key={label} className="text-2xs font-bold tracking-eyebrow text-muted uppercase">{label}</p>
        ))}
      </div>
      {notice}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0">{left.children}</div>
        <div className="min-w-0">{right.children}</div>
      </div>
    </div>
  );
}
