import { expect, test } from "@playwright/experimental-ct-react";
import { AddBoundary } from "@/app/(console)/console/[scope]/boundaries/_add";
import { RemoveBoundary } from "@/app/(console)/console/[scope]/boundaries/_remove";
import { BOUNDARIES, BOUNDARIES_TEXT } from "@/content/screens/boundaries";
import { records } from "./writes";

test("remove_boundary_deletes", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<RemoveBoundary boundaryId="b-7f2c11a4" />);

  await page.getByRole("button", { name: BOUNDARIES_TEXT.removeVerb }).click();
  await expect(page.locator("[data-confirm-takes]")).toContainText(BOUNDARIES_TEXT.removeTakes);
  await page.getByRole("button", { name: BOUNDARIES_TEXT.removeVerb }).last().click();

  await expect.poll(() => sent).toEqual([
    { method: "DELETE", path: "/v1/boundaries/b-7f2c11a4", body: undefined },
  ]);
});

/* W7-D8: the add form's *Applies to*. The proof is the body, because the
   difference between a boundary that reaches every harness and one that
   reaches none yet is one key, and the engine reads only that key. */

const HARNESSES = [
  { id: "h-1", name: "Drafts" },
  { id: "h-2", name: "Support" },
];

test("add_a_boundary_for_only_the_harnesses_i_choose_posts_them", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(
    <AddBoundary scopePath="acme" orgPath="acme" kind="files" harnesses={HARNESSES} />,
  );

  await page.getByRole("button", { name: BOUNDARIES.verbs.add.label }).click();
  await page.getByLabel(BOUNDARIES_TEXT.valueLabel).fill("/etc/shadow");
  await page.getByLabel(BOUNDARIES_TEXT.reasonLabel).fill("Nothing reads it.");
  // The checklist appears only once it has been asked for, and it is the
  // level's harnesses by name — never their ids (W7-D8).
  await expect(page.getByLabel("Drafts")).toHaveCount(0);
  await page.getByLabel(BOUNDARIES_TEXT.harnessesLabel).selectOption("chosen");
  await page.getByLabel("Drafts").check();
  await page.getByRole("button", { name: BOUNDARIES_TEXT.addSubmit }).click();

  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/boundaries",
      body: {
        kind: "filesystem",
        value: "/etc/shadow",
        holds: "enforced",
        reason: "Nothing reads it.",
        scope: { teams: "all", harnesses: ["h-1"] },
        at: "acme",
      },
    },
  ]);
});

test("add_a_boundary_for_every_harness_sends_no_harnesses_key", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(
    <AddBoundary scopePath="acme" orgPath="acme" kind="files" harnesses={HARNESSES} />,
  );

  await page.getByRole("button", { name: BOUNDARIES.verbs.add.label }).click();
  await page.getByLabel(BOUNDARIES_TEXT.valueLabel).fill("/etc/shadow");
  await page.getByLabel(BOUNDARIES_TEXT.reasonLabel).fill("Nothing reads it.");
  await page.getByRole("button", { name: BOUNDARIES_TEXT.addSubmit }).click();

  // Absent, not empty: an empty list would be a boundary bound to no harness
  // — written, listed, and holding nothing (engine 03 §5.1).
  await expect.poll(() => sent).toHaveLength(1);
  expect((sent[0].body as { scope: Record<string, unknown> }).scope).toEqual({ teams: "all" });
});
