import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * The Supabase session cookie, read in a server component (02 rule 7).
 * `lib/api.ts` imports neither this nor `token.client.ts` — it receives the
 * token (02 rule 9).
 */
export async function getToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        // A server component cannot write cookies; `middleware.ts` refreshes
        // the session and writes the refreshed cookie back to the response.
        setAll: () => {},
      },
    },
  );
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
