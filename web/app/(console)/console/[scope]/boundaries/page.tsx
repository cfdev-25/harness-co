import { redirect } from "next/navigation";
import { parseScope, scopeHref } from "@/lib/scope";

/**
 * W6-D8: Boundaries is three tabs — Reach, Commands, Files — and the tabs are
 * routes. This address is in the wild (the sidebar linked it, 04 §9 named it,
 * and every bookmark of it predates the tabs), so it redirects to the tab the
 * screen opens on rather than 404ing: a permanent move of a console tab is a
 * `redirect()` (02 rule 16).
 *
 * Reach is first because it is the question a person arrives with — *how far
 * does a session of mine go?* — and the deny lists are the exceptions to its
 * answer.
 */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const scope = parseScope(await params);
  redirect(`${scopeHref(scope)}/boundaries/reach`);
}
