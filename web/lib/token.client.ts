"use client";

import { browserClient } from "./supabase.client";

/**
 * The browser's session cookie, read via `@supabase/ssr` (02 rule 7).
 * `lib/api.ts` imports neither this nor `token.server.ts` — it receives the
 * token (02 rule 9).
 */
export async function getToken(): Promise<string | null> {
  const {
    data: { session },
  } = await browserClient().auth.getSession();
  return session?.access_token ?? null;
}
