import { expect, test } from "@playwright/experimental-ct-react";
import { NewHarness } from "@/app/(console)/console/[scope]/_new-harness";
import { HARNESSES, HARNESSES_WORDS as WORDS } from "@/content/screens/harnesses";
import { records } from "./writes";

test("new_harness_scope_is_bare_path", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(
    <NewHarness scope={{ kind: "team", path: "acme.marketing" }} cards={[]} canEdit />,
  );

  await page.getByRole("button", { name: HARNESSES.verbs.newHarness.label }).click();
  await page.getByLabel(WORDS.newName).fill("Campaign drafts");
  await page.getByRole("button", { name: WORDS.newSubmit }).click();

  // `HarnessIn.scope` is the segment; `team:` is the `?scope=` spelling and
  // the route reads it as a team path of that name, so it refused every time.
  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/harnesses",
      body: { name: "Campaign drafts", description: "", scope: "acme.marketing" },
    },
  ]);
});

test("new_harness_at_a_level_you_read_lands_on_your_own_branch", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(
    <NewHarness scope={{ kind: "team", path: "acme.marketing" }} cards={[]} canEdit={false} />,
  );

  // W5-D9: the button says where it will land, and posts `me`.
  await page.getByRole("button", { name: HARNESSES.verbs.newHarnessMine.label }).click();
  await page.getByLabel(WORDS.newName).fill("Campaign drafts");
  await page.getByRole("button", { name: WORDS.newSubmit }).click();

  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/harnesses",
      body: { name: "Campaign drafts", description: "", scope: "me" },
    },
  ]);
});

/* W7-D4: the first-harness modal's two questions. The proof is at the wire —
   what the body carried — because *Web access off* that posts nothing is a
   switch that lies, and a grant the route never sees is no keys at all. */

test("new_harness_asks_web_access_and_outside_keys_on_a_personal_account", async ({
  mount,
  page,
}) => {
  const sent = await records(page);
  await mount(
    <NewHarness
      scope={{ kind: "me" }}
      cards={[]}
      canEdit
      personal={{ groups: ["my-keys"], setup: { installed: true, loggedIn: true,
                                                model: "key", harness: false } }}
    />,
  );

  await page.getByRole("button", { name: HARNESSES.verbs.newHarness.label }).click();
  await page.getByLabel(WORDS.newName).fill("First");
  // The model is a fact, not a control: it says which one, and nothing here
  // can change it.
  await expect(page.getByText(WORDS.newModelKey)).toBeVisible();
  // Web access is a switch, and it starts on — which is what the personal
  // organization's own reach is, so a harness that keeps it writes nothing.
  const web = page.getByRole("switch");
  await expect(web).toBeChecked();
  await web.uncheck();
  await page.getByLabel(WORDS.newKeys).selectOption("my-keys");
  await page.getByRole("button", { name: WORDS.newSubmit }).click();

  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/harnesses",
      body: {
        name: "First",
        description: "",
        scope: "me",
        // `off` only: absent means *inherit*, and a harness that restated `on`
        // would be a `reach-widened` conflict the day the organization turned
        // its own reach down (D131).
        reach: { mode: "off", hosts: [] },
        grant: { group: "my-keys" },
      },
    },
  ]);
});

test("new_harness_on_a_personal_account_writes_nothing_for_the_defaults", async ({
  mount,
  page,
}) => {
  const sent = await records(page);
  await mount(
    <NewHarness
      scope={{ kind: "me" }}
      cards={[]}
      canEdit
      personal={{ groups: ["my-keys"], setup: undefined }}
    />,
  );

  await page.getByRole("button", { name: HARNESSES.verbs.newHarness.label }).click();
  await page.getByLabel(WORDS.newName).fill("First");
  // No `setup` at all: the line asks for a key rather than promising a model,
  // and the Providers link is the one place that is done.
  await expect(page.getByText(WORDS.newModelNone)).toBeVisible();
  await expect(page.getByRole("link", { name: WORDS.newModelLink })).toHaveAttribute(
    "href",
    "/console/me/providers/model",
  );
  await page.getByRole("button", { name: WORDS.newSubmit }).click();

  // Web access left on and keys left at *None*: neither field is sent, so the
  // harness inherits reach and holds no grant of its own.
  await expect.poll(() => sent).toEqual([
    { method: "POST", path: "/v1/harnesses", body: { name: "First", description: "", scope: "me" } },
  ]);
});

test("new_harness_asks_an_enterprise_viewer_neither", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<NewHarness scope={{ kind: "me" }} cards={[]} canEdit />);

  await page.getByRole("button", { name: HARNESSES.verbs.newHarness.label }).click();
  await page.getByLabel(WORDS.newName).fill("First");
  // W7-D4 is the personal account's dialog. An enterprise viewer's reach is
  // the organization's and their keys are a grant an admin makes, so there is
  // no control here and nothing in the body about either.
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByLabel(WORDS.newKeys)).toHaveCount(0);
  await expect(page.getByText(WORDS.newModelNone)).toHaveCount(0);
  await page.getByRole("button", { name: WORDS.newSubmit }).click();

  await expect.poll(() => sent).toEqual([
    { method: "POST", path: "/v1/harnesses", body: { name: "First", description: "", scope: "me" } },
  ]);
});

/* D108: the pixel pet is drawn in this dialog, and the proof is at the wire —
   an icon the component holds and never posts is a drawing the person loses. */

test("new_harness_sends_the_drawing_the_person_made", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<NewHarness scope={{ kind: "me" }} cards={[]} canEdit />);

  await page.getByRole("button", { name: HARNESSES.verbs.newHarness.label }).click();
  await page.getByLabel(WORDS.newName).fill("Pet");
  // The same editor the harness page's Edit uses, so the same keyboard path:
  // `SWATCHES[4]` is the swatch it opens with.
  await page.locator("[data-cell='0']").focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: WORDS.newSubmit }).click();

  await expect.poll(() => sent).toHaveLength(1);
  const body = sent[0].body as { icon: { palette: string[]; rows: string[] } };
  expect(body.icon.palette).toEqual(["#e6eaf0"]);
  expect(body.icon.rows[0][0]).toBe("0");
  expect(body.icon.rows).toHaveLength(16);
});

test("new_harness_skipped_or_untouched_sends_no_icon", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<NewHarness scope={{ kind: "me" }} cards={[]} canEdit />);

  await page.getByRole("button", { name: HARNESSES.verbs.newHarness.label }).click();
  await page.getByLabel(WORDS.newName).fill("Plain");
  // Skipping says what it gets — the grey square — rather than leaving an
  // empty grid that would post sixteen rows of dots.
  await page.getByRole("button", { name: WORDS.newIconSkip }).click();
  await expect(page.getByText(WORDS.newIconNone)).toBeVisible();
  await page.getByRole("button", { name: WORDS.newSubmit }).click();

  await expect.poll(() => sent).toEqual([
    { method: "POST", path: "/v1/harnesses", body: { name: "Plain", description: "", scope: "me" } },
  ]);
});
