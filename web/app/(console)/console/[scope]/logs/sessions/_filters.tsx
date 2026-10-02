"use client";

import { useRouter } from "next/navigation";
import type { SessionFilters as Filters } from "@/lib/views/session";
import { sessionsQuery } from "@/lib/views/session";
import { SESSIONS, SESSIONS_WORDS as WORDS } from "@/content/screens/sessions";
import { CONTROL } from "../../../../ui/control";

/** The select's four options are the `session` scale plus *Any*; nothing
 *  else can reach the filter, so no cast is needed to narrow it. */
function readStatus(value: string): Filters["status"] {
  return value === "active" || value === "revoked" || value === "closed" ? value : undefined;
}

/**
 * 04 §13's three filters, on the sub-header bar (01 §7.5).
 *
 * They are the one screen whose narrowing is three parameters rather than
 * one word, so they stay three controls rather than folding into the bar's
 * collapsible search — `?person=`, `?harness=` and `?status=` are what `api`
 * is asked, and one box could only guess which. The labels are read rather
 * than drawn: the bar is one line tall and a stacked label would double it.
 */
export function SessionFilters({ filters, base }: { filters: Filters; base: string }) {
  const router = useRouter();

  function go(next: Filters) {
    router.push(`${base}${sessionsQuery(next)}`, { scroll: false });
  }

  const box = `${CONTROL} h-8 w-36 py-1`;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        className={box}
        name="person"
        aria-label={WORDS.filters.person}
        placeholder={WORDS.filters.person}
        defaultValue={filters.person ?? ""}
        onBlur={(event) => go({ ...filters, person: event.target.value || undefined })}
      />
      <input
        className={box}
        name="harness"
        aria-label={WORDS.filters.harness}
        placeholder={WORDS.filters.harness}
        defaultValue={filters.harness ?? ""}
        onBlur={(event) => go({ ...filters, harness: event.target.value || undefined })}
      />
      <select
        className={box}
        name="status"
        aria-label={WORDS.filters.status}
        value={filters.status ?? ""}
        onChange={(event) => go({ ...filters, status: readStatus(event.target.value) })}
      >
        <option value="">{WORDS.filters.any}</option>
        {SESSIONS.columns.status.scale &&
          ["active", "revoked", "closed"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
      </select>
    </span>
  );
}
