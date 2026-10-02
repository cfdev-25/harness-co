import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "@/lib/api";

/**
 * `request`'s error mapping (02 rule 9, D30 envelope) is the one place a
 * stubbed `fetch` is allowed (02 rule 31) — there is no server to test it
 * against here.
 */
describe("request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds an ApiError from the server's envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({
          code: "harness_not_found",
          message: "No such harness.",
          remedy: "Check the harness id.",
        }),
      }),
    );

    const error = await request("/v1/harnesses/x", "a-token").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      code: "harness_not_found",
      message: "No such harness.",
      remedy: "Check the harness id.",
    });
  });

  it("falls back to the status line when the body carries no envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new Error("not json");
        },
      }),
    );

    const error = await request("/v1/harnesses", null).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 500,
      code: "unknown",
      message: "500 Internal Server Error",
    });
  });

  it("sends the token as a bearer header and omits it when null", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await request("/v1/console/me", "a-token");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer a-token");

    await request("/v1/console/me", null);
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((secondInit.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
