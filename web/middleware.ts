import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Refreshes the Supabase session cookie on every console request, so
 * `lib/token.server.ts` and `lib/token.client.ts` both see a current session
 * (02 rule 7; 00 D20). This is the only place a token refresh is written
 * back to the response; server components and client handlers only read.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Reads the cookie and refreshes it through `setAll` only when the access
  // token has expired. Nothing here trusts the decoded session: every read
  // and write goes to `api`, which verifies the token's signature itself
  // (`identity.SupabaseJwtProvider`), so revalidating with the auth server
  // on every navigation (`getUser`) was a third of a second paid twice over.
  await supabase.auth.getSession();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
