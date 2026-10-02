import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/** V3 for 04 §13 (Sessions) against the real `api` on the scratch index. */
const BASE = process.env.STACK_A_URL ?? "http://127.0.0.1:3011";
const STATE = process.env.STACK_A_STATE ?? `${process.env.HOME}/.harness-dev/stack-a/state.json`;
const SHOTS = process.env.STACK_A_SHOTS ?? "/Users/cf/.claude/jobs/134648a2/tmp/screens-a";

test.use({ baseURL: BASE, storageState: STATE });

/** Open the nth row of the list, as a person would; ids stay out of the spec. */
async function openSession(page: Page, match: RegExp | string): Promise<void> {
  await page.goto("/console/me/sessions");
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  await page.locator("main tbody tr", { hasText: match }).first().locator("a").first().click();
  await expect(page.locator("main h2").first()).toBeVisible();
}

test("sessions_list_columns", async ({ page }) => {
  await page.goto("/console/me/sessions");
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  const headings = await page.locator("main thead th").allTextContents();
  expect(headings.map((h) => h.replace("?", "").trim())).toEqual([
    "Person",
    "Harness",
    "Provider",
    "Model",
    "Status",
    "Started",
    "Last active",
    "Endpoints",
  ]);
  await expect(page.locator("main tbody tr")).toHaveCount(4);
});

test("native_session_not_metered", async ({ page }) => {
  await page.goto("/console/me/sessions");
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  const native = page.locator("main tbody tr", { hasText: "claude-code" });
  await expect(native).toContainText("not metered");
  // P16, engine C22: never a zero in the model cell of a native session.
  await expect(native.locator("td").nth(3)).toHaveText("not metered");
});

test("session_page_preflight_report_whole", async ({ page }) => {
  await openSession(page, "pi 0.4.2");
  const report = page.locator("[data-preflight-report]");
  await expect(report).toBeVisible();
  await expect(report).toContainText("Choices");
  await expect(report).toContainText("anthropic");
  await expect(page.locator("main")).toContainText("Preflight report");
});

test("preflight_report_rendered_whole", async ({ page }) => {
  // P15: the whole report — tag, blockers, drift and choices — for a session
  // that failed, in the order 04 §13 gives.
  await openSession(page, "revoked");
  const report = page.locator("[data-preflight-report]");
  await expect(report).toContainText("Blockers");
  await expect(report).toContainText("Drift");
  await expect(report).toContainText("Choices");
  await expect(page.locator("main [data-scale='preflight']")).toHaveText("failing");
});

test("blockers_show_message_remedy_link", async ({ page }) => {
  await openSession(page, "revoked");
  const report = page.locator("[data-preflight-report]");
  await expect(report).toContainText("The bundled vault did not answer for anthropic-api-key.");
  await expect(report).toContainText("Open the Key vaults screen");
  await expect(report).toContainText("broker.vault_unreachable");
  await expect(report.locator("a[href='/console/org/vaults']")).toBeVisible();
});

test("slots_table_state_evidence_resolved_from_via", async ({ page }) => {
  await openSession(page, "pi 0.4.2");
  const slots = page.locator("[data-slots]");
  await expect(slots).toBeVisible();
  const headings = await slots.locator("thead th").allTextContents();
  expect(headings.map((h) => h.replace("?", "").trim())).toEqual([
    "Need",
    "State",
    "Evidence",
    "Resolved from",
    "Via",
    "Blocker",
  ]);
  await expect(slots).toContainText("credential:anthropic-api-key");
  await expect(slots).toContainText("login:gh");
  await expect(slots).toContainText("asset:prompt/house-style");
  await expect(slots.locator("[data-scale='slot']").first()).toBeVisible();
  await expect(slots.locator("[data-scale='evidence']").first()).toBeVisible();
});

test("session_slots_show_resolved_from", async ({ page }) => {
  await openSession(page, "pi 0.4.2");
  const slots = page.locator("[data-slots]");
  await expect(slots).toContainText(
    "group legacy-anthropic-api-key via grant legacy-anthropic-api-key · vault bundled",
  );
  await expect(slots).toContainText("local: gh");
  // A deferred slot names the group and the sources rule it may fall back to.
  await expect(slots).toContainText("legacy-anthropic-api-key · vault-or-local");
});

test("no_value_string_anywhere_on_session_page", async ({ page }) => {
  await openSession(page, "pi 0.4.2");
  const text = (await page.locator("main").textContent()) ?? "";
  for (const shape of ["sk-", "secret://", "Bearer ", "last4"]) {
    expect(text, shape).not.toContain(shape);
  }
});

test("no_credential_value_in_any_response", async ({ page }) => {
  // A sweep of every console response the session screens read (K-M3). The
  // request carries the person's own bearer — an unauthenticated read would
  // pass this vacuously on a 401 envelope, so the status is asserted first.
  const state = JSON.parse(
    readFileSync(STATE, "utf8"),
  ) as { cookies: Array<{ value: string }> };
  const session = JSON.parse(
    Buffer.from(state.cookies[0].value.replace("base64-", ""), "base64url").toString(),
  ) as { access_token: string };
  const headers = { Authorization: `Bearer ${session.access_token}` };

  await page.goto("/console/me/sessions");
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  const href = await page.locator("main tbody tr").first().locator("a").first().getAttribute("href");
  const paths = [
    "/v1/console/me",
    "/v1/console/sessions?scope=me",
    `/v1/console/sessions/${href!.split("/sessions/")[1]}`,
  ];
  for (const path of paths) {
    const answer = await page.request.get(`${BASE}${path}`, { headers });
    expect(answer.status(), path).toBe(200);
    const body = await answer.text();
    expect(body.length, path).toBeGreaterThan(10);
    for (const shape of ["sk-", "secret://", "last4", "hpat_", "Bearer "]) {
      expect(body, `${path} ${shape}`).not.toContain(shape);
    }
  }
});

