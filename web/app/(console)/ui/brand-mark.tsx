const MASK =
  "inline-block shrink-0 bg-current [mask:url(/harness-mark.png)_center/contain_no-repeat]";

export interface BrandMarkProps {
  small?: boolean;
}

/** Server-safe: no hooks, no `"use client"` (01 §7.14). */
export function BrandMark({ small = false }: BrandMarkProps) {
  return (
    <span role="img" aria-label="Harness" className={`${MASK} ${small ? "h-6 w-10" : "h-12 w-16"}`} />
  );
}
