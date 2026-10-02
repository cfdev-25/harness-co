import { Button } from "./button";

export interface PermissionNotClearedProps {
  /** The sentence naming who decides, from `content/refusals.ts` (P13). */
  decider: string;
  ask?: { label: string; href: string };
}

/** Rendered where the button would be. There is no disabled button (P13). */
export function PermissionNotCleared({ decider, ask }: PermissionNotClearedProps) {
  return (
    <div className="grid justify-items-start gap-3 rounded-lg border border-line bg-sunken px-4 py-3">
      <p className="text-base text-muted">{decider}</p>
      {ask && <Button href={ask.href}>{ask.label}</Button>}
    </div>
  );
}
