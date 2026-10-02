import { request } from "./api";
import { getToken } from "./token.server";

/**
 * The server half of the one data path (02 rule 9): `serverRequest(path)` is
 * `request(path, await getToken())` with the cookie session, and never caches
 * an observed read (rule 12).
 *
 * It is a second file rather than an export of `lib/api.ts` because `api.ts`
 * is in the client graph — every form imports `request` and `ApiError` from
 * it — and `token.server.ts` imports `next/headers`, which a client bundle
 * may not contain. Even a dynamic `import()` inside `api.ts` is traced into
 * that bundle. So the boundary is a module boundary: `api.ts` is isomorphic,
 * this file is server-only, and nothing under `"use client"` imports it.
 */
export async function serverRequest<T>(
  path: `/v1/${string}`,
  init: RequestInit = {},
): Promise<T> {
  return request<T>(path, await getToken(), { cache: "no-store", ...init });
}
