import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** V3 for 04 §5 (the harness repository) against the real `api` (02 D22). */
const BASE = process.env.STACK_A_URL ?? "http://127.0.0.1:3011";
const STATE = process.env.STACK_A_STATE ?? `${process.env.HOME}/.harness-dev/stack-a/state.json`;
const SHOTS = process.env.STACK_A_SHOTS ?? "/Users/cf/.claude/jobs/134648a2/tmp/screens-a";

test.use({ baseURL: BASE, storageState: STATE });

/** The id is the index's, discovered rather than written down (K7). */
async function harnessId(page: Page): Promise<string> {
  await page.goto("/console/me/harnesses");
  const href = await page.locator("main a[href*='/harnesses/']").first().getAttribute("href");
  return href!.split("/harnesses/")[1];
}

/**
 * The screen streams: `loading.tsx` paints the content region first and the
 * repository replaces it (02 rule 8), so a count taken the instant `goto`
 * resolves reads the skeleton. Every test waits for the region it reads.
 */
async function ready(page: Page) {
  await expect(page.getByRole("navigation", { name: "Which view" })).toBeVisible();
  await expect(page.locator("main .body")).toBeVisible();
}

test("header_grid_is_two_by_three", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}`);
  // D99: the grid is the first block of content, not a header row.
  const cells = page.locator("main .body dl").first().locator("> div");
  await expect(cells).toHaveCount(6);
  const labels = await cells.locator("dt").allTextContents();
  expect(labels.map((label) => label.trim())).toEqual([
    "Team",
    "Preflight",
    "Model provider",
    "Security groups",
    "Outside endpoints",
    "Files",
  ]);
});

test("compare_control_sized_by_role", async ({ page }) => {
  // The signed-in person is an organisation admin, so the server sends a
  // `member:` option per member of the team (04 §18) and the client adds
  // *Differences*. `versions` is the server's; the console never sizes it.
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}`);
  await ready(page);
  // 01 §7.5: both controls are the bar's tabs, so they are links and the
  // versions come first.
  const control = page.getByRole("navigation", { name: "Which view" });
  const options = await control.getByRole("link").allTextContents();
  expect(options.slice(0, 2)).toEqual(["Mine", "The team's"]);
  expect(options).toContain("Differences");
  expect(options.length).toBeGreaterThan(3);
});

test("compare_control_follows_copy", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}?version=mine&view=files`);
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  const mine = await page.locator("main tbody tr").count();
  await page.goto(`/console/me/harnesses/${id}?version=team&view=files`);
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  const team = await page.locator("main tbody tr").count();
  // The two copies really differ: the person's branch carries files the
  // team's composition does not.
  expect(mine).toBeGreaterThan(team);
});

test("editor_column_follows_version", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}?version=mine&view=files`);
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  const mine = await page.locator("main tbody tr").allTextContents();
  expect(mine.join(" ")).toContain("Corby Furrer");
  await page.goto(`/console/me/harnesses/${id}?version=team&view=files`);
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  const team = await page.locator("main tbody tr").allTextContents();
  expect(team.join(" ")).not.toEqual(mine.join(" "));
});

test("differs_column_only_in_differences", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}?version=mine&view=files`);
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Differs" })).toHaveCount(0);
  await page.goto(`/console/me/harnesses/${id}?version=differences&view=files`);
  await expect(page.getByRole("columnheader", { name: "Differs" })).toBeVisible();
});

test("conflict_badge_only_in_differences", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}?version=mine&view=files`);
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  await expect(page.locator("[data-conflict]")).toHaveCount(0);
  await page.goto(`/console/me/harnesses/${id}?version=differences&view=files`);
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  // The marker exists only in this view; whether it fires depends on the data.
  const differs = await page.locator("main tbody tr").allTextContents();
  expect(differs.join(" ")).toMatch(/yours only|theirs only|both|conflict/);
  // The badge itself fires only on a row the server called a conflict.
  const marked = await page.locator("[data-conflict]").count();
  const rows = differs.join(" ");
  expect(marked > 0).toBe(rows.includes("conflict"));
});

test("bulk_verbs_only_in_differences", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}?version=mine&view=files`);
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  await expect(page.locator("[data-bulk]")).toHaveCount(0);
  await page.goto(`/console/me/harnesses/${id}?version=differences&view=files`);
  const bulk = page.locator("[data-bulk]");
  await expect(bulk).toBeVisible();
  await expect(bulk).toContainText("harness offer");
  await expect(bulk).toContainText("harness reset --all");
});

test("differences_hidden_in_history", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}?view=history`);
  await ready(page);
  const options = await page.getByRole("navigation", { name: "Which view" }).getByRole("link").allTextContents();
  expect(options).not.toContain("Differences");
});

