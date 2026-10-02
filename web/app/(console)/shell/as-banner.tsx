"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SHELL } from "@/content/shell";
import { fill } from "@/lib/views/refusals";

export interface AsBannerProps {
  /** The member being read. */
  name: string;
  /** Where *stop reading* goes: this screen without `?as`. */
  href: string;
}

/**
 * 04 §18's strip, rendered by the shell (02 rule 17) rather than by the three
 * screens that can carry `?as`. The sentence is `content/shell.ts`'s, once.
 */
export function AsBanner({ name, href }: AsBannerProps) {
  return (
    <div
      data-as-banner={name}
      className="flex flex-wrap items-center gap-4 border-b border-hold/40 bg-hold-soft px-6 py-2"
    >
      <p className="text-base text-hold">{fill(SHELL.as.banner, { name })}</p>
      <Link href={href} className="ml-auto text-base text-accent-text hover:underline">
        {SHELL.as.leave}
      </Link>
    </div>
  );
}

/**
 * `?as` is a search param and a layout is not given search params, so the
 * shell reads it in the browser. The shell knows the member's id and not
 * their name — only the screen that fetched the view knows that — so the id
 * is what the strip names until `Viewer` carries the members a team admin may
 * read as. Stated in the report; the sentence is unchanged either way.
 */
export function ScopeAsBanner() {
  const search = useSearchParams();
  const pathname = usePathname();
  const as = search.get("as");
  if (!as) return null;
  const rest = new URLSearchParams(search);
  rest.delete("as");
  const query = rest.toString();
  return <AsBanner name={as} href={query ? `${pathname}?${query}` : (pathname ?? "")} />;
}
