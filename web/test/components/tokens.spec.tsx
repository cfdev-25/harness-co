import { expect, test } from "@playwright/experimental-ct-react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB = join(__dirname, "..", "..");
const CONSOLE_DIR = join(WEB, "app", "(console)");
const CSS = readFileSync(join(WEB, "app", "globals.css"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const SOURCES = walk(CONSOLE_DIR).filter((path) => /\.tsx?$/.test(path));

test("no_arbitrary_font_sizes_in_console", () => {
  const banned = /text-\[|shadow-\[|rounded-\[|(?:^|[^a-z-])(?:p|m|gap|w|h)-\[/;
  const offenders = SOURCES.flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .map((line, index) => ({ path, index, line }))
      .filter(({ line }) => banned.test(line))
      .map(({ path, index, line }) => `${path}:${index + 1} ${line.trim()}`),
  );
  expect(offenders).toEqual([]);
});

test("only_ui_imports_in_screens", () => {
  const screens = SOURCES.filter((path) => path.includes(`${join("(console)", "console")}`));
  const banned = /from "[^"]*(app\/ui|org-preview|team-preview|user-preview)/;
  // …and no screen reaches sideways into *another* screen's directory. Three
  // relative shapes are its own: `../../` up into `shell/` and `ui/`, the
  // shared `_screens` part, and a `_`-prefixed private part of an ancestor
  // route in the same screen (`logs/[category]` reading `logs/_tabs`) — which
  // 02 rule 2 allows, since a private part belongs to that screen and nobody
  // else may import it.
  const relative = /from "((?:\.\.\/)+[^"]*)"/g;
  const allowed = /^(?:\.\.\/)+(?:ui|shell)\/|^(?:\.\.\/)+_[a-z][a-z-]*$/;
  const offenders = screens.filter((path) => {
    const source = readFileSync(path, "utf8");
    if (banned.test(source)) return true;
    return [...source.matchAll(relative)].some((match) => !allowed.test(match[1]));
  });
  expect(offenders).toEqual([]);
});

function names(block: string) {
  return new Set(
    [...block.matchAll(/(--(?:color|text|radius|shadow)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  );
}

test("every_token_defined_in_both_themes", () => {
  const theme = names(/@theme \{([\s\S]*?)\n\}/.exec(CSS)![1]);
  const light = names(/html\[data-theme="light"\] \{([\s\S]*?)\n\}/.exec(CSS)![1]);
  // `light` redefines a subset on the same element the theme declares, so the
  // effective set is identical — every name it carries must already exist.
  expect([...light].filter((name) => !theme.has(name))).toEqual([]);
  for (const required of ["--color-accent-text", "--text-base", "--radius-md", "--shadow-modal"]) {
    expect(theme.has(required)).toBe(true);
  }
  expect(CSS).not.toMatch(/data-theme="(jade|leather)"/);
});

function channel(value: number) {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((at) => channel(Number.parseInt(hex.slice(at, at + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function values(block: string) {
  return Object.fromEntries([...block.matchAll(/(--color-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

test("contrast_meets_aa", () => {
  const steel = values(/@theme \{([\s\S]*?)\n\}/.exec(CSS)![1]);
  const light = { ...steel, ...values(/html\[data-theme="light"\] \{([\s\S]*?)\n\}/.exec(CSS)![1]) };
  const resolve = (theme: Record<string, string>, token: string): string => {
    const value = theme[`--color-${token}`];
    return value.startsWith("var(") ? resolve(theme, value.slice(12, -1)) : value;
  };
  const ratio = (theme: Record<string, string>, a: string, b: string) => {
    const [x, y] = [luminance(resolve(theme, a)), luminance(resolve(theme, b))];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  for (const theme of [steel, light]) {
    expect(ratio(theme, "fg", "surface")).toBeGreaterThanOrEqual(12);
    expect(ratio(theme, "muted", "surface")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(theme, "accent-text", "surface")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(theme, "ink", "accent")).toBeGreaterThanOrEqual(4.5);
    for (const tone of ["ok", "hold", "warn"]) {
      expect(ratio(theme, tone, `${tone}-soft`)).toBeGreaterThanOrEqual(4.5);
    }
    // D69: `faint` is below AA by design and never carries required text.
    const faint = ratio(theme, "faint", "surface");
    expect(faint).toBeGreaterThanOrEqual(3);
    expect(faint).toBeLessThan(4.5);
  }
});
