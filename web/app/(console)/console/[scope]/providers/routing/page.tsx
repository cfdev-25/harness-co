import { redirect } from "next/navigation";
import { parseScope, scopeHref } from "@/lib/scope";

/**
 * W6-D5: the Routing tab is gone. Routing is a setting — which model provider
 * serves a team, a harness or a runtime, and which may — so it lives on the
 * Model providers row that owns it, as *Default for* and *Approved for* with
 * the two verbs that write them. What actually served a session is a record and
 * is already on Logs → Sessions.
 *
 * The route stays as a redirect because it is in the wild: bookmarks, the
 * sidebar of an older build, and 04 §10 itself named it. A permanent move of a
 * console tab is a `redirect()`, not a 404 (02 rule 16).
 */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const scope = parseScope(await params);
  redirect(`${scopeHref(scope)}/providers/model`);
}
