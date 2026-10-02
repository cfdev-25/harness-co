import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api";
import { parseScope, scopeHref } from "@/lib/scope";
import { loadViewer } from "@/lib/views/viewer";
import { PermissionNotCleared } from "../../ui/permission-not-cleared";
import { ConsoleShell } from "../../shell/shell";

/** Scope is parsed here and `Viewer` fetched once; both travel as props. */
export default async function ScopeLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ scope: string }>;
}) {
  const scope = parseScope(await params);

  /**
   * 02 rule 11's boundary for `401` and `403`. `loadViewer` is the first call
   * every console route makes, so an unauthenticated visit is caught here
   * rather than once per screen. `redirect()` throws, so it must sit outside
   * the `try` or the catch would swallow it.
   *
   * `next` is the scope's own address, not the exact URL: Next gives a layout
   * its `params` and no pathname, and the one place that could forward the
   * full path as a header — `middleware.ts` — is not this agent's to edit.
   * Reported; a header from the middleware would make this exact.
   *
   * The viewer is fetched **with the scope**, because `adminHere` is a fact
   * about the scope (01 §4.2). That makes the layout the first thing to meet
   * a scope the viewer may not open — a member typing `/console/org/…` — so
   * the refusal is rendered here, in the server's own words, inside the shell
   * at the one level everybody has (P13, D27). Without this the 403 would
   * leave the segment entirely and land on Next's own error page.
   */
  let loaded;
  let refused: ApiError | null = null;
  try {
    loaded = await loadViewer(scope);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/login?next=${encodeURIComponent(scopeHref(scope))}`);
    }
    if (error instanceof ApiError && error.status === 403) {
      refused = error;
      loaded = await loadViewer({ kind: "me" });
    } else {
      throw error;
    }
  }

  const { viewer, notice } = loaded;
  return (
    <ConsoleShell
      scope={refused ? { kind: "me" } : scope}
      viewer={viewer}
      fixtureNotice={notice}
    >
      {refused ? (
        <div className="px-6 py-6">
          <PermissionNotCleared decider={`${refused.message} ${refused.remedy ?? ""}`.trim()} />
        </div>
      ) : (
        children
      )}
    </ConsoleShell>
  );
}
