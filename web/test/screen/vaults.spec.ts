import { ORG, TEAM, expect, everyTagLinksToHow, headings, open, test } from "./stack-b";

/** 04 §11's named tests. */

test("machine_is_a_vault_row", async ({ page }) => {
  await open(page, `/console/${ORG}/vaults`);
  await expect(page.getByRole("cell", { name: "Your machine" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "bundled" })).toBeVisible();
  // PRD §6.2: no row has a blank provider.
  const cells = await page.getByRole("cell").allTextContents();
  expect(cells.filter((text) => text.trim() === "").length).toBe(0);
});

test("vault_probe_is_observed_fact", async ({ page }) => {
  await open(page, `/console/${ORG}/vaults`);
  await expect(page.getByText("reachable now").first()).toBeVisible();
  await expect(page.locator('[title^="Checked just now"]').first()).toBeVisible();
  // The machine is not ours to check, so it is not a `false` we never made.
  await expect(page.getByText("not ours to check")).toBeVisible();
});

test("no_rotation_age_column", async ({ page }) => {
  await open(page, `/console/${ORG}/vaults/bundled`);
  const columns = await headings(page);
  for (const banned of ["Rotation", "Age", "Overdue", "Hygiene"]) {
    expect(columns).not.toContain(banned);
  }
  expect(columns).toContain("Last used");
});

test("bundled_vault_paste_and_rotate", async ({ page }) => {
  await open(page, `/console/${ORG}/vaults/bundled`);
  await expect(page.getByRole("button", { name: "Paste a key" })).toBeVisible();
  await expect(page.getByText(/only one we may write to/)).toBeVisible();
});

test("customer_vault_has_no_write_verbs_links_out", async ({ page }) => {
  await open(page, `/console/${ORG}/vaults/aws`);
  await expect(page.getByRole("button", { name: "Paste a key" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open it where it lives" })).toBeVisible();
  await expect(page.getByText(/never write to it/)).toBeVisible();
});

test("no_list_permission_degrades_honestly", async ({ page }) => {
  await open(page, `/console/${ORG}/vaults/your%20machine`);
  await expect(page.getByText(/cannot list it, read it or rotate it/)).toBeVisible();
});

test("secret_nothing_covers_finding", async ({ page }) => {
  await open(page, `/console/${ORG}/vaults/bundled`);
  await expect(page.getByRole("link", { name: "Nothing covers it" })).toBeVisible();
  await page.getByRole("link", { name: "Nothing covers it" }).click();
  await expect(page).toHaveURL(/finding=uncovered/);
});

test("secret_missing_pointer_finding", async ({ page }) => {
  await open(page, `/console/${ORG}/vaults/bundled?finding=dangling`);
  await expect(page.getByRole("link", { name: "Points at a missing secret" })).toBeVisible();
});

test("renders_for_every_scope", async ({ page }) => {
  await open(page, `/console/${ORG}/vaults`);
  await expect(page.locator("main#content h1")).toHaveCount(1);
  await everyTagLinksToHow(page);
});

test.fixme("vaults_deep_link_not_cleared_for_team_admin", async () => {
  // The branch is built (`viewer.role.level !== "org-admin"` renders the
  // refusal) but the scratch organization has no team admin to be refused.
  void TEAM;
});
