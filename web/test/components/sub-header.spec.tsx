import { expect, test } from "@playwright/experimental-ct-react";
import { SubHeader } from "@/app/(console)/ui/sub-header";
import { readmeOf, searchIn } from "@/lib/views/header";
import { levelOf } from "@/lib/views/level";
import { ADMIN, VIEWER } from "./fixtures";

/**
 * The only header a screen has (01 §7.5): tabs on the left, then the count,
 * the readme mark, the level chip, the search and the screen's verbs — all
 * on one line, at every width.
 */

const TEAM = { kind: "team" as const, path: "acme.marketing" };

const TABS = [
  { id: "changes", label: "Changes", href: "/console/me/logs/changes", current: false },
  { id: "sessions", label: "Sessions", href: "/console/me/logs/sessions", current: true },
  { id: "endpoints", label: "Endpoints", href: "/console/me/logs/endpoints", current: false },
];

const LEDE = "Every log is the plain-words sentence first.";
const README = readmeOf("Logs", LEDE, ["Changes: pushes and pulls on the branches you can see."])!;
const SEARCH = searchIn("/console/me/harnesses", "", "Name or description");

test("sub_header_tabs_are_links_with_one_current", async ({ mount }) => {
  const bar = await mount(<SubHeader tabsLabel="Logs" tabs={TABS} />);
  await expect(bar.getByRole("navigation", { name: "Logs" })).toBeVisible();
  await expect(bar.getByRole("link")).toHaveCount(3);
  await expect(bar.locator("[aria-current='page']")).toHaveCount(1);
  await expect(bar.getByRole("link", { name: "Sessions" })).toHaveAttribute("aria-current", "page");
  await expect(bar.getByRole("link", { name: "Changes" })).toHaveAttribute(
    "href",
    "/console/me/logs/changes",
  );
});

test("sub_header_keeps_two_sets_of_tabs_apart", async ({ mount }) => {
  // The harness page's versions and its views are both this bar's tabs, on
  // the same line, and each set marks its own (04 §5).
  const bar = await mount(
    <SubHeader
      tabsLabel="Which view"
      tabs={[
        { id: "mine", label: "Mine", href: "/h?version=mine", current: true, group: "version" },
        { id: "team", label: "The team's", href: "/h?version=team", current: false, group: "version" },
        { id: "files", label: "Files", href: "/h?view=files", current: true, group: "view" },
        { id: "history", label: "History", href: "/h?view=history", current: false, group: "view" },
      ]}
    />,
  );
  await expect(bar.locator("[aria-current='page']")).toHaveCount(2);
});

test("sub_header_is_one_line_at_every_width", async ({ mount, page }) => {
  const bar = await mount(
    <SubHeader
      tabsLabel="Logs"
      tabs={TABS}
      count="3 harnesses"
      readme={README}
      level={levelOf(TEAM, ADMIN)}
      search={SEARCH}
      actions={<button type="button">New harness</button>}
    />,
  );
  const tall = (await bar.boundingBox())!.height;
  await page.setViewportSize({ width: 640, height: 700 });
  const narrow = (await bar.boundingBox())!;
  // Nothing wraps and nothing stacks: the bar is the same height at 640 as
  // at 1280, and the page never scrolls sideways — the tabs do.
  expect(narrow.height).toBe(tall);
  const overflow = await bar.getByRole("navigation").evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(overflow).toBe(true);
});

test("sub_header_readme_mark_opens_the_about_modal", async ({ mount, page }) => {
  const bar = await mount(<SubHeader readme={README} />);
  await bar.getByRole("button", { name: "About Logs" }).click();
  const dialog = page.locator("dialog");
  await expect(dialog.getByRole("heading", { name: "About Logs" })).toBeVisible();
  await expect(dialog.getByText(LEDE)).toBeVisible();
  // The lede, then every further paragraph the screen's content module has.
  await expect(dialog.locator("p")).toHaveCount(2);
});

test("sub_header_has_no_readme_mark_where_a_screen_has_nothing_to_say", async ({ mount }) => {
  const bar = await mount(<SubHeader level={levelOf(TEAM, VIEWER)} />);
  await expect(bar.getByRole("button")).toHaveCount(0);
});

