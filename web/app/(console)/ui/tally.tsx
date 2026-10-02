export interface TallyProps {
  added: number;
  removed: number;
}

export function Tally({ added, removed }: TallyProps) {
  return (
    <span className="font-mono text-xs whitespace-nowrap">
      <span className="text-ok">+{added}</span> <span className="text-warn">&minus;{removed}</span>
    </span>
  );
}
