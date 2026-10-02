import type { ReactNode } from "react";
import { HelpMark } from "./help-mark";

export interface KeyValueProps {
  items: Array<{ k: string; v: ReactNode; help?: string }>;
}

export function KeyValue({ items }: KeyValueProps) {
  return (
    <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2">
      {items.map((item) => (
        <div key={item.k} className="grid gap-1">
          <dt className="flex items-center gap-1 text-2xs font-bold tracking-eyebrow text-muted uppercase">
            {item.k} {item.help && <HelpMark text={item.help} />}
          </dt>
          <dd className="text-base text-fg">{item.v}</dd>
        </div>
      ))}
    </dl>
  );
}