test("sub_header_chip_says_you_can_edit_where_you_administer", async ({ mount }) => {
  const admin = await mount(<SubHeader level={levelOf(TEAM, ADMIN)} />);
  await expect(admin.getByText("Marketing · you can edit here")).toBeVisible();
});

test("sub_header_chip_says_read_and_use_where_you_do_not", async ({ mount }) => {
  const member = await mount(<SubHeader level={levelOf(TEAM, VIEWER)} />);
  await expect(member.getByText("Marketing · read and use")).toBeVisible();
});

test("sub_header_search_expands_on_click", async ({ mount }) => {
  const bar = await mount(<SubHeader search={SEARCH} />);
  const toggle = bar.getByRole("button", { name: "Search" });
  await expect(toggle).toBeVisible();
  await expect(bar.getByRole("searchbox")).toHaveCount(0);
  await toggle.click();
  const field = bar.getByRole("searchbox", { name: "Search" });
  await expect(field).toBeVisible();
  await expect(field).toBeFocused();
});

test("sub_header_search_collapses_on_escape_when_empty", async ({ mount }) => {
  const bar = await mount(<SubHeader search={SEARCH} />);
  await bar.getByRole("button", { name: "Search" }).click();
  await bar.getByRole("searchbox").press("Escape");
  await expect(bar.getByRole("searchbox")).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Search" })).toBeVisible();
});

test("sub_header_search_stays_open_while_it_has_a_value", async ({ mount }) => {
  const bar = await mount(<SubHeader search={SEARCH} />);
  await bar.getByRole("button", { name: "Search" }).click();
  const field = bar.getByRole("searchbox");
  await field.fill("brief");
  await field.press("Escape");
  // A filter nobody can see is a table that lies about how many rows it has.
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("brief");
  await expect(bar.getByRole("button", { name: "Close search" })).toBeVisible();
});

test("sub_header_search_opens_already_filled_when_the_url_carries_one", async ({ mount }) => {
  const bar = await mount(
    <SubHeader search={searchIn("/console/me/harnesses", "brief", "Name or description")} />,
  );
  await expect(bar.getByRole("searchbox")).toHaveValue("brief");
});

test("sub_header_renders_the_count_and_the_screens_verbs", async ({ mount }) => {
  const bar = await mount(
    <SubHeader count="3 harnesses" actions={<button type="button">New harness</button>} />,
  );
  await expect(bar.getByText("3 harnesses")).toBeVisible();
  await expect(bar.getByRole("button", { name: "New harness" })).toBeVisible();
});

test("sub_header_tab_rule_is_the_width_of_its_word_and_centred_under_it", async ({ mount }) => {
  // The rule is on the label, not on the link, so a count beside the word
  // never drags the underline off to the right (01 §7.5).
  const bar = await mount(
    <SubHeader
      tabsLabel="Kinds"
      tabs={[
        { id: "skill", label: "skill", href: "/a?kind=skill", current: true, count: 12 },
        { id: "prompt", label: "prompt", href: "/a?kind=prompt", current: false, count: 3 },
      ]}
    />,
  );
  const link = bar.getByRole("link", { name: /skill/ });
  const rule = (await link.locator("[data-rule]").boundingBox())!;
  const word = await link.locator("[data-rule]").evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const box = range.getBoundingClientRect();
    return { x: box.x, width: box.width };
  });
  // Exactly as wide as the word it underlines, and starting where it starts.
  expect(Math.abs(rule.width - word.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(rule.x - word.x)).toBeLessThanOrEqual(1);
  // The count sits outside it, so the link is wider than the rule.
  const whole = (await link.boundingBox())!;
  expect(whole.width).toBeGreaterThan(rule.width);
});

test("sub_header_first_tab_starts_on_the_screens_gutter", async ({ mount }) => {
  // The bar's `px-6` is the same gutter every block of a screen uses, so the
  // first tab's word lines up with the table underneath it.
  const bar = await mount(<SubHeader tabsLabel="Logs" tabs={TABS} />);
  const barBox = (await bar.boundingBox())!;
  const first = (await bar.getByRole("link", { name: "Changes" }).boundingBox())!;
  expect(first.x - barBox.x).toBe(24);
});
