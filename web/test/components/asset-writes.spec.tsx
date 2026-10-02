import { expect, test } from "@playwright/experimental-ct-react";
import { DeleteAsset } from "@/app/(console)/console/[scope]/assets/_delete";
import { EditAsset } from "@/app/(console)/console/[scope]/assets/_edit";
import { Browse } from "@/app/(console)/console/[scope]/assets/_browse";
import { SetLoads } from "@/app/(console)/console/[scope]/assets/[id]/_loads";
import type { BrowseRow } from "@/lib/views/assets";
import { HARNESSES_WORDS } from "@/content/screens/harnesses";
import { ASSETS, ASSETS_TEXT } from "@/content/screens/assets";
import { records, refuses } from "./writes";

const ASSET = "0460b220-8379-5ddf-82ef-31bc0e8a99e1";

test("edit_asset_patches_only_what_changed_at_the_scope", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(
    <EditAsset assetId={ASSET} name="house-style" description="How we write" scope="team:acme.marketing" />,
  );

  await page.getByRole("button", { name: ASSETS.verbs.edit.label }).click();
  await page.getByLabel(ASSETS_TEXT.editDescription).fill("How Marketing writes");
  await page.getByRole("button", { name: ASSETS_TEXT.editSubmit }).click();

  // The name did not change, so it is not sent: an unchanged field would
  // still be a commit. `?scope=` is the api's spelling of the level.
  await expect.poll(() => sent).toEqual([
    {
      method: "PATCH",
      path: `/v1/assets/${ASSET}?scope=team:acme.marketing`,
      body: { description: "How Marketing writes" },
    },
  ]);
});

test("delete_asset_names_the_harnesses_it_leaves_then_deletes", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(
    <DeleteAsset assetId={ASSET} leaves={{ all: false, labels: ["Support", "Weekly newsletter"] }} scope="me" />,
  );

  await page.getByRole("button", { name: ASSETS.verbs.remove.label }).click();
  const takes = page.locator("[data-confirm-takes]");
  await expect(takes).toContainText(ASSETS_TEXT.removeLeaves);
  await expect(takes).toContainText("Support");
  await expect(takes).toContainText("Weekly newsletter");
  await page.getByRole("button", { name: ASSETS.verbs.remove.label }).last().click();

  await expect.poll(() => sent).toEqual([
    { method: "DELETE", path: `/v1/assets/${ASSET}?scope=me`, body: undefined },
  ]);
});

test("delete_asset_shows_the_servers_refusal_in_place", async ({ mount, page }) => {
  const refusal = {
    status: 403,
    code: "asset.required",
    message: "harness-authoring is required: every session loads it, so it cannot be deleted.",
    remedy: "An organisation admin decides what is required.",
  };
  await refuses(page, refusal);
  await mount(<DeleteAsset assetId={ASSET} leaves={{ all: true, labels: [] }} scope="org" />);

  await page.getByRole("button", { name: ASSETS.verbs.remove.label }).click();
  // An always-loaded asset leaves every harness, which is a sentence and not
  // a list (PRD §15).
  await expect(page.locator("[data-confirm-takes]")).toContainText(ASSETS_TEXT.removeLeavesAll);
  await page.getByRole("button", { name: ASSETS.verbs.remove.label }).last().click();

  // 02 rule 21: the server's words, where the verb is — inside the dialog,
  // which is on the top layer and would hide a notice rendered behind it.
  const takes = page.locator("[data-confirm-takes]");
  await expect(takes).toContainText(refusal.message);
  await expect(takes).toContainText(refusal.remedy);
});

// --- the loads control and the store (W5-D10, W5-D15) ------------------------

