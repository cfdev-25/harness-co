import type { ReactNode } from "react";

export interface MonoProps {
  children: ReactNode;
  title?: string;
}

/** An unbordered monospace value: ids, refs, timestamps. */
export function Mono({ children, title }: MonoProps) {
  return (
    <span title={title} className="font-mono text-xs text-muted">
      {children}
    </span>
  );
}
