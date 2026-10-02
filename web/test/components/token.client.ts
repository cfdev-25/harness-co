/* The rig's stand-in for `lib/token.client.ts` (aliased in
   `playwright.config.ts`). A mounted component has no Supabase session
   cookie, and `createBrowserClient` throws without one, so the token is a
   fixture — what the specs assert is the request `lib/api.ts` then makes. */
export async function getToken(): Promise<string | null> {
  return "test-token";
}
