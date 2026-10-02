import { ORG, TEAM, expect, everyTagLinksToHow, open, test } from "./stack-b";

/** 04 §9's named tests, plus 06 K-M2's `boundaries_listed_in_full_with_source`
 *  and 02 rule 31's two. The scratch organization has no boundary on its org
 *  branch, so the rows-present halves are `fixme` naming what is missing.
 *
 *  W6-D8 made the screen three tabs as routes, so `/boundaries` is a redirect
 *  and every test below opens the tab it is about. */

test("boundaries_listed_in_full_at_every_scope", async ({ page }) => {
  for (const scope of [ORG, TEAM, "me"]) {
    await open(page, `/console/${scope}/boundaries/reach`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Boundaries|What I block/);
    // P17: never a summary sentence in place of the list.
    await expect(page.getByText(/in summary|summarised/i)).toHaveCount(0);
  }
});

test("renders_for_every_scope", async ({ page }) => {
  for (const scope of [ORG, TEAM, "me"]) {
    for (const tab of ["reach", "commands", "files"]) {
      await open(page, `/console/${scope}/boundaries/${tab}`);
      await expect(page.locator("main#content h1")).toHaveCount(1);
      await everyTagLinksToHow(page);
    }
    // W6-D8: the bare route is in the wild and redirects to the first tab.
    await open(page, `/console/${scope}/boundaries`);
    await expect(page).toHaveURL(new RegExp(`/boundaries/reach$`));
    await expect(page.locator("main#content h1")).toHaveCount(1);
    await everyTagLinksToHow(page);
  }
});

test("boundaries_empty_state_names_the_adding_verb", async ({ page }) => {
  await open(page, `/console/${ORG}/boundaries/files`);
  await expect(page.getByText(/No boundaries yet|sets none of its own/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a boundary" })).toBeVisible();
});

test("add_boundary_scope_limited_to_subtree", async ({ page }) => {
  await open(page, `/console/${TEAM}/boundaries/files`);
  await page.getByRole("button", { name: "Add a boundary" }).click();
  const scope = page.getByLabel("Applies to");
  await expect(scope).toHaveValue(TEAM);
  await expect(scope).toHaveAttribute("readonly", "");
});

test("a_command_boundary_is_intercepted_and_not_a_choice", async ({ page }) => {
  // W6-D9 shipped interception, so `holds` is no longer a disabled option
  // saying *not yet*: for a command it is not a choice at all, because the
  // runtime is the only thing that can hold one and `api` refuses `enforced`.
  await open(page, `/console/${ORG}/boundaries/commands`);
  await page.getByRole("button", { name: "Add a boundary" }).click();
  await expect(page.locator("dialog").getByLabel("Holds")).toHaveValue(/^intercepted/);
  await expect(page.locator('dialog option[value="enforced"]')).toHaveCount(0);
});

test("the_command_starter_set_is_offered_under_set_here", async ({ page }) => {
  // W6-D10: never seeded, offered. Each one carries the reason it ships with.
  await open(page, `/console/${ORG}/boundaries/commands`);
  const offered = page.locator("[data-suggested]");
  await expect(offered).toContainText("rm -rf /*");
  await expect(offered).toContainText("never a step in a task");
});

test("add_boundary_shows_the_servers_words_when_it_refuses", async ({ page }) => {
  await open(page, `/console/${ORG}/boundaries/files`);
  await page.getByRole("button", { name: "Add a boundary" }).click();
  await page.getByLabel("Value").fill("api.example.com");
  await page.getByLabel("Reason").fill("Not ours to reach.");
  await page.getByRole("button", { name: "Add the boundary" }).click();
  // `POST /v1/boundaries` is not built (00 §4.11, K-M5); rule 21 says the
  // server's own words appear beside the control, and they do.
  await expect(page.locator("dialog").getByText(/404|Not Found|refus/i)).toBeVisible();
});

test.fixme(
  "org_rows_have_no_remove_for_team_admin",
  async () => {
    // Needs a boundary on the org branch (`policy/boundaries.json` is absent
    // from the exported repository) and a team-admin principal; the scratch
    // organization has one org admin and no boundaries.
  },
);

test.fixme("remove_org_boundary_not_cleared_text", async () => {
  // Same: no org boundary row exists to refuse the removal of.
});

test.fixme("member_add_not_cleared", async () => {
  // Needs a member principal. `harness_cutover_dryrun` has one person and
  // they are the organization admin.
});

test.fixme("boundaries_hidden_view_whole_table", async () => {
  // Needs `Viewer.visibility.boundaries === false`, set by
  // `PATCH /v1/org-units/{id}/visibility`, which is not built.
});

test.fixme("boundaries_listed_in_full_with_source", async () => {
  // 06 K-M2. Needs at least one org boundary and one team boundary so the
  // `Set by` column and the *Inherited* block both have rows (W6-D8).
});

test.fixme("refuses_as_for_member", async () => {
  // `?as=` is refused for a member; there is no second person to read as.
});
