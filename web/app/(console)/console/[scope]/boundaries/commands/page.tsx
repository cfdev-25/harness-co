import { request } from "@/lib/api";
import { getToken } from "@/lib/token.server";
import type { SuggestedCommands } from "@/lib/views/boundaries";
import { BoundariesScreen, boundariesContext } from "../_screen";
import { SuggestCommands } from "./_suggested";

/**
 * Boundaries → Commands (04 §9, W6-D8/W6-D9/W6-D10): the command lines a
 * session may never run.
 *
 * The tab that is not like the other two. A command boundary is `intercepted`,
 * which means the **runtime** refuses the call as it is made — Pi's extension
 * blocks the `bash` call, Claude Code refuses it with a `permissions.deny`
 * rule — so each row says which runtime holds it, and says *by Pi* alone where
 * Claude Code's matcher cannot hold the pattern (engine 07 §8). And it is the
 * one tab with a starter set: `presets/command-boundaries.json`, never seeded,
 * offered to an admin of this level as one-click adds.
 */
export default async function Page({ params }: { params: Promise<{ scope: string }> }) {
  const ctx = await boundariesContext("commands", params);
  const offered = await request<SuggestedCommands>(
    `/v1/console/boundaries/suggested?scope=${ctx.query}`,
    await getToken(),
    { cache: "no-store" },
  );
  return (
    <BoundariesScreen
      tab="commands"
      ctx={ctx}
      offer={
        ctx.mayAdd && ctx.here ? (
          <SuggestCommands view={offered} scopePath={ctx.here} orgPath={ctx.orgPath} />
        ) : undefined
      }
    />
  );
}
