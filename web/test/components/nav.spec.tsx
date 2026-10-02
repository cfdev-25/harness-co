import { expect, test } from "@playwright/experimental-ct-react";
import { Sidebar } from "@/app/(console)/shell/sidebar";
import { navKeyOf } from "@/app/(console)/shell/nav";
import { Section } from "@/app/(console)/shell/section";
import { ADMIN, VIEWER } from "./fixtures";

const TEAM = { kind: "team" as const, path: "acme.marketing" };

test("nav_current_on_team_path", async ({ mount }) => {
  // 00 D2: a team scope is one dotted segment. The old pattern expected
  // `team/<path>` and matched no real URL, so `aria-current` was lost.
  expect(navKeyOf("/console/acme.marketing/boundaries")).toBe("boundaries");
  // Every tab of Logs — and the old Sessions address — is the Logs row.
  expect(navKeyOf("/console/acme.marketing/logs/endpoints")).toBe("logs");
  expect(navKeyOf("/console/acme.marketing/logs/sessions/s_1")).toBe("logs");
  expect(navKeyOf("/console/org/harnesses")).toBe("harnesses");
  expect(navKeyOf("/console/how")).toBe("how");

  const nav = await mount(
    <Sidebar scope={TEAM} viewer={ADMIN} pathname="/console/acme.marketing/boundaries" />,
  );
  const current = nav.locator("[aria-current='page']");
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("Boundaries");
});

test("nav_member_on_a_team_sees_the_four_rows_the_level_holds", async ({ mount }) => {
  // 01 §4.4: the permission screens belong to whoever administers the level,
  // and a row that can only refuse is worse than no row (P13).
  const member = await mount(
    <Sidebar scope={TEAM} viewer={VIEWER} pathname="/console/acme.marketing/harnesses" />,
  );
  // `Harnesses` carries the waiting count, so the row reads *Harnesses2*.
  await expect(member.getByRole("link")).toHaveText([
    /^Harnesses/, "Assets", "Logs", "People", "How this works",
  ]);
});

test("nav_team_admin_adds_the_permission_screens_but_not_key_vaults", async ({ mount }) => {
  const admin = await mount(
    <Sidebar scope={TEAM} viewer={ADMIN} pathname="/console/acme.marketing/harnesses" />,
  );
  await expect(admin.getByRole("link")).toHaveText([
    /^Harnesses/, "Assets", "Security groups", "Boundaries", "Providers", "Logs",
    "People", "Teams", "How this works",
  ]);
  // Key vaults are the organisation's, not a team's.
  await expect(admin.getByRole("link", { name: "Key vaults" })).toHaveCount(0);
});

test("nav_personal_has_boundaries_and_no_teams", async ({ mount }) => {
  const personal = await mount(
    <Sidebar
      scope={{ kind: "org" }}
      viewer={{ ...ADMIN, edition: "personal", teams: [] }}
      pathname="/console/org/harnesses"
    />,
  );
  await expect(personal.getByRole("link")).toHaveText([
    /^Harnesses/, "Assets", "Boundaries", "Logs", "Account", "How this works",
  ]);
});

test("nav_logs_row_is_not_announced_twice", async ({ mount }) => {
  // The group heading and its one row said "Logs" twice once Sessions and
  // Endpoints became tabs; the heading goes when it only repeats the row.
  const nav = await mount(
    <Sidebar scope={{ kind: "me" }} viewer={VIEWER} pathname="/console/me/harnesses" />,
  );
  await expect(nav.getByText("Logs", { exact: true })).toHaveCount(1);
});

/**
 * D99: the page's name is the sidebar row you pressed, in the chrome, and it
 * is the document's one `h1` (02 rule 35). A detail screen is still its
 * section — *Harnesses*, never the harness's own name. The rig mounts one
 * component per test, so each route is its own case.
 */
const SECTIONS: Array<[string, string]> = [
  ["/console/acme.marketing/harnesses", "Harnesses"],
  ["/console/org/harnesses/h_1?view=files", "Harnesses"],
  ["/console/me/logs/sessions/s_1", "Logs"],
  ["/console/how", "How this works"],
];

for (const [route, label] of SECTIONS) {
  test(`section_names_the_screen_at_${route}`, async ({ mount, page }) => {
    await mount(<Section pathname={route} />);
    await expect(page.getByRole("heading", { name: label, level: 1 })).toBeVisible();
  });
}

test("section_is_nothing_where_no_screen_is_named", async ({ mount, page }) => {
  await mount(<Section pathname="/console/org" />);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
});

test("nav_row_truncates_and_carries_its_words_as_a_title", async ({ mount }) => {
  // 01 §4.4: the rail is 144px, so *Security groups* does not fit. It
  // truncates with an ellipsis and keeps its words for a hover and for a
  // screen reader, rather than wrapping the rail to two lines.
  const nav = await mount(
    <Sidebar scope={TEAM} viewer={ADMIN} pathname="/console/acme.marketing/groups" />,
  );
  const row = nav.getByRole("link", { name: "Security groups" }).locator("span[title]");
  await expect(row).toHaveAttribute("title", "Security groups");
  await expect(row).toHaveCSS("text-overflow", "ellipsis");
});
