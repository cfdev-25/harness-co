"use client";

/* The drawing a harness is known by. Sixteen by sixteen, a handful of
   colours, and no dependency: an SVG rect per opaque pixel to show one, a
   grid of buttons to make one. */

import { useEffect, useState } from "react";
import { PixelIcon } from "@/lib/types";
import { Button } from "./ui";

export const SIZE = 16;
export const MAX_COLORS = 16;

/* The swatches. Brand tokens first, then enough range to draw something
   recognisable. Sixteen of them, which is also the most an icon may hold, so
   a drawing can never want a colour it cannot store. */
export const SWATCHES = [
  "#10151c",
  "#181e28",
  "#2c3544",
  "#8b96a8",
  "#e6eaf0",
  "#5b9bd5",
  "#3d7eb8",
  "#1a2a3d",
  "#7dbe8a",
  "#d4b45a",
  "#e08972",
  "#331c18",
  "#222a36",
  "#6a7586",
  "#7aa7c7",
  "#0a0e14",
];

export function blankIcon(): PixelIcon {
  return { palette: [], rows: Array<string>(SIZE).fill(".".repeat(SIZE)) };
}

function colorAt(icon: PixelIcon, x: number, y: number) {
  const index = Number.parseInt(icon.rows[y]?.[x] ?? ".", 16);
  return Number.isNaN(index) ? undefined : icon.palette[index];
}

/** A drawing at any size. Transparent pixels are simply not drawn. */
export function PixelArt({
  icon,
  size,
  className = "",
}: {
  icon?: PixelIcon;
  size: number;
  className?: string;
}) {
  const rows = icon?.rows ?? [];
  const height = rows.length || SIZE;
  const width = rows[0]?.length || SIZE;
  return (
    <svg
      role="img"
      aria-label="Harness drawing"
      viewBox={`0 0 ${width} ${height}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={`shrink-0 rounded-md border border-line bg-sunken ${className}`}
    >
      {rows.flatMap((row, y) =>
        [...row].map((_, x) => {
          const fill = icon && colorAt(icon, x, y);
          return fill ? (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />
          ) : null;
        }),
      )}
    </svg>
  );
}

/**
 * Draw one. Picking a colour that is not yet in the icon's palette adds it,
 * so an icon carries only the colours it uses and one made elsewhere — with
 * its own palette — still edits correctly.
 */
export function PixelEditor({
  value,
  onChange,
}: {
  value: PixelIcon;
  onChange: (icon: PixelIcon) => void;
}) {
  const [color, setColor] = useState<string | null>(SWATCHES[4]);
  const [painting, setPainting] = useState(false);

  /* The pointer often leaves the grid before it is released, so the end of a
     stroke is a window event rather than a cell event. */
  useEffect(() => {
    const stop = () => setPainting(false);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  function paint(x: number, y: number) {
    let palette = value.palette;
    let mark = ".";
    if (color !== null) {
      let index = palette.indexOf(color);
      if (index < 0) {
        if (palette.length >= MAX_COLORS) return;
        palette = [...palette, color];
        index = palette.length - 1;
      }
      mark = index.toString(16);
    }
    const row = value.rows[y] ?? "";
    if (row[x] === mark) return;
    const rows = [...value.rows];
    rows[y] = row.slice(0, x) + mark + row.slice(x + 1);
    onChange({ palette, rows });
  }

  return (
    <div className="grid gap-3">
      <div
        className="grid w-fit grid-cols-16 gap-0 rounded-md border border-line bg-surface p-1 select-none"
        style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}
        onMouseDown={() => setPainting(true)}
      >
        {value.rows.flatMap((row, y) =>
          Array.from({ length: SIZE }, (_, x) => {
            const fill = colorAt(value, x, y);
            return (
              <button
                key={`${x}-${y}`}
                type="button"
                aria-label={`Row ${y + 1}, column ${x + 1}`}
                className="size-4 cursor-crosshair border-[0.5px] border-hairline"
                style={fill ? { backgroundColor: fill } : undefined}
                onMouseDown={() => paint(x, y)}
                onMouseEnter={() => painting && paint(x, y)}
              />
            );
          }),
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            title={swatch}
            aria-pressed={color === swatch}
            className={`size-6 rounded-md border-2 ${
              color === swatch ? "border-ink" : "border-line"
            }`}
            style={{ backgroundColor: swatch }}
            onClick={() => setColor(swatch)}
          />
        ))}
        <Button
          size="sm"
          aria-pressed={color === null}
          className={color === null ? "border-ink" : ""}
          onClick={() => setColor(null)}
        >
          Erase
        </Button>
        <Button size="sm" onClick={() => onChange(blankIcon())}>
          Clear
        </Button>
      </div>
    </div>
  );
}
