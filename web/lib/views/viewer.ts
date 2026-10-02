import { cache } from "react";
import { ApiError } from "@/lib/api";
import { serverRequest } from "@/lib/api.server";
import { scopeQuery } from "@/lib/scope";
import type { PersonalChoices } from "./harness";
import type { Scope, Viewer } from "./types";

/**
 * `GET /v1/console/me?scope=`, fetched once by `[scope]/layout.tsx` (01 §4.2).
 *
 * The endpoint is 00 §4.10's and does not exist in `api` yet. In development
 * the shell renders against a fixture viewer with a visible banner so the
 * chrome can be walked; in production there is no fixture at all (K7) and the
 * error reaches the segment's `error.tsx`.
 */
export const FIXTURE_NOTICE = "console API not available — showing a fixture viewer";

const FIXTURE: Viewer = {
  user: { id: "u_jo", email: "jo@acme.example", name: "Jo Adeyemi" },
  role: { level: "member", at: "acme.marketing" },
  edition: "enterprise",
  staff: false,
  teams: [
    { path: "acme.marketing", name: "Marketing", admin: false },
    { path: "acme.marketing.interns", name: "Marketing interns", admin: false },
  ],
  visibility: { boundaries: true, logs: true, store: true },
  waiting: { harnesses: 2, people: 1 },
  adminHere: false,
};

/**
 * `cache()`d for the request: `[scope]/layout.tsx` fetches the viewer and so
 * does nearly every `page.tsx` under it, and without this React renders both
 * in the same pass and `api` answers `/v1/console/me` twice per navigation.
 * The wrapper is per request, so it is not a cache across people (K3, P2).
 *
 * The cache is keyed on the scope's **query spelling**, not on the `Scope`
 * object: `cache()` compares its arguments by identity and `parseScope`
 * builds a fresh object per call, so passing the object would miss every
 * time and fetch once per caller.
 */
const load = cache(async function load(query: string): Promise<{
  viewer: Viewer;
  notice?: string;
}> {
  try {
    const viewer = await serverRequest<Viewer>(`/v1/console/me?scope=${query}`);
    return { viewer };
  } catch (error) {
    const missing = error instanceof ApiError ? error.status === 404 : true;
    if (!missing || process.env.NODE_ENV === "production") throw error;
    return { viewer: FIXTURE, notice: FIXTURE_NOTICE };
  }
});

/**
 * `adminHere` is computed for the scope, so every caller passes the scope it
 * is drawing (01 §4.2). A page and the layout that wraps it pass the same
 * one, so they share the single fetch above.
 */
export function loadViewer(scope: Scope): Promise<{ viewer: Viewer; notice?: string }> {
  return load(scopeQuery(scope));
}

/**
 * W7-D4: what the *New harness* dialog asks a personal viewer, fetched where
 * the page already fetches — a dialog does not fetch (02 rule 2), and the two
 * screens that mount it would otherwise each decide what *personal* means.
 *
 * Enterprise is `undefined` and no second call is made: the edition is already
 * on the viewer, so the extra read happens only where the controls do. The
 * groups are the person's own (`?scope=me`), never the level being drawn — a
 * harness on your own branch takes keys you hold, not keys a team holds.
 */
export async function loadPersonalChoices(viewer: Viewer): Promise<PersonalChoices | undefined> {
  if (viewer.edition !== "personal") return undefined;
  const groups = await serverRequest<{ items: Array<{ name: string }> }>(
    "/v1/console/groups?scope=me",
  );
  return { groups: groups.items.map((group) => group.name), setup: viewer.setup };
}