test("set_loads_is_a_three_way_choice_posting_the_new_words", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<SetLoads assetId={ASSET} loads="on-request" />);

  // W5-D10's three states are the control. `recommended` takes nothing away,
  // so it commits on the press; `required` confirms first (below).
  await page.getByRole("radio", { name: ASSETS_TEXT.loadsRecommended }).click();
  await expect.poll(() => sent).toEqual([
    { method: "PUT", path: `/v1/assets/${ASSET}/loads`, body: { loads: "recommended" } },
  ]);

  await page.getByRole("radio", { name: ASSETS_TEXT.loadsRequired }).click();
  // The confirmation is what it takes (02 rule 22), not *Are you sure?*
  await expect(page.locator("[data-confirm-takes]")).toContainText(ASSETS_TEXT.confirmTakes);
  await page.getByRole("button", { name: ASSETS_TEXT.confirmVerb }).click();
  await expect.poll(() => sent.at(-1)).toEqual({
    method: "PUT",
    path: `/v1/assets/${ASSET}/loads`,
    // The old words (`always`, `chosen`) are accepted by the route for one
    // release and are never sent again from here.
    body: { loads: "required" },
  });
});

const STORE: BrowseRow[] = [
  {
    id: "11111111-1111-4111-8111-111111111111", kind: "tool", name: "csv-summary",
    description: "Summarises a CSV", level: "org", from: "acme",
    href: "/console/org/assets/11111111-1111-4111-8111-111111111111", held: false,
    preset: false, needsEnvironment: "python-data",
  },
  {
    id: "22222222-2222-4222-8222-222222222222", kind: "environment", name: "python-data",
    description: "", level: "preset", from: "", href: null, held: false,
    preset: true, needsEnvironment: null,
  },
];

const HARNESSES = [
  { id: "33333333-3333-4333-8333-333333333333", name: "Scratch", description: "",
    team: { path: "acme.marketing.jo", name: "jo" }, fileCount: 0 },
];

test("add_to_harness_posts_the_ticked_ids_to_the_persons_version", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(
    <Browse
      rows={STORE}
      harnesses={HARNESSES}
      scope={{ kind: "me" }}
      kind=""
      base="/console/me/assets"
      query=""
    />,
  );

  // Nothing is ticked, so there is no bar: the verbs appear with a selection.
  await expect(page.locator("[data-selection-bar]")).toHaveCount(0);
  await page.getByLabel("Pick csv-summary").check();
  await expect(page.locator("[data-selection-bar]")).toContainText(ASSETS_TEXT.browseSelectedOne);

  await page.getByRole("button", { name: ASSETS_TEXT.addToHarness }).click();
  // W5-D15: the tool brought the environment it needs, and the dialog says
  // which and why before the button is pressed.
  const adds = page.locator("[data-adds]");
  await expect(adds).toContainText("environment/python-data");
  await expect(adds).toContainText("tool/csv-summary");
  await expect(adds).toContainText(ASSETS_TEXT.browsePresetNote);

  await page.getByRole("button", { name: ASSETS_TEXT.addSubmit, exact: true }).click();
  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      // The person's own version of the harness, which is what `?scope=me`
      // says — the same file the CLI's `joinHarness` writes.
      path: `/v1/harnesses/${HARNESSES[0].id}/assets?scope=me`,
      body: { ids: [STORE[0].id, STORE[1].id] },
    },
  ]);
});

test("new_harness_from_selection_opens_the_screens_own_dialog", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(
    <Browse
      rows={STORE}
      harnesses={HARNESSES}
      scope={{ kind: "me" }}
      kind=""
      base="/console/me/assets"
      query=""
    />,
  );
  await page.getByLabel("Pick python-data").check();
  await page.getByRole("button", { name: ASSETS_TEXT.newFromSelection }).click();
  await page.getByLabel(HARNESSES_WORDS.newName).fill("From the store");
  await page.getByRole("button", { name: HARNESSES_WORDS.newSubmit }).click();

  // One dialog, the harnesses screen's: the ids ride in `assets` and the
  // branch is always the person's own.
  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/harnesses",
      body: {
        name: "From the store",
        description: "",
        assets: [STORE[1].id],
        scope: "me",
      },
    },
  ]);
});
