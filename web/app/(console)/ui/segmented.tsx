"use client";

import { useRef } from "react";

export interface SegmentedProps {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
  label: string;
}

/** `role="radiogroup"`; arrows move, Space selects (01 §7.9). */
export function Segmented({ options, value, onChange, label }: SegmentedProps) {
  const group = useRef<HTMLDivElement>(null);

  function onKeyDown(event: React.KeyboardEvent) {
    const key = event.key;
    const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.id === value);
    const next = options[(index + step + options.length) % options.length];
    onChange(next.id);
    const buttons = group.current?.querySelectorAll<HTMLButtonElement>("[role='radio']");
    buttons?.[options.indexOf(next)]?.focus();
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex rounded-md border border-line bg-surface p-1"
    >
      {options.map((option) => {
        const checked = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.id)}
            className={`h-6 cursor-pointer rounded-sm px-3 text-base ${
              checked ? "bg-accent-soft font-semibold text-accent-text" : "text-muted"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
