import { ORG, TEAM, expect, everyTagLinksToHow, headings, open, test } from "./stack-b";

/** 04 §15's named tests plus 06 K-M5's UI halves that need no CLI. */

test("teams_tree_collapsed_to_top_level", async ({ page }) => {
  await open(page, `/console/${ORG}/teams`);
  expect(await headings(page)).toEqual(["Team", "Inside", "Contains", "People", "Groups", "Admins"]);
  await expect(page.getByRole("cell", { name: "marketing" })).toBeVisible();
  // A sub-team is a *Contains* cell, never a second row.
  await expect(page.getByRole("cell", { name: "test-org-1.marketing.", exact: false })).toHaveCount(0);
});

test("no_per_person_permission_list", async ({ page }) => {
  await open(page, `/console/${ORG}/people`);
  const columns = await headings(page);
  for (const banned of ["Permissions", "Can do", "Capabilities"]) {
    expect(columns).not.toContain(banned);
  }
  expect(columns).toContain("Role");
});

test("not_yours_to_change_lists_four", async ({ page }) => {
  await open(page, `/console/${TEAM}/people`);
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Not yours to change" }) });
  await expect(card.getByText("an organisation admin decides")).toHaveCount(4);
});

test("role_request_waits_on_named_admin", async ({ page }) => {
  await open(page, `/console/${ORG}/people`);
  await expect(page.getByRole("heading", { name: "Waiting on an organisation admin" })).toBeVisible();
  // The card names who decides whether anything is waiting or not; it never
  // disappears, because an empty queue is a fact about the organisation.
  await expect(
    page.getByText(/Nothing is waiting\.|requests? (are|is) waiting/),
  ).toBeVisible();
});

test("sub_team_dialog_three_fields_and_notice", async ({ page }) => {
  await open(page, `/console/${ORG}/people`);
  await page.getByRole("button", { name: "New sub-team" }).click();
  await expect(page.locator("dialog").getByLabel("Name")).toBeVisible();
  await expect(page.locator("dialog").getByText("Who is on it")).toBeVisible();
  await expect(
    page.locator("dialog").getByText(/starts empty and inherits everything above it/),
  ).toBeVisible();
  await expect(page.locator("dialog").getByText(/placing that thing somewhere else/)).toBeVisible();
});

test("member_sees_who_decides", async ({ page }) => {
  // K-M5's UI half (P13). The viewer here is the organisation admin, so no
  // refusal is drawn — what a team admin reads instead is *Not yours to
  // change*, which names the decider for each of PRD §12's four items.
  await open(page, `/console/${TEAM}/people`);
  const card = page.locator("section", {
    has: page.getByRole("heading", { name: "Not yours to change" }),
  });
  expect(await card.getByText("an organisation admin decides").count()).toBe(4);
});

test("visibility_switch_org_only", async ({ page }) => {
  await open(page, `/console/${ORG}/people`);
  await page.getByRole("link", { name: /@|corbfurrer|3f29b349/ }).first().click();
  await expect(page.getByText("What they can see")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Boundaries" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Logs" })).toBeVisible();
});

test("removal_preview_lists_groups_lost", async ({ page }) => {
  // K-M5's UI half: the confirmation *is* the preview (§18), computed by the
  // server's `/people/{id}/removal`, never a generic *Are you sure?*
  await open(page, `/console/${ORG}/people`);
  await page.getByRole("link", { name: /@|corbfurrer|3f29b349/ }).first().click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  const takes = page.locator("[data-confirm-takes]");
  await expect(takes).toBeVisible();
  await expect(takes.getByText(/Are you sure/i)).toHaveCount(0);
  await expect(takes.getByText(/lose these security groups|holds nothing through this team/)).toBeVisible();
});

test("renders_for_every_scope", async ({ page }) => {
  for (const scope of [ORG, TEAM]) {
    await open(page, `/console/${scope}/people`);
    await expect(page.locator("main#content h1")).toHaveCount(1);
    await everyTagLinksToHow(page);
  }
  // `me` redirects to the account screen (04 §15, §17).
  await page.goto("/console/me/people");
  await expect(page).toHaveURL(/\/console\/me\/account$/);
});

test.fixme("org_admin_accepts_role_request", async () => {
  // Needs a role request to exist and `POST /v1/requests/{id}/accept`, which
  // is not built (only `/withdraw` is).
});

test.fixme("team_admin_appoint_not_cleared", async () => {
  // Needs a team-admin principal; the scratch organisation has one org admin.
});

test.fixme("member_invite_not_cleared", async () => {
  // Needs a member principal.
});

test.fixme("removal_confirm_shows_preview", async () => {
  // The full K-M5 row: needs `DELETE /v1/org-units/{team}/members/{id}` and a
  // second person, so the removal can be carried out and its effect read back.
});

test.fixme("refuses_as_for_member", async () => {
  // Needs a second person to read as.
});
