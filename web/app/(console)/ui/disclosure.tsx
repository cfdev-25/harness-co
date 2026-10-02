import type { ReactNode } from "react";
import { Icon } from "./icons";

export interface DisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  /** Open on first render — a section a screen wants already unfolded. */
  defaultOpen?: boolean;
  /**
   * Told when the section opens or closes, so a screen can fetch the body it
   * reveals rather than fetching every body up front. A function prop, so a
   * `Disclosure` with one is inside a client component.
   */
  onToggle?: (open: boolean) => void;
}

export function Disclosure({ summary, children, defaultOpen, onToggle }: DisclosureProps) {
  return (
    <details
      className="group min-w-0"
      open={defaultOpen}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
    >
      <summary className="flex cursor-pointer items-center gap-2 text-base text-muted select-none hover:text-fg">
        <Icon name="chevron" size={12} className="-rotate-90 transition-transform group-open:rotate-0" />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
      </summary>
      {children}
    </details>
  );
}
