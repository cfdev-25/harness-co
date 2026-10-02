import { request } from "@/lib/api";
import { getToken } from "@/lib/token.server";
import type { ReachView } from "@/lib/views/reach";
import { BoundariesScreen, boundariesContext } from "../_screen";
import { ReachSection } from "./_reach";

/**
 * Boundaries → Reach (04 §9.1, W5-D5, W6-D8). The tab the screen opens on:
 * reach is how far a session goes before a deny is even asked, and the
 * endpoint boundaries below it are the exceptions to that answer.
 *
 * The section is unchanged from the one that sat at the top of the screen —
 * mode, this level's host list, the suggested adds — and is now the *above*
 * of this tab's two blocks rather than a section of a single long page.
 */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const ctx = await boundariesContext("reach", params);
  const reach = await request<ReachView>(`/v1/console/reach?scope=${ctx.query}`, await getToken(), {
    cache: "no-store",
  });
  return (
    <BoundariesScreen
      tab="reach"
      ctx={ctx}
      above={<ReachSection view={reach} viewer={ctx.viewer} scopeQuery={ctx.query} />}
    />
  );
}
