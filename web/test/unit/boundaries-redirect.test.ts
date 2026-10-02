import { describe, expect, it, vi } from "vitest";

/**
 * W6-D8: `boundaries/` is three tabs now, and the bare address is in the wild
 * — the sidebar linked it, 04 §9 named it, and every bookmark of it predates
 * the tabs. So it redirects to the tab the screen opens on rather than 404ing
 * (02 rule 16), at every scope.
 */
const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

describe("boundaries redirect", () => {
  it("sends the bare screen to the Reach tab at every scope", async () => {
    const { default: Page } = await import(
      "@/app/(console)/console/[scope]/boundaries/page"
    );
    for (const [scope, to] of [
      ["org", "/console/org/boundaries/reach"],
      ["me", "/console/me/boundaries/reach"],
      ["acme.marketing", "/console/acme.marketing/boundaries/reach"],
    ] as const) {
      redirect.mockClear();
      await Page({ params: Promise.resolve({ scope }) });
      expect(redirect).toHaveBeenCalledWith(to);
    }
  });
});
