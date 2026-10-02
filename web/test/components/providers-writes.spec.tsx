import { expect, test } from "@playwright/experimental-ct-react";
import { PROVIDERS, PROVIDERS_TEXT } from "@/content/screens/providers";
import { ModelProviders } from "./providers-story";
import { records, refuses } from "./writes";

const HARNESS = "7bb0f4ee-0e8a-4f6a-9df0-4b6bd3f0a001";
/** The fixture's whole routing file: every write sends it back with one cell
 *  changed, because `PUT /v1/routing` replaces the file (W6-D5). */
const HELD = {
  defaultFor: { teams: { acme: "anthropic" }, harnesses: {}, providers: {} },
  approvedFor: { teams: { acme: ["anthropic"] }, harnesses: {}, providers: {} },
};

test("model_provider_set_default_at_the_network", async ({ mount, page }) => {
  const sent = await records(page);
  const table = await mount(<ModelProviders connected />);

  await table.getByRole("button", { name: PROVIDERS.verbs.setRouting.label }).click();
  const modal = table.getByRole("dialog");
  await expect(modal).toContainText("Set anthropic as the default for");
  // The picker names the three dimensions and the subjects the server listed —
  // a harness by its name, never its uuid (W6-D5).
  await modal.getByRole("combobox", { name: PROVIDERS_TEXT.pickDimension })
    .selectOption("harnesses");
  const subject = modal.getByRole("combobox", { name: PROVIDERS_TEXT.pickSubject });
  await expect(subject).toContainText("Newsletter");
  expect(await subject.innerText()).not.toContain(HARNESS);
  await subject.selectOption(HARNESS);
  await modal.getByRole("button", { name: PROVIDERS_TEXT.setDefaultSubmit }).click();

  // The default is an approval too: a default outside *approved for* is a cell
  // that resolves to a provider the broker refuses at step 5.
  await expect.poll(() => sent).toEqual([
    {
      method: "PUT",
      path: "/v1/routing",
      body: {
        defaultFor: { ...HELD.defaultFor, harnesses: { [HARNESS]: "anthropic" } },
        approvedFor: { ...HELD.approvedFor, harnesses: { [HARNESS]: ["anthropic"] } },
      },
    },
  ]);
});

test("model_provider_approve_for_at_the_network", async ({ mount, page }) => {
  const sent = await records(page);
  const table = await mount(<ModelProviders connected />);

  await table.getByRole("button", { name: PROVIDERS.verbs.approveFor.label }).click();
  const modal = table.getByRole("dialog");
  await modal.getByRole("combobox", { name: PROVIDERS_TEXT.pickDimension })
    .selectOption("providers");
  await modal.getByRole("combobox", { name: PROVIDERS_TEXT.pickSubject }).selectOption("pi");
  await modal.getByRole("button", { name: PROVIDERS_TEXT.approveForSubmit }).click();

  await expect.poll(() => sent).toEqual([
    {
      method: "PUT",
      path: "/v1/routing",
      body: {
        defaultFor: HELD.defaultFor,
        approvedFor: { ...HELD.approvedFor, providers: { pi: ["anthropic"] } },
      },
    },
  ]);
});

test("model_provider_remove_approval_at_the_network", async ({ mount, page }) => {
  const sent = await records(page);
  const table = await mount(<ModelProviders connected />);

  // The remove sits on the approval it takes away, and the default that relied
  // on it goes with it.
  await table.getByRole("button", { name: PROVIDERS_TEXT.remove }).click();
  await expect.poll(() => sent).toEqual([
    {
      method: "PUT",
      path: "/v1/routing",
      body: {
        defaultFor: { teams: {}, harnesses: {}, providers: {} },
        approvedFor: { teams: { acme: [] }, harnesses: {}, providers: {} },
      },
    },
  ]);
});

test("delete_model_provider_at_the_network", async ({ mount, page }) => {
  const sent = await records(page);
  const table = await mount(<ModelProviders connected />);

  await table.getByRole("button", { name: PROVIDERS.verbs.deleteModelProvider.label }).click();
  const dialog = table.getByRole("dialog");
  // 04 §18: the confirm says what the delete takes, not *are you sure*.
  await expect(dialog).toContainText(PROVIDERS_TEXT.deleteTakes);
  await dialog.getByRole("button", { name: PROVIDERS_TEXT.deleteSubmit }).click();

  await expect.poll(() => sent).toEqual([
    { method: "DELETE", path: "/v1/providers/model/anthropic?scope=org", body: undefined },
  ]);
});

test("delete_model_provider_shows_the_in_use_refusal", async ({ mount, page }) => {
  await refuses(page, {
    status: 409,
    code: "provider.in_use",
    message: "anthropic is still routed to by acme and held by the security group model-keys.",
    remedy: "Take those away first.",
  });
  const table = await mount(<ModelProviders connected />);
  await table.getByRole("button", { name: PROVIDERS.verbs.deleteModelProvider.label }).click();
  await table.getByRole("dialog").getByRole("button", { name: PROVIDERS_TEXT.deleteSubmit })
    .click();
  // 02 rule 21: the server's own sentence, with the names in it.
  await expect(table.getByText(/still routed to by acme/)).toBeVisible();
});

