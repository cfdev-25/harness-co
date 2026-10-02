import { notFound } from "next/navigation";
import type { Scope } from "@/lib/views/types";

/**
 * Scope is ONE segment (00 D2, 02 rule 4): `org` · `me` · a dotted team path.
 * A team path always contains a dot and `org`/`me` never do, so the single
 * `[scope]` segment carries all three and there is one route tree. No React
 * context carries `Scope`.
 */
export interface ScopeParams {
  scope?: string;
}

/** The pure reader: `null` for a segment that names no scope (V1 tested). */
export function readScope(params: ScopeParams): Scope | null {
  const segment = params.scope;
  if (!segment) return null;
  if (segment === "org") return { kind: "org" };
  if (segment === "me") return { kind: "me" };
  // D2: a dot is what makes a segment a team path; nothing else is a scope.
  if (segment.includes(".")) return { kind: "team", path: segment };
  return null;
}

/** What a `layout.tsx` or `page.tsx` calls: an unknown scope is a 404. */
export function parseScope(params: ScopeParams): Scope {
  return readScope(params) ?? notFound();
}

/** The one URL segment a scope occupies (D2). */
export function scopeSegment(scope: Scope): string {
  if (scope.kind === "team") return scope.path;
  return scope.kind;
}

/** The scope's own word, for the switcher and the trail. */
export function scopeLabel(scope: Scope, teamName?: string): string {
  if (scope.kind === "org") return "Organization";
  if (scope.kind === "me") return "Me";
  if (scope.kind === "platform") return "Platform";
  return teamName ?? scope.path.split(".").slice(-1)[0];
}

/**
 * Every internal console link is built here (02 rule 4); `as` is carried,
 * never stored (rule 17). `path` starts with `/` and is the screen's path
 * below the scope — `scopeHref(scope, "/harnesses")`.
 */
export function scopeHref(
  scope: Scope,
  path: string = "",
  options: { as?: string | null } = {},
): string {
  const href = `/console/${scopeSegment(scope)}${path}`;
  return options.as ? `${href}?as=${encodeURIComponent(options.as)}` : href;
}

/**
 * The same scope as `api` spells it in a query string: `org` · `me` ·
 * `team:<dotted path>` (03 §4). It lives beside `scopeSegment` because a
 * scope has exactly two spellings — one for the URL, one for the api — and a
 * screen that writes either by hand will eventually write one of them wrong.
 */
export function scopeQuery(scope: Scope): string {
  if (scope.kind === "team") return `team:${encodeURIComponent(scope.path)}`;
  return scope.kind === "org" ? "org" : "me";
}

/** The one scope-independent screen: every tag links into it (K4). */
export function howHref(anchor?: string): string {
  return anchor ? `/console/how#${anchor}` : "/console/how";
}
