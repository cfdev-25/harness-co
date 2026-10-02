import { expect, test } from "@playwright/experimental-ct-react";
import { AppliesHere } from "@/app/(console)/console/[scope]/harnesses/[id]/_applies";
import { ADMIN, HARNESS_VIEW, VIEWER } from "./fixtures";

const TEAM = { kind: "team" as const, path: "acme.marketing" };

test("applies_here_links_for_an_admin_of_the_level", async ({ mount }) => {
  // 04 §5: an admin of this level gets the screen that sets each one.
  const aside = await mount(
    <AppliesHere view={HARNESS_VIEW} scope={TEAM} viewer={ADMIN} reach={null} />,
  );
  await expect(aside.getByRole("link", { name: /\*\.pastebin\.com/ })).toHaveAttribute(
    "href",
    "/console/acme.marketing/boundaries",
  );
  await expect(aside.getByRole("link", { name: /marketing-crm/ })).toHaveAttribute(
    "href",
    "/console/acme.marketing/groups/marketing-crm",
  );
});

test("applies_here_is_plain_text_for_a_member", async ({ mount }) => {
  // A link that can only refuse is worse than plain text (P13), and the level
  // has no Boundaries or Security groups screen for a member (01 §4.4).
  const aside = await mount(
    <AppliesHere view={HARNESS_VIEW} scope={TEAM} viewer={VIEWER} reach={null} />,
  );
  await expect(aside.getByText("*.pastebin.com")).toBeVisible();
  await expect(aside.getByText("marketing-crm")).toBeVisible();
  // The rows themselves are text; the Commands button is the section's only
  // control, and it is a command sheet, not a screen they may not open.
  await expect(aside.getByRole("link", { name: /pastebin/ })).toHaveCount(0);
  await expect(aside.getByRole("link", { name: /marketing-crm/ })).toHaveCount(0);
});

test("applies_here_reads_not_set_when_the_response_carries_no_reach", async ({ mount }) => {
  const aside = await mount(
    <AppliesHere view={HARNESS_VIEW} scope={TEAM} viewer={ADMIN} reach={null} />,
  );
  await expect(aside.getByText("Applies here")).toBeVisible();
  await expect(aside.getByText("Reach: not set")).toBeVisible();
});

test("applies_here_says_the_mode_and_the_level_that_set_it", async ({ mount }) => {
  const aside = await mount(
    <AppliesHere
      view={HARNESS_VIEW}
      scope={TEAM}
      viewer={ADMIN}
      reach={{ mode: "allow", hosts: ["pypi.org", "files.pythonhosted.org"], setBy: "acme.marketing" }}
    />,
  );
  await expect(aside.getByText("Reach: allow-list, 2 hosts")).toBeVisible();
  await expect(aside.getByText("set by Marketing")).toBeVisible();
});

test("applies_here_names_the_harness_when_the_harness_set_its_own_reach", async ({ mount }) => {
  // `setBy` is `harness:<id>` when the harness took the last narrowing step
  // (D131). The page knows its own name, so it never prints the id.
  const aside = await mount(
    <AppliesHere
      view={HARNESS_VIEW}
      scope={TEAM}
      viewer={ADMIN}
      reach={{ mode: "off", hosts: [], setBy: "harness:h_1" }}
    />,
  );
  await expect(aside.getByText("Reach: off")).toBeVisible();
  await expect(aside.getByText("set by Support")).toBeVisible();
});