test("a_provider_that_needs_a_key_carries_no_routing_verb", async ({ mount }) => {
  // W6-D6: the row is excluded from both maps, and says why where the verb
  // would be — the key is the thing to fix, so *Set up* is the only verb.
  const table = await mount(<ModelProviders />);
  await expect(table.getByText(PROVIDERS_TEXT.needsKeyNote).first()).toBeVisible();
  await expect(table.getByRole("button", { name: PROVIDERS.verbs.setRouting.label })).toHaveCount(0);
  await expect(table.getByRole("button", { name: PROVIDERS.verbs.approveFor.label })).toHaveCount(0);
  await expect(table.getByRole("button", { name: "Set up" })).toBeVisible();
  await expect(table.getByText("needs-key")).toBeVisible();
});

test("a_sign_in_provider_keeps_both_verbs_and_the_screen_says_what_it_costs", async ({ mount }) => {
  // W7-D2: no key is held, but the broker opens that session, so the row is not
  // excluded — both verbs stay — and what the screen owes instead is the one
  // honesty line about where the request goes.
  const table = await mount(<ModelProviders signIn />);
  // The scale tag itself, which is a link into *How this works* and reads
  // accent rather than warn — nothing here is wrong.
  await expect(table.getByRole("link", { name: "sign-in" })).toBeVisible();
  await expect(table.getByText(PROVIDERS_TEXT.signInNote).first()).toBeVisible();
  await expect(table.getByText(PROVIDERS_TEXT.signInReach)).toBeVisible();
  await expect(table.getByRole("button", { name: PROVIDERS.verbs.setRouting.label })).toBeVisible();
  await expect(table.getByRole("button", { name: PROVIDERS.verbs.approveFor.label })).toBeVisible();
  // Not the keyless sentence, and not the first-run one it replaces.
  await expect(table.getByText(PROVIDERS_TEXT.needsKeyNote)).toHaveCount(0);
  await expect(table.getByText(PROVIDERS_TEXT.firstRun.model)).toHaveCount(0);
  // A key is still what routes it through the harness, so *Set up* stays.
  await expect(table.getByRole("button", { name: "Set up" })).toBeVisible();
});

test("routing_by_team_toggle_reads_the_same_data", async ({ mount }) => {
  const table = await mount(<ModelProviders connected />);
  await expect(table.getByRole("table")).toContainText("anthropic");
  await table.getByRole("radio", { name: PROVIDERS_TEXT.views.byTeam }).click();
  // The old matrix, as a read view: one row per team, with what it resolves to.
  await expect(table.getByText(PROVIDERS_TEXT.byTeamNote)).toBeVisible();
  await expect(table.getByRole("table")).toContainText(PROVIDERS_TEXT.resolved);
  await expect(table.getByRole("button", { name: PROVIDERS.verbs.setRouting.label }))
    .toHaveCount(0);
  await table.getByRole("radio", { name: PROVIDERS_TEXT.views.rows }).click();
  await expect(table.getByRole("button", { name: PROVIDERS.verbs.setRouting.label }))
    .toBeVisible();
});

test("team_admin_sets_its_own_team_and_holds_no_other_verb", async ({ mount, page }) => {
  const sent = await records(page);
  const table = await mount(<ModelProviders connected team />);

  // D42: the subject is the team's own, so there is no dimension to pick and no
  // refusal to draw; *Approve for…* and *Delete* are an org admin's (P13).
  await expect(table.getByRole("button", { name: PROVIDERS.verbs.approveFor.label }))
    .toHaveCount(0);
  await expect(table.getByRole("button", { name: PROVIDERS.verbs.deleteModelProvider.label }))
    .toHaveCount(0);
  await table.getByRole("button", { name: PROVIDERS.verbs.setRouting.label }).click();
  const modal = table.getByRole("dialog");
  await expect(modal.getByRole("combobox", { name: PROVIDERS_TEXT.pickDimension })).toHaveCount(0);
  await expect(modal.getByRole("combobox", { name: PROVIDERS_TEXT.pickSubject }))
    .toContainText("Marketing");
  await modal.getByRole("button", { name: PROVIDERS_TEXT.setDefaultSubmit }).click();

  await expect.poll(() => sent).toEqual([
    {
      method: "PUT",
      path: "/v1/routing",
      body: {
        defaultFor: { ...HELD.defaultFor, teams: { acme: "anthropic", "acme.marketing": "anthropic" } },
        approvedFor: { teams: { acme: ["anthropic"], "acme.marketing": ["anthropic"] }, harnesses: {}, providers: {} },
      },
    },
  ]);
});