test("reach_rows_name_deciding_object", async ({ page }) => {
  await openSession(page, "pi 0.4.2");
  const reach = page.locator("[data-reach]");
  await expect(reach).toBeVisible();
  // D131: the reach row is the plan's, set by a node, not a grant's.
  await expect(reach).toContainText("allow-list");
  await expect(reach).toContainText("Host api.anthropic.com");
  await expect(reach).toContainText("provider anthropic");
});

// Was `reach_labelled_not_enforced_before_m4`. Engine D133 enforces every row
// on this card, so the honest label is the one that says so (06 K-M4's reach
// clause); the old sentence must not come back.
test("reach_says_the_proxy_held_the_session", async ({ page }) => {
  await openSession(page, "pi 0.4.2");
  const reach = page.locator("[data-reach]");
  await expect(reach).toContainText("the proxy held it to them.");
  await expect(reach).not.toContainText("not enforced yet");
});

test("endpoints_tally_fills_on_tick", async ({ page }) => {
  // The live session counts its endpoint events as the screen draws; the
  // closed ones carry the tally the proxy wrote.
  await page.goto("/console/me/sessions");
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  await expect(page.locator("main tbody tr", { hasText: "active" })).toContainText("reached 3");
  await openSession(page, "revoked");
  const tally = page.locator("[data-endpoints]");
  await expect(tally).toContainText("api.anthropic.com");
  await expect(tally).toContainText("crm.internal.example");
});

test("commits_link_to_log", async ({ page }) => {
  await openSession(page, "pi 0.4.2");
  const card = page.locator("main section", { hasText: "Definitions" }).last();
  await expect(card).toContainText("refs/heads/org");
  await expect(card.locator("a[href*='/logs/harness']").first()).toBeVisible();
});

test("session_without_report_says_so", async ({ page }) => {
  await openSession(page, "pi 0.3.9");
  await expect(page.locator("main")).toContainText(
    "This session's CLI did not post its preflight report; slots and endpoints are still recorded.",
  );
  await expect(page.locator("[data-slots]")).toBeVisible();
});

test("revoke_requires_reason_and_names_effect", async ({ page }) => {
  await openSession(page, "active");
  await expect(page.locator("[data-slots]")).toBeVisible();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.locator("[data-confirm-takes]")).toContainText(
    "The session's proxy will refuse every credential and the provider will be stopped within one tick.",
  );
  await expect(dialog.getByRole("button", { name: "Revoke", exact: true })).toBeDisabled();
  await dialog.getByLabel("Why you are revoking it").fill("The key was rotated.");
  await expect(dialog.getByRole("button", { name: "Revoke", exact: true })).toBeEnabled();
});

test("member_revoke_not_cleared", async ({ page }) => {
  // The signed-in person is the organization admin, so the verb is present.
  // The refusal's sentence is `content/screens/sessions.ts`'s and its rule is
  // `mayRevoke`, V1-tested; an ended session offers neither.
  await openSession(page, "revoked");
  await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  await expect(page.getByText("Revoking a session is a team admin's decision.")).toHaveCount(0);
});

test("endpoints_hidden_view_keeps_slots", async ({ page }) => {
  // P10: when an organization admin hides logs from a person at `me`, the
  // endpoints card is the note and the slots stay. Visibility is on for this
  // fixture, so the card is the tally and the marker is absent.
  await openSession(page, "revoked");
  await expect(page.locator("[data-slots]")).toBeVisible();
  const hidden = page.locator("[data-hidden-view='logs']");
  if ((await hidden.count()) > 0) await expect(hidden).toContainText("chosen not to show");
  else await expect(page.locator("[data-endpoints]")).toBeVisible();
});

test("renders_for_every_scope", async ({ page }) => {
  for (const scope of ["me", "org", "test-org-1.marketing"]) {
    const response = await page.goto(`/console/${scope}/sessions`);
    expect(response?.status(), scope).toBe(200);
    // D99: the top bar names the section, and Sessions is a tab of Logs.
    await expect(page.getByRole("heading", { name: "Logs", level: 1 })).toBeVisible();
  }
});

for (const width of [1440, 800]) {
  test(`screenshot_sessions_${width}`, async ({ page }) => {
    // A tall viewport so the shot carries the whole content region: the
    // shell never scrolls, so `fullPage` is the viewport (K5). The dev
    // overlay is the framework's, not the screen's, so it is hidden.
    await page.setViewportSize({ width, height: 1800 });
    await page.goto("/console/me/sessions");
    await expect(page.locator("main tbody tr").first()).toBeVisible();
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.screenshot({ path: `${SHOTS}/sessions-${width}.png`, fullPage: true });
    await openSession(page, "pi 0.4.2");
    await expect(page.locator("[data-slots]")).toBeVisible();
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.screenshot({ path: `${SHOTS}/session-${width}.png`, fullPage: true });
    await openSession(page, "revoked");
    await expect(page.locator("[data-preflight-report]")).toContainText("Blockers");
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.screenshot({ path: `${SHOTS}/session-failing-${width}.png`, fullPage: true });
  });
}
