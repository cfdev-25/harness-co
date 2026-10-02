/**
 * The console's one clock (01 §7.7, 00 §4.2 `kind: "time"`).
 *
 * A table's time column reads in plain words — *12 minutes ago* — and carries
 * the absolute instant as its title, because the relative form is what a
 * person scans and the absolute is what they quote in a ticket. Both come
 * from here so no screen formats a date itself.
 *
 * `now` is a parameter rather than a call to `Date.now()` inside, so the V1
 * test fixes the instant and the renderer can pass the same instant to every
 * cell in one table.
 */

/**
 * `api` sends UTC. A value that carries no zone — a naive `2026-09-25 18:21`
 * a screen formatted, or a Postgres timestamp serialised without one — is
 * read as UTC rather than as the reader's local time, which is what
 * `new Date()` would do and which silently moved every cell by the viewer's
 * offset.
 */
function instant(value: string): Date {
  const text = value.trim().replace(" ", "T");
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`;
  return new Date(zoned);
}

/** The absolute instant, minute precision, as `2026-09-25 18:21 UTC`. */
export function absolute(iso: string): string {
  const at = instant(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function span(ms: number): string {
  if (ms < MINUTE) return "less than a minute";
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), "minute");
  if (ms < DAY) return plural(Math.floor(ms / HOUR), "hour");
  return plural(Math.floor(ms / DAY), "day");
}

/**
 * The relative form. Under thirty days it is *n units ago* (or *in n units*
 * for an expiry); beyond that the relative form stops meaning anything and
 * the absolute date is the honest answer.
 */
export function relative(iso: string, now: number = Date.now()): string {
  const at = instant(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const delta = now - at.getTime();
  if (Math.abs(delta) >= 30 * DAY) return absolute(iso).slice(0, 10);
  if (delta < 0) return `in ${span(-delta)}`;
  if (delta < MINUTE) return "just now";
  return `${span(delta)} ago`;
}

/** What a `time` cell renders: the words, and the instant behind them. */
export interface TimeCell {
  relative: string;
  absolute: string;
  iso: string;
}

export function timeCell(iso: string, now: number = Date.now()): TimeCell {
  return { relative: relative(iso, now), absolute: absolute(iso), iso };
}
