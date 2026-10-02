import { request } from "./api";

/**
 * The one place the console mints a personal access token.
 *
 * `POST /v1/personal-access-tokens` (`routes_auth.create_pat`) answers the row
 * it inserted **plus** `token`, the raw `hpat_…` value — the database holds
 * only its SHA-256, so the response is the only time it exists anywhere the
 * person can read it. Two screens need one (the Account card and *How this
 * works* → *Set up*, console D105) and a second `fetch` would be a second
 * shape to keep true, so the call lives here and both call it.
 *
 * The session bearer is **passed in**: `lib/` never imports `token.client`
 * (02 rule 9), which is also what keeps the component rig's alias working.
 *
 * Hand-written rather than read off `lib/api.generated.ts`, per the wave's
 * ground rule on regeneration.
 */
export interface CreatedToken {
  id: string;
  name: string;
  expires_at: string | null;
  created_at: string;
  token: string;
}

export async function createAccessToken(
  session: string | null,
  name: string,
): Promise<CreatedToken> {
  return request<CreatedToken>("/v1/personal-access-tokens", session, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/**
 * The name the *Set up* section gives a token it mints for someone who did not
 * ask to name it: what made it and the day it was made. `harness login` is
 * per machine, so the date is the only thing that distinguishes two of them,
 * and a person who can see the list can still tell them apart.
 */
export function setupTokenName(now: Date): string {
  return `console setup ${now.toISOString().slice(0, 10)}`;
}
