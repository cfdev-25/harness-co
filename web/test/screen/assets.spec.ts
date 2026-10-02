import { ORG, TEAM, expect, everyTagLinksToHow, headings, open, test } from "./stack-b";

/** 04 §12's named tests. */

test("loads_column_uses_loads_scale", async ({ page }) => {
  await open(page, `/console/${ORG}/assets`);
  expect(await headings(page)).toContain("Loads");
  await expect(page.locator('[data-scale="loads"]').first()).toBeVisible();
  await everyTagLinksToHow(page);
});

test("asset_row_is_a_kind_and_a_name_from_the_index", async ({ page }) => {
  await open(page, `/console/${ORG}/assets`);
  await expect(page.getByRole("link", { name: "model-default" })).toBeVisible();
  await expect(page.getByText("connection").first()).toBeVisible();
});

test("asset_reverse_view_three_related", async ({ page }) => {
  await open(page, `/console/${ORG}/assets`);
  await page.getByRole("link", { name: "model-default" }).click();
  const card = page.locator("section", {
    has: page.getByRole("heading", { name: "What loads it" }),
  });
  await expect(card.getByText("Included by harnesses")).toBeVisible();
  await expect(card.getByText("Teams", { exact: true })).toBeVisible();
  await expect(card.getByText("Needs groups")).toBeVisible();
});

test("asset_edge_walk_directed", async ({ page }) => {
  await open(page, `/console/${ORG}/assets`);
  await page.getByRole("link", { name: "model-default" }).click();
  await expect(page.getByRole("heading", { name: "What this rests on" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What rests on this" })).toBeVisible();
});

test("set_always_loaded_confirm_text", async ({ page }) => {
  await open(page, `/console/${ORG}/assets`);
  await page.getByRole("link", { name: "model-default" }).click();
  await page.getByRole("radio", { name: "Always loaded" }).click();
  await expect(
    page.locator("[data-confirm-takes]").getByText(
      "Preflight will refuse to launch any harness without it.",
    ),
  ).toBeVisible();
});

test("renders_for_every_scope", async ({ page }) => {
  for (const scope of [ORG, TEAM, "me"]) {
    await open(page, `/console/${scope}/assets`);
    await expect(page.locator("main#content h1")).toHaveCount(1);
  }
});

test.fixme("always_loaded_shows_all_harnesses_word", async () => {
  // Needs an asset in `policy/always-loaded.json`; the exported organization
  // has one asset and it is `when-chosen`.
});

test.fixme("assets_team_read_only_not_cleared", async () => {
  // Needs a team-admin or member principal to be refused the loads toggle.
});

test.fixme("refuses_as_for_member", async () => {
  // Needs a second person to read as.
});
