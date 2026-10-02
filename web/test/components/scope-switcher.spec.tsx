import { expect, test } from "@playwright/experimental-ct-react";
import { ScopeSwitcher } from "@/app/(console)/shell/scope-switcher";
import { VIEWER } from "./fixtures";

const TEAM = { kind: "team" as const, path: "acme.marketing" };

test("switcher_is_a_tree_you_teams_then_organization", async ({ mount }) => {
  // 01 §4.3: one selector, in one order, with the sub-team under its team.
  const switcher = await mount(<ScopeSwitcher scope={TEAM} viewer={VIEWER} />);
  // The button says the level's own word, never the dotted path.
  await expect(switcher.getByRole("button")).toHaveText(/Marketing/);
  await switcher.getByRole("button").click();

  const items = switcher.getByRole("menuitem");
  await expect(items).toHaveCount(4);
  await expect(items).toHaveText(["You", "Marketing", "Marketing interns", "Organization"]);

  // The sub-team is indented under its team, and only the current row is marked.
  const team = await items.nth(1).evaluate((node) => getComputedStyle(node).paddingLeft);
  const sub = await items.nth(2).evaluate((node) => getComputedStyle(node).paddingLeft);
  expect(parseFloat(sub)).toBeGreaterThan(parseFloat(team));
  await expect(switcher.locator("[aria-current='true']")).toHaveCount(1);
  await expect(switcher.locator("[aria-current='true']")).toHaveText("Marketing");
});

test("switcher_keeps_the_screen_where_the_other_level_has_it", async ({ mount }) => {
  const switcher = await mount(<ScopeSwitcher scope={{ kind: "me" }} viewer={VIEWER} />);
  await expect(switcher.getByRole("button")).toHaveText(/You/);
  await switcher.getByRole("button").click();
  // The rig mounts against `/console/acme.marketing/assets`, and Assets is a
  // screen every level has, so every row keeps it.
  await expect(switcher.getByRole("menuitem", { name: "Organization" })).toHaveAttribute(
    "href",
    "/console/org/assets",
  );
  await expect(switcher.getByRole("menuitem", { name: "Marketing interns" })).toHaveAttribute(
    "href",
    "/console/acme.marketing.interns/assets",
  );
});
