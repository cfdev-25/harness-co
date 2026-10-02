export interface SkeletonProps {
  rows: number;
  columns: number;
}

/** Grey bars in a table's shape. Never text, never a spinner (01 §9). */
export function Skeleton({ rows, columns }: SkeletonProps) {
  return (
    <div aria-hidden="true" className="grid gap-2 py-4">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
          {Array.from({ length: columns }, (_, column) => (
            <span key={column} className="h-4 rounded-sm bg-hairline" />
          ))}
        </div>
      ))}
    </div>
  );
}
