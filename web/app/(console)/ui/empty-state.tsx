import { Button } from "./button";

export interface EmptyStateProps {
  /** One sentence from `content/empty.ts` (P7). */
  sentence: string;
  verb?: { label: string; href?: string; onClick?: () => void };
}

export function EmptyState({ sentence, verb }: EmptyStateProps) {
  return (
    <div className="grid justify-items-center gap-4 px-6 py-16 text-center">
      <p className="max-w-sm text-md text-muted">{sentence}</p>
      {verb && (
        <Button variant="primary" href={verb.href} onClick={verb.onClick}>
          {verb.label}
        </Button>
      )}
    </div>
  );
}