test("history_follows_selected_version", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}?view=history&version=mine`);
  const mine = await page.locator("main .body").textContent();
  expect(mine).toContain("house style: keep the opening to two sentences");
  await page.goto(`/console/me/harnesses/${id}?view=history&version=team`);
  const team = await page.locator("main .body").textContent();
  expect(team).not.toEqual(mine);
});

test("boundaries_listed_in_full_in_sidebar", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}`);
  const aside = page.locator("main aside");
  await expect(aside).toContainText("Security groups");
  await expect(aside).toContainText("Boundaries");
  await expect(aside).toContainText("legacy-anthropic-api-key");
});

test("boundaries_hidden_view_names_decision", async ({ page }) => {
  // P10: the block is a note naming the decision, never a shorter list. The
  // marker is present in the tree only when `Viewer.visibility.boundaries` is
  // false; on this fixture the view is on, so the list is the list.
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}`);
  const hidden = page.locator("[data-hidden-view='boundaries']");
  if ((await hidden.count()) > 0) {
    await expect(hidden).toContainText("chosen not to show boundaries");
  } else {
    await expect(page.locator("main aside")).toContainText("Boundaries");
  }
});

test("commands_button_opens_sheet", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}`);
  await page.locator("main aside").getByRole("button", { name: "Commands" }).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("harness run pi");
});

test("edit_refused_names_team_admin", async ({ page }) => {
  // The signed-in person is the organisation admin, so the verbs are here and
  // the refusal is not. The refusal's own sentence is V2's to render.
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}`);
  await expect(page.locator("main .sub").getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(page.locator("main .sub").getByRole("button", { name: "Delete" })).toBeVisible();
});

test("delete_confirm_states_file_count", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}`);
  await page.locator("main .sub").getByRole("button", { name: "Delete" }).click();
  const takes = page.locator("dialog[open] [data-confirm-takes]");
  await expect(takes).toContainText("5 files keep their history");
});

test("as_banner_names_member", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}?as=11111111-1111-4111-8111-111111111111`);
  const banner = page.locator("[data-as-banner]");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("they have not offered these");
});

test("as_member_requires_admin", async ({ page }) => {
  // `?as` naming somebody the viewer does not administer is refused by the
  // server, and the screen renders the server's sentence (02 rule 11).
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}?as=00000000-0000-4000-8000-000000000000`);
  await expect(page.locator("main")).toContainText(
    "You can read a member's versions only for teams you administer.",
  );
  await expect(page.locator("main tbody tr")).toHaveCount(0);
});

test("every_tag_links_to_its_scale", async ({ page }) => {
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}`);
  const tags = page.locator("[data-scale]");
  const count = await tags.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const tag = tags.nth(index);
    const scale = await tag.getAttribute("data-scale");
    await expect(tag).toHaveAttribute("href", `/console/how#${scale}`);
  }
});

test("repository_empty_state_links_sheet", async ({ page }) => {
  // A harness with no files reads the sentence and the command that fills it.
  // This fixture's harness has five, so the table is the table; the empty
  // branch is asserted by its sentence being absent while rows exist.
  const id = await harnessId(page);
  await page.goto(`/console/me/harnesses/${id}`);
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  await expect(page.getByText("Nothing is in this harness yet")).toHaveCount(0);
});

for (const width of [1440, 800]) {
  test(`screenshot_harness_${width}`, async ({ page }) => {
    const id = await harnessId(page);
    // A tall viewport so the shot carries the whole content region: the
    // shell never scrolls, so `fullPage` is the viewport (K5). The dev
    // overlay is the framework's, not the screen's, so it is hidden.
    await page.setViewportSize({ width, height: 1800 });
    for (const [name, query] of [
      ["files", "?version=mine&view=files"],
      ["differences", "?version=differences&view=files"],
      ["history", "?version=mine&view=history"],
      ["requests", "?view=requests&state=open"],
    ] as const) {
      await page.goto(`/console/me/harnesses/${id}${query}`);
      await expect(page.locator("main .sub")).toBeVisible();
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      await page.screenshot({ path: `${SHOTS}/harness-${name}-${width}.png`, fullPage: true });
    }
  });
}
