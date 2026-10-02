import type { ReactNode } from "react";
import type { components } from "@/lib/api.generated";
import type { Fact, Related } from "./types";

/**
 * The narrowing layer between `api.generated.ts` and a `Column<Row>`.
 *
 * Every console response model extends `Meta`, whose `extra="allow"` makes the
 * generated type an open record: `Fact.value` is `unknown`, `Related.items` is
 * `Record<string, unknown>[]`, and `setBy`, `pin`, `endpoints`, `defaultFor`
 * and the rest arrive as `Record<string, unknown>`. 02 rule 15 bans `as`, so
 * every one of them is narrowed here, once, by a guard that names what it
 * expects and falls back to nothing when the server sends something else.
 *
 * `Cell` is the second half. `ui/table` renders six column kinds and none of
 * them is *a `Mono`*, *a `Chip`*, *a `Word`* or *a `CommandBlock`* — so a
 * column that needs one is declared `kind: "fact"` and its value is a
 * `Fact<ReactNode>` with `provenance: "declared"`, which `ui/fact-cell` renders
 * verbatim. `ui/table` now also offers `kind: "chip" | "mono"` and a `render`
 * escape hatch, so a `Cell` is for the columns that are genuinely facts.
 */
type Schemas = components["schemas"];
export type ApiFact = Schemas["Fact"];
export type ApiScaleTag = Schemas["ScaleTag"];
export type ApiEdgeWalk = Schemas["EdgeWalk"];

/**
 * A table cell rendered exactly as given (`kind: "fact"`, declared). `text` is
 * the same cell in plain words: `ui/fact-cell` ignores it and `sorted` sorts
 * on it, so a `Mono` or a `Chip` column can still be ordered.
 */
export interface Cell extends Fact<ReactNode> {
  text?: string;
}

export function cell(value: ReactNode, text?: string): Cell {
  return { value, provenance: "declared", text };
}

/** An observed `Fact` keeps its provenance and `at`, so the dot and the
 *  *checked just now* title survive the narrowing (P2). */
export function observed(fact: ApiFact | undefined, value: ReactNode, text?: string): Cell {
  return {
    value,
    text,
    provenance: fact?.provenance ?? "observed",
    at: typeof fact?.at === "string" ? fact.at : undefined,
  };
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

/**
 * A relationship cell, narrowed to `00 §4.7`'s shape (P4).
 *
 * It takes `unknown`, not the generated `Related`: this function *is* the
 * narrowing boundary, and asking every caller to shape the server's value
 * into the generated type first only moved the cast one file upstream (each
 * screen had grown an `asRelated` helper to do it). The guards below decide
 * what the cell renders, and anything the server sends that does not match
 * renders as an empty relationship rather than a crash.
 */
export function related(value: unknown, fallback: Related["unit"]): Related {
  const source = record(value);
  const unit = unitOf(str(source.unit)) ?? fallback;
  if (source.all === true) return { unit, items: [], all: true };
  const list = records(source.items).map((item) => ({
    id: str(item.id),
    label: str(item.label),
    href: str(item.href),
  }));
  return { unit, items: list.filter((item) => item.id !== "" || item.label !== "") };
}

const UNITS: Related["unit"][] = [
  "teams", "harnesses", "groups", "secrets", "assets", "providers", "people",
];

function unitOf(value: string): Related["unit"] | null {
  return UNITS.find((unit) => unit === value) ?? null;
}

/**
 * One sort for every screen (02 rule 5: the logic is in `lib/views`, tested at
 * V1). A `Cell` sorts on its `text`, a `Related` on its first label, and
 * anything else on itself.
 */
export function sortKey(value: unknown): string | number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.toLowerCase();
  if (isRecord(value)) {
    if ("provenance" in value) return str(value.text).toLowerCase();
    if ("unit" in value) {
      if (value.all === true) return "";
      return str(records(value.items)[0]?.label).toLowerCase();
    }
  }
  return "";
}

export function sorted<Row>(rows: Row[], key: string, dir: "asc" | "desc"): Row[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = sortKey(record(left)[key]);
    const b = sortKey(record(right)[key]);
    if (a === b) return 0;
    return a < b ? -sign : sign;
  });
}

/** The plain-words date the console shows; the ISO string is the title. */
export function when(value: unknown): string {
  const text = str(value);
  if (!text) return "";
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? text : at.toISOString().slice(0, 16).replace("T", " ");
}
