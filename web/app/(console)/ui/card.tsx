import type { ReactNode } from "react";

export interface CardProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** A surface with an edge, not a lift (01 §5). */
export function Card({ title, actions, children }: CardProps) {
  return (
    <section className="rounded-lg border border-line bg-surface shadow-card">
      {(title || actions) && (
        <header className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-3">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
