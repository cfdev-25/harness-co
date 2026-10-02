import Link from "next/link";
import type { Related as RelatedValue } from "@/lib/views/types";

export interface RelatedProps {
  value: RelatedValue;
  /** How many before *+n more*; the unit is the column's heading, not the cell. */
  limit?: number;
}

const ALL: Record<RelatedValue["unit"], string> = {
  teams: "All teams", harnesses: "All harnesses", groups: "All groups", secrets: "All secrets",
  assets: "All assets", providers: "All providers", people: "Everyone",
};

/** Linked values with a named unit — never a tag (P4). */
export function Related({ value, limit = 4 }: RelatedProps) {
  if (value.all) return <span className="text-muted">{ALL[value.unit]}</span>;
  if (value.items.length === 0) return <span className="text-faint">&mdash;</span>;
  const shown = value.items.slice(0, limit);
  const rest = value.items.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1">
      {shown.map((item, index) => (
        <Link key={item.id} href={item.href} className="text-accent-text hover:underline">
          {item.label}
          {index < shown.length - 1 ? "," : ""}
        </Link>
      ))}
      {rest > 0 && (
        <span title={value.items.map((item) => item.label).join(", ")} className="text-faint">
          +{rest} more
        </span>
      )}
    </span>
  );
}
