"use client";

import { useEffect, useState } from "react";
import { applyTheme, DEFAULT_THEME, readTheme, THEMES, type ThemeId } from "@/lib/theme";
import { CONTROL_CLASS } from "./ui";

export function ThemePicker({ labeled = false }: { labeled?: boolean }) {
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  return (
    <label className="grid gap-1">
      {labeled ? (
        <span className="text-[11px] font-bold tracking-[0.13em] text-muted uppercase">Theme</span>
      ) : (
        <span className="sr-only">Theme</span>
      )}
      <select
        className={CONTROL_CLASS}
        value={theme}
        onChange={(event) => {
          const next = event.target.value as ThemeId;
          applyTheme(next);
          setTheme(next);
        }}
      >
        {THEMES.map(({ id, label }) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
