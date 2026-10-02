import type { PixelIcon } from "@/lib/views/types";

export interface PixelArtProps {
  icon?: PixelIcon;
  size: number;
  /** The drawing's text alternative, from the harness description. */
  alt: string;
}

export function colourAt(icon: PixelIcon, x: number, y: number): string | undefined {
  const index = Number.parseInt(icon.rows[y]?.[x] ?? ".", 16);
  return Number.isNaN(index) ? undefined : icon.palette[index];
}

/** A drawing at any size; transparent pixels are simply not drawn. */
export function PixelArt({ icon, size, alt }: PixelArtProps) {
  const rows = icon?.rows ?? [];
  const height = rows.length || 16;
  const width = rows[0]?.length || 16;
  return (
    <svg
      role="img"
      aria-label={alt}
      viewBox={`0 0 ${width} ${height}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="shrink-0 rounded-md border border-line bg-sunken"
    >
      {rows.flatMap((row, y) =>
        [...row].map((_, x) => {
          const fill = icon && colourAt(icon, x, y);
          return fill ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} /> : null;
        }),
      )}
    </svg>
  );
}
