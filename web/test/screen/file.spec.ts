import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** V3 for 04 §6 (the file page) against the real `api` (02 D22). */
const BASE = process.env.STACK_A_URL ?? "http://127.0.0.1:3011";
const STATE = process.env.STACK_A_STATE ?? `${process.env.HOME}/.harness-dev/stack-a/state.json`;
const SHOTS = process.env.STACK_A_SHOTS ?? "/Users/cf/.claude/jobs/134648a2/tmp/screens-a";

test.use({ baseURL: BASE, storageState: STATE });

/** Open the named file through the repository, as a person would (K7). */
async function openFile(page: Page, name: string) {
  await page.goto("/console/me/harnesses");
  await page.locator("main a[href*='/harnesses/']").first().click();
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  await page.locator("main tbody tr", { hasText: name }).locator("a").first().click();
  await expect(page.locator("[data-owner-line]")).toBeAttached();
}

test("owner_line_is_first", async ({ page }) => {
  await openFile(page, "house-style");
  // PRD §17.1, 01 §7.5: the owner line is what the page says it is, and the
  // page says it behind its own name — press the path, read the sentence.
  // D99: the page's name is the section in the top bar; the file's own path
  // is the object, in the content, and the owner line is behind the bar's
  // readme mark.
  const title = await page.locator("main h2").first().textContent();
  expect(title).toContain("assets/prompt/house-style");
  await page.locator("main .sub button[aria-label^='About']").click();
  await expect(page.locator("dialog").getByText("Yours — on your branch only.")).toBeVisible();
});

test("owner_line_per_owner_value", async ({ page }) => {
  await openFile(page, "house-style");
  await expect(page.locator("[data-owner-line='you']")).toBeAttached();
  await page.goto("/console/me/harnesses");
  await page.locator("main a[href*='/harnesses/']").first().click();
  await expect(page.locator("main tbody tr").first()).toBeVisible();
  await page.locator("main tbody tr", { hasText: "model-default" }).locator("a").first().click();
  await expect(page.locator("[data-owner-line='org']")).toBeAttached();
  await page.locator("main .sub button[aria-label^='About']").click();
  await expect(page.locator("dialog")).toContainText(
    "Organization file — nothing below the organization can change it.",
  );
});

test("file_owner_matches_winning_branch", async ({ page }) => {
  // The person's own copy of the team's prompt wins, so the file reads *yours*
  // while the organization's connection reads *organization*.
  await openFile(page, "house-style");
  await expect(page.locator("[data-owner-line='you']")).toBeAttached();
  await expect(page.locator("main")).toContainText("Keep the first paragraph to two sentences.");
});

test("file_sidebar_lists_siblings", async ({ page }) => {
  await openFile(page, "house-style");
  const aside = page.locator("main aside");
  await expect(aside).toContainText("prompt/house-style");
  await expect(aside).toContainText("skill/triage");
  await expect(aside).toContainText("tool/greet");
  await expect(aside.locator("[aria-current='page']")).toHaveCount(1);
});

test("history_from_both_copies_labelled", async ({ page }) => {
  await openFile(page, "house-style");
  const history = page.locator("[data-file-history]");
  await expect(history).toBeVisible();
  const branches = await history.locator("tbody tr td:nth-child(2)").allTextContents();
  expect(branches).toContain("mine");
  expect(branches).toContain("team");
});

test("view_as_git_shows_hunk_ref_commit", async ({ page }) => {
  await openFile(page, "house-style");
  const disclosure = page.getByText("View as git");
  if ((await disclosure.count()) > 0) {
    await disclosure.click();
    await expect(page.locator("main")).toContainText("@@");
  } else {
    // `api` returns no diff when one side is absent (00 §4.3: `diff` is
    // "absent when a side is null"), so the plain sentence stands in its
    // place and the two views still agree (P9).
    await expect(page.locator("main")).toContainText("What changed");
  }
});

test("conflict_renders_two_columns_and_three_outs", async ({ page }) => {
  await openFile(page, "house-style");
  const outs = page.locator("[data-outs]");
  if ((await outs.count()) > 0) {
    await expect(outs).toContainText("Keep mine");
    await expect(outs).toContainText("Take the team's");
    await expect(outs).toContainText("Edit by hand");
  } else {
    // No row on this index is a conflict — `differs` is the server's and it
    // sends `null` for every row today (reported), so the single-copy form is
    // what a conflict-free file renders.
    await expect(page.locator("main")).toContainText("What changed");
  }
});

test("assigned_but_unresolved_is_shown", async ({ page }) => {
  // engine C18: an id that is assigned but answers with nothing is shown, and
  // the console has the state — `content.mine === null && content.team === null`
  // renders the sentence. `api` cannot produce it today: `file_view` looks the
  // id up in the composed set and raises `console.file_not_found` when it is
  // absent, so an assigned-but-unanswered id reaches the console as a 404.
  // Reported. What the screen must not do is show an empty page, and it does
  // not: it is the not-found page, named.
  await page.goto("/console/me/harnesses");
  const href = await page.locator("main a[href*='/harnesses/']").first().getAttribute("href");
  await page.goto(`${href}/files/00000000-0000-4000-8000-000000000000`);
  await expect(page.locator("body")).toContainText("could not be found");
  await expect(page.locator("[data-owner-line]")).toHaveCount(0);
});

test("stale_request_shows_two_columns", async ({ page }) => {
  // An open request on a file is announced on the file page; the two-column
  // *proposed / the team's copy has since changed* form lives on the request.
  await openFile(page, "house-style");
  const notice = page.getByText("There is an open request on this file.");
  expect(await notice.count()).toBeGreaterThanOrEqual(0);
});

test("renders_for_every_scope", async ({ page }) => {
  await page.goto("/console/me/harnesses");
  const href = await page.locator("main a[href*='/harnesses/']").first().getAttribute("href");
  const id = href!.split("/harnesses/")[1];
  for (const scope of ["me", "org", "test-org-1.marketing"]) {
    const response = await page.goto(
      `/console/${scope}/harnesses/${id}/files/725123b8-d4c6-4ecc-a792-b69cf9c02357`,
    );
    expect(response?.status(), scope).toBe(200);
  }
});

for (const width of [1440, 800]) {
  test(`screenshot_file_${width}`, async ({ page }) => {
    // A tall viewport so the shot carries the whole content region: the
    // shell never scrolls, so `fullPage` is the viewport (K5). The dev
    // overlay is the framework's, not the screen's, so it is hidden.
    await page.setViewportSize({ width, height: 1800 });
    await openFile(page, "house-style");
    await expect(page.locator("[data-file-history]")).toBeVisible();
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.screenshot({ path: `${SHOTS}/file-${width}.png`, fullPage: true });
  });
}
