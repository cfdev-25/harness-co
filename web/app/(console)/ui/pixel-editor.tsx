"use client";

import { useRef, useState } from "react";
import type { PixelIcon } from "@/lib/views/types";
import { colourAt } from "./pixel-art";

export const SIZE = 16;
export const MAX_COLOURS = 16;

export const SWATCHES = [
  "#10151c", "#181e28", "#2c3544", "#8b96a8", "#e6eaf0", "#5b9bd5", "#3d7eb8", "#1a2a3d",
  "#7dbe8a", "#d4b45a", "#e08972", "#331c18", "#222a36", "#6a7586", "#7aa7c7", "#0a0e14",
];

const CHIP = "h-6 rounded-md border border-line px-2 text-xs";
const blank = (): PixelIcon => ({ palette: [], rows: Array<string>(SIZE).fill(".".repeat(SIZE)) });

export interface PixelEditorProps {
  value: PixelIcon;
  onChange: (icon: PixelIcon) => void;
  eraseLabel: string;
  clearLabel: string;
}

/** Pointer events so touch and pen paint, and a keyboard path (01 §7.13). */
export function PixelEditor({ value, onChange, eraseLabel, clearLabel }: PixelEditorProps) {
  const [colour, setColour] = useState<string | null>(SWATCHES[4]);
  const [cursor, setCursor] = useState(0);
  const grid = useRef<HTMLDivElement>(null);

  function paint(x: number, y: number) {
    let palette = value.palette;
    let mark = ".";
    if (colour !== null) {
      let index = palette.indexOf(colour);
      if (index < 0) {
        if (palette.length >= MAX_COLOURS) return;
        palette = [...palette, colour];
        index = palette.length - 1;
      }
      mark = index.toString(16);
    }
    const row = value.rows[y] ?? ".".repeat(SIZE);
    if (row[x] === mark) return;
    const rows = [...value.rows];
    rows[y] = row.slice(0, x) + mark + row.slice(x + 1);
    onChange({ palette, rows });
  }

  function move(next: number) {
    const clamped = Math.max(0, Math.min(SIZE * SIZE - 1, next));
    setCursor(clamped);
    grid.current?.querySelectorAll("button")[clamped]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const key = event.key;
    if (key === "ArrowRight") move(index + 1);
    else if (key === "ArrowLeft") move(index - 1);
    else if (key === "ArrowDown") move(index + SIZE);
    else if (key === "ArrowUp") move(index - SIZE);
    else if (key === " " || key === "Enter") paint(index % SIZE, Math.floor(index / SIZE));
    else if (/^[0-9]$/.test(key)) setColour(SWATCHES[(Number(key) + 9) % 10]);
    else return;
    event.preventDefault();
  }

  return (
    <div className="grid gap-3">
      <div
        ref={grid}
        role="group"
        aria-label="Drawing"
        className="grid w-fit rounded-md border border-line bg-surface p-1 select-none"
        style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}
      >
        {Array.from({ length: SIZE * SIZE }, (_, index) => {
          const x = index % SIZE;
          const y = Math.floor(index / SIZE);
          const fill = colourAt(value, x, y);
          return (
            <button
              key={index}
              type="button"
              tabIndex={index === cursor ? 0 : -1}
              data-cell={index}
              aria-label={`Row ${y + 1}, column ${x + 1}, ${fill ?? "transparent"}`}
              className="size-4 cursor-crosshair border border-hairline"
              style={fill ? { backgroundColor: fill } : undefined}
              onFocus={() => setCursor(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                paint(x, y);
              }}
              onPointerMove={(event) => {
                if (event.buttons !== 1) return;
                const at = document.elementFromPoint(event.clientX, event.clientY)?.getAttribute("data-cell");
                if (at != null) paint(Number(at) % SIZE, Math.floor(Number(at) / SIZE));
              }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            aria-pressed={colour === swatch}
            className={`size-6 rounded-md border-2 ${colour === swatch ? "border-fg" : "border-line"}`}
            style={{ backgroundColor: swatch }}
            onClick={() => setColour(swatch)}
          />
        ))}
        <button type="button" aria-pressed={colour === null} onClick={() => setColour(null)} className={CHIP}>
          {eraseLabel}
        </button>
        <button type="button" onClick={() => onChange(blank())} className={CHIP}>
          {clearLabel}
        </button>
      </div>
    </div>
  );
}
