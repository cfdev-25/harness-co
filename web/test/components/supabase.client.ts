/* The rig's stand-in for `lib/supabase.client.ts` (aliased in
   `playwright.config.ts`), beside the one for `lib/token.client.ts`.

   A mounted component has no `NEXT_PUBLIC_SUPABASE_*` environment and no
   session cookie, so `createBrowserClient` throws before a spec can press
   anything. The auth provider is therefore the rig's — and only it: the data
   path stays real, and what each spec asserts is the request `lib/api.ts`
   made and the words the page then rendered.

   A spec sets `window.__auth` before `mount()` and reads `window.__authCalls`
   after. The default is the state a stranger arrives in: no session. */

export interface AuthStub {
  /** Whether the link (or a sign-in) established one. */
  session?: boolean;
  /** `signInWithOtp` refuses with this message — the rate limit, live. */
  otpError?: string;
  /** `updateUser` refuses with this code and message. */
  passwordError?: { code?: string; message: string };
}

export interface AuthCall {
  name: "getSession" | "signInWithOtp" | "updateUser";
  arg?: unknown;
}

declare global {
  interface Window {
    __auth?: AuthStub;
    __authCalls?: AuthCall[];
  }
}

export function browserClient() {
  const stub = (): AuthStub => window.__auth ?? {};
  const record = (call: AuthCall) => {
    window.__authCalls = [...(window.__authCalls ?? []), call];
  };
  return {
    auth: {
      getSession: async () => {
        record({ name: "getSession" });
        const session = stub().session ? { access_token: "test-token" } : null;
        return { data: { session }, error: null };
      },
      signInWithOtp: async (arg: unknown) => {
        record({ name: "signInWithOtp", arg });
        const message = stub().otpError;
        return { data: {}, error: message ? { message } : null };
      },
      updateUser: async (arg: { password?: string }) => {
        // The password itself is never asserted — that it was sent is.
        record({ name: "updateUser", arg: { password: Boolean(arg.password) } });
        return { data: {}, error: stub().passwordError ?? null };
      },
    },
  };
}
