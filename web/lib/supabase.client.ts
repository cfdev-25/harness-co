"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * `@supabase/ssr`'s browser client keeps the session in a cookie, which is
 * what `middleware.ts` refreshes and what the console's server components
 * read through `lib/token.server.ts` (02 rule 7, 00 D20). It is a singleton
 * in the browser, so every caller here holds the same client — one client,
 * one session. It is built on demand rather than at module scope because a
 * `"use client"` module is also evaluated on the server, where there is no
 * singleton and no cookie store to attach to.
 *
 * Its own module, rather than a function in `app/auth.tsx`, for two reasons
 * that pull the same way. `/signup` now does three things with it — send the
 * email link, read the session the link established, set the password — and
 * a module is what the component rig can alias (`playwright.config.ts`); a
 * function exported beside `AuthShell` is not, because the rig needs the
 * real shell. The client also reads the session out of the URL the auth
 * provider redirected to (`detectSessionInUrl`): **constructing it is what
 * finishes a sign-in**, so where it is built is behaviour, not plumbing.
 */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
