/**
 * The console's one data path (00 §2, 02 rule 9). The token is passed in and
 * never read here, so the same `request` serves server components (via
 * `token.server.ts`) and client components (via `token.client.ts`) alike.
 * This is the only place `fetch` is called in `web/` outside `scripts/` and
 * `test/` — enforced by `eslint.config.mjs`'s `no-restricted-globals`.
 */

/** The envelope every `api` error response carries (03 D30). */
interface ErrorEnvelope {
  code: string;
  message: string;
  remedy?: string;
  detail?: unknown;
}

export class ApiError extends Error {
  code: string;
  status: number;
  detail?: unknown;
  remedy?: string;

  constructor(status: number, envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = "ApiError";
    this.status = status;
    this.code = envelope.code;
    this.detail = envelope.detail;
    this.remedy = envelope.remedy;
  }
}

function unknownEnvelope(response: Response): ErrorEnvelope {
  return { code: "unknown", message: `${response.status} ${response.statusText}` };
}

async function envelopeOf(response: Response): Promise<ErrorEnvelope> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "code" in body && "message" in body) {
    const { code, message, remedy, detail } = body as Record<string, unknown>;
    if (typeof code === "string" && typeof message === "string") {
      return {
        code,
        message,
        remedy: typeof remedy === "string" ? remedy : undefined,
        detail,
      };
    }
  }
  return unknownEnvelope(response);
}

/**
 * `path` is fetched as-is through `next.config.ts`'s `/v1` rewrite in the
 * browser; on the server there is no rewrite, so it is prefixed with
 * `HARNESS_API_ORIGIN` — server-only, and there is no `NEXT_PUBLIC_` origin
 * (02 D23). A missing origin on the server is a misconfiguration, not a
 * default to fall back on.
 */
export async function request<T>(
  path: `/v1/${string}`,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const isServer = typeof window === "undefined";
  let url: string = path;
  if (isServer) {
    const origin = process.env.HARNESS_API_ORIGIN;
    if (!origin) throw new Error("HARNESS_API_ORIGIN is not set");
    url = `${origin}${path}`;
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) throw new ApiError(response.status, await envelopeOf(response));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/**
 * The server half of rule 9's two thin wrappers is `serverRequest` in
 * `lib/api.server.ts`, not here. It cannot live in this file: every
 * `"use client"` form imports `request`/`ApiError` from it, `token.server.ts`
 * imports `next/headers`, and the bundler traces a module graph — a dynamic
 * `import()` inside this file still puts `next/headers` in the client bundle
 * and the dev server answers 500 for every page. 02 rule 9 says both wrappers
 * live here; they cannot, and the split is reported.
 */
