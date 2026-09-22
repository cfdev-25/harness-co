"use client";

import { useState, useSyncExternalStore } from "react";
import { applyTheme, DEFAULT_THEME, readTheme, THEMES, type ThemeId } from "@/lib/theme";
import { CONTROL_CLASS } from "./ui";

/** The stored theme only changes through applyTheme, so nothing to subscribe to. */
function subscribe() {
  return () => {};
}

export function ThemePicker({ labeled = false }: { labeled?: boolean }) {
  // The stored theme is only knowable in the browser, so the server and the
  // first paint both use the default and the client swaps to it on hydration.
  const stored = useSyncExternalStore(subscribe, readTheme, () => DEFAULT_THEME);
  const [chosen, setChosen] = useState<ThemeId | null>(null);
  const theme = chosen ?? stored;

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
          setChosen(next);
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
