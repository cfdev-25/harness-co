/** What a write spec needs, shared (01 §13). Not a test file.
 *
 *  A write is proved at the wire, not at a module boundary: the component
 *  calls the real `lib/api.ts`, and the route below records the method, the
 *  path and the body that left it. Mocking `request` itself would prove the
 *  mock (02 rule 30). */
import type { Page } from "@playwright/test";

export interface Sent {
  method: string;
  /** The path **with its query string**: a write that carries `?scope=`
   *  (W5-D9's asset row verbs) is only proved by what left the browser, and
   *  the scope is half of what it said. */
  path: string;
  body: unknown;
}

/**
 * Answers every `/v1/*` call with what its route returns on success — 201 and
 * an empty document for a create, 204 for a delete — so the component runs
 * its whole success path and the spec reads what it sent.
 *
 * `refuses` is the other half: the route answers one refusal in the shape
 * `lib/api.ts` reads (`code`, `message`, `remedy`), so a spec can prove the
 * server's own words are rendered beside the control that caused it
 * (02 rule 21).
 */
export async function records(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const raw = request.postData();
    const url = new URL(request.url());
    sent.push({
      method: request.method(),
      path: url.pathname + url.search,
      body: raw ? (JSON.parse(raw) as unknown) : undefined,
    });
    if (request.method() === "DELETE") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
  });
  return sent;
}

export interface Refusal {
  status: number;
  code: string;
  message: string;
  remedy?: string;
}

export async function refuses(page: Page, refusal: Refusal): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const raw = request.postData();
    const url = new URL(request.url());
    sent.push({
      method: request.method(),
      path: url.pathname + url.search,
      body: raw ? (JSON.parse(raw) as unknown) : undefined,
    });
    await route.fulfill({
      status: refusal.status,
      contentType: "application/json",
      body: JSON.stringify({
        code: refusal.code, message: refusal.message, remedy: refusal.remedy,
      }),
    });
  });
  return sent;
}
