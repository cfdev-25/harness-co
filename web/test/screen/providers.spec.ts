import { ORG, TEAM, expect, everyTagLinksToHow, headings, open, test } from "./stack-b";

/** 04 §10's named tests plus 06 K-M2's two provider rows. */

test("approval_scope_is_related_teams", async ({ page }) => {
  await open(page, `/console/${ORG}/providers`);
  await expect(page.getByRole("cell", { name: "pi", exact: true })).toBeVisible();
  await expect(page.locator('[data-scale="approval"]')).toHaveText("approved");
  await expect(page.getByText("All teams").first()).toBeVisible();
});

test("provider_pin_and_speaks_are_shown", async ({ page }) => {
  await open(page, `/console/${ORG}/providers`);
  await expect(page.getByText("60e7e76bd7ea")).toBeVisible();
  await expect(page.getByRole("cell", { name: /openai-completions, anthropic-messages/ })).toBeVisible();
});

test("model_status_says_set_up_needs_key_or_unreachable", async ({ page }) => {
  // W6-D6: *Reachable* became *Status*, a registered scale with three values.
  await open(page, `/console/${ORG}/providers/model`);
  await expect(page.getByRole("cell", { name: "anthropic" }).first()).toBeVisible();
  expect(await headings(page)).toContain("Status");
  const status = page.locator('[data-scale="providerStatus"]').first();
  await expect(status).toBeVisible();
  expect(["set-up", "needs-key", "unreachable"]).toContain(
    (await status.textContent())?.trim(),
  );
});

test("routing_is_two_columns_on_the_model_row", async ({ page }) => {
  // W6-D5: Routing is not a tab; the row carries both maps and both verbs.
  await open(page, `/console/${ORG}/providers/model`);
  const shown = await headings(page);
  expect(shown).toContain("Default for");
  expect(shown).toContain("Approved for");
  expect(shown).not.toContain("Approved for providers");
});

test("routing_by_team_is_the_old_matrix_as_a_read_view", async ({ page }) => {
  await open(page, `/console/${ORG}/providers/model`);
  await page.getByRole("radio", { name: "By team" }).click();
  expect(await headings(page)).toEqual(["Provider", "Default for", "Approved for", "Resolves to"]);
  await expect(page.locator("main#content table").getByText("Teams").first()).toBeVisible();
});

test("routing_tab_redirects_to_model_providers", async ({ page }) => {
  await open(page, `/console/${ORG}/providers/routing`);
  await expect(page).toHaveURL(new RegExp(`/console/${ORG}/providers/model$`));
});

test("providers_decline_requires_reason", async ({ page }) => {
  await open(page, `/console/${ORG}/providers`);
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("combobox")).toHaveCount(2);
  await dialog.getByRole("combobox").nth(1).selectOption("not-approved");
  await expect(dialog.getByText(/Everyone who tries to run it reads this/).first()).toBeVisible();
});

test("renders_for_every_scope", async ({ page }) => {
  for (const scope of [ORG, TEAM]) {
    for (const tab of ["/providers", "/providers/model"]) {
      await open(page, `/console/${scope}${tab}`);
      await expect(page.locator("main#content h1")).toHaveCount(1);
      await everyTagLinksToHow(page);
    }
  }
});

test.fixme("not_approved_rows_present_with_reason", async () => {
  // D47: needs a declined runtime in `policy/harness-providers.json`; the
  // exported organisation has one runtime and it is approved.
});

test.fixme("provider_approval_is_a_commit_with_diff", async () => {
  // 06 K-M2 (V4). `PUT /v1/providers/harness/{id}` is not built, so no
  // commit reaches the provider log and there is no diff to expand.
});

test.fixme("routing_matrix_round_trips", async () => {
  // W6-D5 moved the write to the row's *Set default…* verb, proved at the
  // network in `test/components/providers-writes.spec.tsx` and on the dev
  // stack; a screen test of it needs a scratch organisation it may write to.
});

test.fixme("team_admin_approve_not_cleared", async () => {
  // Needs a team-admin principal.
});

test.fixme("refuses_as_for_member", async () => {
  // Needs a second person to read as.
});
