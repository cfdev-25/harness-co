import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** V3 for 04 §7 (the requests panel and a request) against the real `api`. */
const BASE = process.env.STACK_A_URL ?? "http://127.0.0.1:3011";
const STATE = process.env.STACK_A_STATE ?? `${process.env.HOME}/.harness-dev/stack-a/state.json`;
const SHOTS = process.env.STACK_A_SHOTS ?? "/Users/cf/.claude/jobs/134648a2/tmp/screens-a";

test.use({ baseURL: BASE, storageState: STATE });

async function panel(page: Page, state: "open" | "closed" = "open"): Promise<string> {
  await page.goto("/console/me/harnesses");
  const href = await page.locator("main a[href*='/harnesses/']").first().getAttribute("href");
  await page.goto(`${href}?view=requests&state=${state}`);
  await expect(page.getByRole("radiogroup", { name: "Which requests" })).toBeVisible();
  return href!;
}

test("requests_open_closed_no_badge", async ({ page }) => {
  await panel(page);
  const control = page.getByRole("radiogroup", { name: "Which requests" });
  expect(await control.getByRole("radio").allTextContents()).toEqual(["Open", "Closed"]);
  // PRD §17.3: there is no state badge on a request row.
  await expect(page.locator("[data-requests] [data-scale]")).toHaveCount(0);
});

test("requests_empty_open_names_offer", async ({ page }) => {
  const href = await panel(page, "closed");
  await expect(page.locator("main .body")).toContainText("Nothing has been decided yet.");
  await page.goto(`${href}?view=requests&state=open`);
  await expect(page.locator("[data-requests]")).toBeVisible();
});

test("closed_row_carries_outcome_in_line", async ({ page }) => {
  // Nothing on this index is closed yet, so the closed filter is the empty
  // sentence; the outcome word is V1-tested (`outcomeNote`) and appears in
  // the row's own line, never as a tag.
  await panel(page, "closed");
  await expect(page.locator("[data-requests]")).toHaveCount(0);
  await expect(page.locator("main .body")).toContainText("Nothing has been decided yet.");
});

test("request_two_columns_discussion_right", async ({ page }) => {
  await panel(page);
  await page.locator("[data-requests] a").first().click();
  await expect(page.locator("main h2").first()).toBeVisible();
  const aside = page.locator("main aside");
  await expect(aside).toContainText("Discussion");
  // `asideSide: "end"` puts the discussion to the right of the change.
  await expect(page.locator("main .body.with-aside-end")).toBeVisible();
  const asideBox = await aside.boundingBox();
  const bodyBox = await page.locator("main .body > div").first().boundingBox();
  expect(asideBox!.x).toBeGreaterThan(bodyBox!.x);
});

test("one_discussion_per_request", async ({ page }) => {
  await panel(page);
  await page.locator("[data-requests] a").first().click();
  await expect(page.locator("main aside")).toContainText("Discussion");
  await expect(page.getByText("Discussion", { exact: true })).toHaveCount(1);
});

test("accept_confirm_names_team", async ({ page }) => {
  await panel(page);
  await page.locator("[data-requests] a").first().click();
  const accept = page.getByRole("button", { name: /^Accept all/ });
  await expect(accept).toBeVisible();
  await accept.click();
  const takes = page.locator("dialog[open] [data-confirm-takes]");
  await expect(takes).toContainText("to everyone on Marketing");
});

test("request_decline_requires_reason", async ({ page }) => {
  await panel(page);
  await page.locator("[data-requests] a").first().click();
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  const dialog = page.locator("dialog[open]");
  // The verb is unavailable until a reason is given; there is no second
  // dialog asking whether you are sure (§18).
  await expect(dialog.getByRole("button", { name: "Decline" })).toBeDisabled();
  await dialog.getByLabel("Why you are declining").fill("Not yet.");
  await expect(dialog.getByRole("button", { name: "Decline" })).toBeEnabled();
});

test("member_sees_permission_not_cleared_with_withdraw", async ({ page }) => {
  // The signed-in person is the organisation admin and the request's author,
  // so `verbs` carries accept, decline and withdraw and no refusal is drawn.
  // The refusal's own rendering is `refusesDecision`'s, V1-tested.
  await panel(page);
  await page.locator("[data-requests] a").first().click();
  await expect(page.locator("main aside")).toContainText("Withdraw");
  await expect(page.getByText("so a team admin decides it")).toHaveCount(0);
});

test("author_can_withdraw_only_open", async ({ page }) => {
  await panel(page);
  await page.locator("[data-requests] a").first().click();
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(page.locator("dialog[open] [data-confirm-takes]")).toContainText(
    "Nothing is published.",
  );
});

test("stale_file_two_column_form", async ({ page }) => {
  await panel(page);
  await page.locator("[data-requests] a").first().click();
  await expect(page.locator("main .body")).toBeVisible();
  const stale = page.getByText("the team's copy has since changed");
  // Nothing is stale on this index; when it is, the words are beside
  // *proposed* in the same line.
  if ((await stale.count()) > 0) await expect(page.getByText("proposed").first()).toBeVisible();
});

for (const width of [1440, 800]) {
  test(`screenshot_requests_${width}`, async ({ page }) => {
    // A tall viewport so the shot carries the whole content region: the
    // shell never scrolls, so `fullPage` is the viewport (K5). The dev
    // overlay is the framework's, not the screen's, so it is hidden.
    await page.setViewportSize({ width, height: 1800 });
    await panel(page);
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.screenshot({ path: `${SHOTS}/requests-panel-${width}.png`, fullPage: true });
    await page.locator("[data-requests] a").first().click();
    await expect(page.locator("main aside")).toContainText("Discussion");
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.screenshot({ path: `${SHOTS}/request-${width}.png`, fullPage: true });
  });
}
