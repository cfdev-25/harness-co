import { expect, test } from "@playwright/experimental-ct-react";
import { BoundaryBlocks } from "@/app/(console)/console/[scope]/boundaries/_blocks";
import { SubHeader } from "@/app/(console)/ui/sub-header";
import { boundaryTabs } from "@/lib/views/boundaries";
import { AddBoundary } from "@/app/(console)/console/[scope]/boundaries/_add";
import { SuggestCommands } from "@/app/(console)/console/[scope]/boundaries/commands/_suggested";
import type { BoundaryRow } from "@/lib/views/boundaries";
import { BOUNDARIES, BOUNDARIES_TEXT as WORDS } from "@/content/screens/boundaries";
import { records } from "./writes";

/**
 * W6-D8/D9/D10 at the network: the three tabs as routes, the two blocks every
 * one of them is made of, the kind the tab opens its form on, and the starter
 * adds. Every write is proved by what left the browser (02 rule 30).
 */

const ORG = "acme";
const TEAM = "acme.marketing";

const row = (over: Partial<BoundaryRow> & { path: string }): BoundaryRow => ({
  id: `${over.path}/${over.value ?? "x"}`,
  kind: "command",
  value: "rm -rf /*",
  holds: "intercepted",
  reason: "A wipe of the system root is never a step in a task.",
  scope: { teams: "all" },
  setBy: { kind: over.path === ORG ? "org" : "team", path: over.path, name: over.path, ref: "r" },
  ...over,
});

const ORG_WIPE = row({ path: ORG });
const ORG_PIPE = row({ path: ORG, value: "curl * | sh", reason: "Code nobody has read." });
const TEAM_PUSH = row({ path: TEAM, value: "git push --force*", reason: "Contract 4.2." });

test("boundary_tabs_are_three_routes_under_the_scope", async ({ mount }) => {
  const tabs = await mount(
    <SubHeader
      tabsLabel={BOUNDARIES.title}
      tabs={boundaryTabs("/console/team/acme.marketing", "commands")}
    />,
  );
  for (const [tab, label] of Object.entries(WORDS.tabs)) {
    await expect(tabs.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      `/console/team/acme.marketing/boundaries/${tab}`,
    );
  }
  // The tab you are on is the current page, for a screen reader as well as an eye.
  await expect(tabs.getByRole("link", { name: WORDS.tabs.commands })).toHaveAttribute("aria-current", "page");
});

test("boundaries_inherited_is_read_only_and_set_here_is_not", async ({ mount }) => {
  const blocks = await mount(
    <BoundaryBlocks
      rows={[ORG_WIPE, TEAM_PUSH]}
      here={TEAM}
      personal={false}
      orgLabel={ORG}
      mayAdd
      empty="none"
    />,
  );
  const inherited = blocks.locator("[data-inherited]");
  const here = blocks.locator("[data-here]");
  // Each block holds the rows of its own origin, and the inherited one says
  // which level set each — a boundary is lifted where it was set.
  await expect(inherited).toContainText("rm -rf /*");
  await expect(inherited).toContainText(ORG);
  await expect(inherited).toContainText(WORDS.inheritedReadOnly);
  await expect(inherited.getByRole("button", { name: WORDS.removeVerb })).toHaveCount(0);
  await expect(here).toContainText("git push --force*");
  await expect(here.getByRole("button", { name: WORDS.removeVerb })).toHaveCount(1);
});

test("boundaries_at_the_top_of_the_chain_inherit_nothing", async ({ mount }) => {
  // At the organization there is nothing above, so the block says so rather
  // than showing an empty table.
  const atOrg = await mount(
    <BoundaryBlocks rows={[ORG_WIPE]} here={ORG} personal={false} orgLabel={ORG} mayAdd empty="none" />,
  );
  await expect(atOrg.locator("[data-inherited]")).toContainText(WORDS.inheritedNone);
  await expect(atOrg.locator("[data-here]")).toContainText("rm -rf /*");
});

