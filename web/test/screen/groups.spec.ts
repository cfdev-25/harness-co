import { ORG, TEAM, expect, everyTagLinksToHow, headings, open, test } from "./stack-b";

/** 04 §8's named tests plus 06 K-M2's `groups_columns_from_index` and
 *  `outside_grant_in_groups_list`. */

test("groups_columns_from_index", async ({ page }) => {
  await open(page, `/console/${ORG}/groups`);
  expect(await headings(page)).toEqual([
    "Group", "Gives", "Sources", "Granted to teams", "Only for harnesses",
    "Narrowed from", "By", "When",
  ]);
  // The row comes from the index, not a fixture in the app (K7).
  await expect(page.getByRole("link", { name: "legacy-anthropic-api-key" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "1 entry" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "vault or local" })).toBeVisible();
});

test("all_teams_renders_word_not_list", async ({ page }) => {
  await open(page, `/console/${ORG}/groups`);
  await expect(page.getByText("All teams").first()).toBeVisible();
});

test("no_hygiene_column", async ({ page }) => {
  await open(page, `/console/${ORG}/groups`);
  const columns = await headings(page);
  for (const banned of ["Hygiene", "Rotation", "Age", "Score"]) {
    expect(columns).not.toContain(banned);
  }
});

test("group_page_edge_walk_is_directed", async ({ page }) => {
  await open(page, `/console/${ORG}/groups/legacy-anthropic-api-key`);
  await expect(page.getByRole("heading", { name: "What rests on this" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What this rests on" })).toBeVisible();
  // P1: two cards, never merged into one.
  await expect(page.getByRole("heading", { name: /rests on/ })).toHaveCount(2);
});

test("entry_ready_is_observed_fact", async ({ page }) => {
  await open(page, `/console/${ORG}/groups/legacy-anthropic-api-key`);
  await expect(page.getByRole("cell", { name: "anthropic-api-key", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Ready" })).toBeVisible();
  await expect(page.locator('[title^="Checked just now"]').first()).toBeVisible();
});

test("org_verb_is_new_group_not_narrow", async ({ page }) => {
  // 04 §8: **New group** at the organization, **Narrow to a sub-team** at a
  // team. The two are never both on one sub-header.
  await open(page, `/console/${ORG}/groups`);
  await expect(page.getByRole("button", { name: "New group" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Narrow to a sub-team" })).toHaveCount(0);
});

test.fixme("narrow_modal_cannot_add_entry", async () => {
  // The one team in the scratch organization has no sub-team, so the verb has
  // nothing to narrow into and is not rendered. The modal, its preview
  // sentence and `narrowPreview` are covered at V1 in
  // `lib/views/groups.test.ts`; this needs a sub-team in the fixture.
  void TEAM;
});

test.fixme("narrow_preview_sentence_updates", async () => {
  // Same: no sub-team to narrow into. `narrowPreview` is V1-tested.
});

test("renders_for_every_scope", async ({ page }) => {
  for (const scope of [ORG, TEAM, "me"]) {
    await open(page, `/console/${scope}/groups`);
    await expect(page.locator("main#content h1")).toHaveCount(1);
    await everyTagLinksToHow(page);
  }
});

test.fixme("outside_grant_in_groups_list", async () => {
  // 06 K-M2. Needs a grant whose payload is reach (`grants.json` with
  // `reach: true`); the exported organization has one group grant only.
});

test.fixme("narrow_creates_grant_with_narrowed_from", async () => {
  // `POST /v1/grants` is not built (00 §4.11); the modal calls it and shows
  // the server's refusal. Un-fixme when the endpoint lands (K-M5).
});

test.fixme("revoke_confirm_lists_breaking_harnesses", async () => {
  // Needs `DELETE /v1/grants/{id}` and an `EdgeWalk.restedOnBy` with rows.
});

test.fixme("team_admin_create_group_not_cleared", async () => {
  // Needs a team-admin principal; the scratch organization has one org admin.
});

test.fixme("member_narrow_not_cleared", async () => {
  // Needs a member principal.
});

test.fixme("refuses_as_for_member", async () => {
  // Needs a second person to read as.
});
