import { headers } from "next/headers";

/**
 * The console's own public origin, read off the request that is being
 * answered — `https://theharnessmanager.com` in production,
 * `http://127.0.0.1:3000` in development, with no variable to set and none
 * to go stale.
 *
 * *How this works* → *Set up* prints `curl -fsSL <origin>/install.sh | sh`,
 * and `npm run prebuild` is what puts `scripts/install.sh` at that path. The
 * API's origin cannot be derived this way (02 D23 — the browser has only the
 * `/v1` rewrite), which is the whole of why that one is a variable and this
 * one is not.
 *
 * `x-forwarded-*` first: behind Vercel's proxy `host` is the internal name
 * and the forwarded pair is the address the person typed. Server-only, like
 * `token.server.ts`: `next/headers` must never reach a client bundle.
 */
export async function consoleOrigin(): Promise<string> {
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "";
  const proto = head.get("x-forwarded-proto") ?? (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
