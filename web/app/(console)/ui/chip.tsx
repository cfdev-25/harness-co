import type { ReactNode } from "react";

export interface ChipProps {
  children: ReactNode;
  title?: string;
}

/** A bordered monospace value: an alias, an env-var name, a kind. */
export function Chip({ children, title }: ChipProps) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center truncate rounded-md border border-line bg-sunken px-2 font-mono text-xs text-fg"
    >
      {children}
    </span>
  );
}
