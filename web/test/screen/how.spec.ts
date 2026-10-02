import { ORG, expect, open, test } from "./stack-b";
import { SCALE_IDS } from "../../lib/views/scales";

/** 04 §16's named tests, and V2's `every_scale_tag_links_to_how` run over
 *  every group-B screen. */

test("every_registered_scale_has_anchor", async ({ page }) => {
  await open(page, "/console/how");
  for (const id of SCALE_IDS) {
    await expect(page.locator(`section#${id}`)).toHaveCount(1);
  }
});

test("how_is_sections_and_no_prose_between_them", async ({ page }) => {
  await open(page, "/console/how");
  // 05 D54: no prose between sections, and no commentary on screens (P8).
  await expect(page.getByText(/On this page you will find|welcome/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Approval" })).toBeVisible();
});

test("how_filter_box_narrows_by_word", async ({ page }) => {
  await open(page, "/console/how");
  await page.getByLabel("Filter").fill("intercepted");
  await expect(page.locator("section#holds")).toBeVisible();
  await expect(page.locator("section#approval")).toHaveCount(0);
  await page.getByLabel("Filter").fill("zzzz");
  await expect(page.getByText("No scale or word matches that.")).toBeVisible();
});

test("how_word_lists_where_seen", async ({ page }) => {
  await open(page, "/console/how");
  await expect(page.locator("section#words")).toBeVisible();
  await expect(page.locator("#word-security-group")).toBeVisible();
  // Each word carries its PRD reference, which is where it is defined.
  await expect(page.locator("section#words").getByText(/PRD|prd-v2|§/).first()).toBeVisible();
});

test("how_index_lists_every_scale_and_word", async ({ page }) => {
  await open(page, "/console/how");
  const index = page.getByRole("navigation", { name: "How this works" });
  await expect(index.getByRole("link")).toHaveCount(SCALE_IDS.length + 32);
});

test("every_scale_tag_links_to_how", async ({ page }) => {
  const screens = [
    `/console/${ORG}/groups`,
    `/console/${ORG}/boundaries`,
    `/console/${ORG}/providers`,
    `/console/${ORG}/providers/model`,
    `/console/${ORG}/vaults`,
    `/console/${ORG}/assets`,
    `/console/${ORG}/logs/permission`,
    `/console/${ORG}/logs/endpoints`,
    `/console/${ORG}/people`,
    `/console/${ORG}/teams`,
    "/console/me/account",
  ];
  let seen = 0;
  for (const screen of screens) {
    await open(page, screen);
    const tags = page.locator("[data-scale]");
    for (let index = 0; index < (await tags.count()); index += 1) {
      const scale = await tags.nth(index).getAttribute("data-scale");
      expect(await tags.nth(index).getAttribute("href")).toBe(`/console/how#${scale}`);
      seen += 1;
    }
  }
  expect(seen).toBeGreaterThan(0);
});

// `command_sheet_matches_cli` is `test/unit/sheet.test.ts`: a file comparison, not a screen.
