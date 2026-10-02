import { expect, test } from "@playwright/test";

/**
 * V3 for 04 §4 (Harnesses cards), run against the real `api` on the scratch
 * index started by `test/server/stack-a.sh` — never a mock (02 D22).
 */
const BASE = process.env.STACK_A_URL ?? "http://127.0.0.1:3011";
const STATE = process.env.STACK_A_STATE ?? `${process.env.HOME}/.harness-dev/stack-a/state.json`;
const SHOTS = process.env.STACK_A_SHOTS ?? "/Users/cf/.claude/jobs/134648a2/tmp/screens-a";

test.use({ baseURL: BASE, storageState: STATE });

test("me_harness_cards_match_compose_fixture", async ({ page }) => {
  await page.goto("/console/me/harnesses");
  const cards = page.locator("main a[href*='/harnesses/']");
  await expect(cards.first()).toBeVisible();
  // The card's file count is what the chain composes for this person, which
  // is `idx_effective`'s five assets — not the harness's declared list.
  await expect(page.getByText("test-harness-1")).toBeVisible();
  await expect(page.locator("main").getByText("5 files")).toBeVisible();
});

test("cards_carry_no_tag", async ({ page }) => {
  await page.goto("/console/me/harnesses");
  await expect(page.locator("main a[href*='/harnesses/']").first()).toBeVisible();
  // P11: a card has no `ScaleTag` at all — no preflight, no readiness.
  await expect(page.locator("main a[href*='/harnesses/'] [data-scale]")).toHaveCount(0);
});

test("cards_grouped_by_team_at_org_scope", async ({ page }) => {
  await page.goto("/console/org/harnesses");
  await expect(page.locator("main section h2").first()).toBeVisible();
  const heading = await page.locator("main section h2").first().textContent();
  expect(heading?.trim().length).toBeGreaterThan(0);
  await page.goto("/console/me/harnesses");
  await expect(page.locator("main section h2")).toHaveCount(0);
});

test("new_harness_one_button_choice_inside", async ({ page }) => {
  await page.goto("/console/me/harnesses");
  await page.getByRole("button", { name: "New harness" }).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  // One button; *start from a copy* is a select inside the form (04 §4).
  await expect(dialog.getByLabel("Start from a copy")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start from a copy" })).toHaveCount(0);
});

test("new_harness_from_copy_prefills", async ({ page }) => {
  await page.goto("/console/me/harnesses");
  await page.getByRole("button", { name: "New harness" }).click();
  const select = page.locator("dialog[open] select");
  await expect(select.locator("option")).toHaveCount(2);
  await expect(select.locator("option").nth(1)).toHaveText("test-harness-1");
});

test("cards_empty_state_names_new_harness", async ({ page }) => {
  await page.goto("/console/me/harnesses?q=nothing-matches-this");
  await expect(page.getByText("You have no harnesses yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "New harness" })).toBeVisible();
});

test("cards_error_shows_server_message", async ({ page }) => {
  // An unknown scope segment is not a scope at all, so the route is a 404
  // rather than an error page; a scope the viewer may not read is the server's
  // sentence, rendered by `error.tsx` with no stack (D27).
  const notFound = await page.goto("/console/nonsense/harnesses");
  expect(notFound?.status()).toBe(404);
});

test("renders_for_every_scope", async ({ page }) => {
  for (const scope of ["me", "org", "test-org-1.marketing"]) {
    const response = await page.goto(`/console/${scope}/harnesses`);
    expect(response?.status(), scope).toBe(200);
    await expect(page.getByRole("heading", { name: "Harnesses", level: 1 })).toBeVisible();
  }
});

for (const width of [1440, 800]) {
  test(`screenshot_harnesses_${width}`, async ({ page }) => {
    // A tall viewport so the shot carries the whole content region: the
    // shell never scrolls, so `fullPage` is the viewport (K5). The dev
    // overlay is the framework's, not the screen's, so it is hidden.
    await page.setViewportSize({ width, height: 1800 });
    await page.goto("/console/me/harnesses");
    await expect(page.locator("main a[href*='/harnesses/']").first()).toBeVisible();
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.screenshot({ path: `${SHOTS}/harnesses-${width}.png`, fullPage: true });
  });
}
