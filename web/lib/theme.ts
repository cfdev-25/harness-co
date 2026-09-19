export const THEME_IDS = ["steel", "light", "jade", "leather"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "steel";
export const THEME_STORAGE_KEY = "harness-theme";

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "steel", label: "Steel" },
  { id: "light", label: "Light" },
  { id: "jade", label: "Jade" },
  { id: "leather", label: "Leather" },
];

export function isThemeId(value: string | null): value is ThemeId {
  return THEME_IDS.some((id) => id === value);
}

export function readTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
}

export function isPublicPath(pathname: string) {
  return pathname === "/" || pathname === "/login" || pathname.startsWith("/login/");
}

export const THEME_BOOT = `(function(){try{var p=location.pathname;if(p==="/"||p==="/login"||p.indexOf("/login/")===0){document.documentElement.setAttribute("data-theme","light");return;}var t=localStorage.getItem("${THEME_STORAGE_KEY}");document.documentElement.setAttribute("data-theme",${JSON.stringify(THEME_IDS)}.indexOf(t)>=0?t:"${DEFAULT_THEME}");}catch(e){document.documentElement.setAttribute("data-theme","${DEFAULT_THEME}");}})();`;