test("boundaries_set_here_is_empty_and_unactionable_for_a_member", async ({ mount }) => {
  const asMember = await mount(
    <BoundaryBlocks rows={[ORG_WIPE]} here={TEAM} personal={false} orgLabel={ORG} mayAdd={false} empty="none" />,
  );
  await expect(asMember.locator("[data-here]")).toContainText(WORDS.hereNone);
  await expect(asMember.getByRole("button", { name: WORDS.removeVerb })).toHaveCount(0);
  // And the sentence says whose decision it is, rather than a dead control (P13).
  await expect(asMember.locator("[data-here]")).toContainText("team admin");
});

test("a_command_row_says_which_runtime_intercepts_it", async ({ mount }) => {
  // W6-D9, engine 07 §8: Claude Code matches each subcommand on its own, so a
  // pattern with a pipe in it never fires there. The row says *by Pi* rather
  // than claiming a refusal nobody measured.
  const blocks = await mount(
    <BoundaryBlocks rows={[ORG_WIPE, ORG_PIPE]} here={ORG} personal={false} orgLabel={ORG} mayAdd empty="none" />,
  );
  await expect(blocks.getByText(`by ${WORDS.interceptedByBoth}`)).toHaveCount(1);
  await expect(blocks.getByText(`by ${WORDS.interceptedByPi}`, { exact: true })).toHaveCount(1);
});

test("add_from_the_commands_tab_posts_a_command_at_this_level", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<AddBoundary scopePath={TEAM} orgPath={ORG} kind="commands" />);
  // `page`, not the mounted locator: `AddBoundary` renders a fragment and its
  // modal is a portal, so neither is inside the rig's component wrapper
  // (`boundary-writes.spec.tsx` reads the remove confirm the same way).
  await page.getByRole("button", { name: BOUNDARIES.verbs.add.label }).click();

  // The tab picks the kind, and `holds` is not a choice: a command is refused
  // by the runtime and by nothing else (engine 06 §13).
  await expect(page.getByLabel(WORDS.holdsLabel)).toHaveValue(WORDS.holdsCommandFixed);
  await page.getByLabel(WORDS.valueLabel).fill("shutdown*");
  await page.getByLabel(WORDS.reasonLabel).fill("Not ours to do.");
  await page.getByRole("button", { name: WORDS.addSubmit }).click();

  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/boundaries",
      body: {
        kind: "command",
        value: "shutdown*",
        holds: "intercepted",
        reason: "Not ours to do.",
        scope: { teams: [TEAM] },
        at: TEAM,
      },
    },
  ]);
});

test("a_pattern_that_denies_everything_is_said_where_it_is_typed", async ({ mount, page }) => {
  await mount(<AddBoundary scopePath={ORG} orgPath={ORG} kind="commands" />);
  await page.getByRole("button", { name: BOUNDARIES.verbs.add.label }).click();
  await page.getByLabel(WORDS.valueLabel).fill("*");
  await expect(page.getByText("A pattern of only * denies every command there is.")).toBeVisible();
  // Said, never pre-empted: the api is what decides (P13, 02 rule 21).
  await expect(page.getByRole("button", { name: WORDS.addSubmit })).not.toHaveAttribute("aria-disabled", "true");
});

test("the_command_starter_set_is_one_click_each_and_never_offered_twice", async ({ mount, page }) => {
  const sent = await records(page);
  const offer = await mount(
    <SuggestCommands
      scopePath={ORG}
      orgPath={ORG}
      view={{
        canEdit: true,
        suggested: [
          { value: "rm -rf /*", holds: "intercepted", reason: "Never a step in a task.", present: true },
          { value: "git push --force*", holds: "intercepted", reason: "It destroys pushed work.", present: false },
        ],
      }}
    />,
  );
  // One that is already held says so; one that is not is a button, and the
  // reason it ships with travels with the add — a boundary added with a blank
  // reason is a refusal nobody can act on.
  await expect(offer.getByText(WORDS.alreadySet)).toHaveCount(1);
  await offer.getByRole("button", { name: WORDS.addVerb }).click();

  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/boundaries",
      body: {
        kind: "command",
        value: "git push --force*",
        holds: "intercepted",
        reason: "It destroys pushed work.",
        // At the organization *below me* is every team, and `covers()` compares
        // a scope against the chain's **team** nodes — the organization node is
        // not one, so naming it would write a boundary that reaches nobody.
        scope: { teams: "all" },
        at: ORG,
      },
    },
  ]);
});
