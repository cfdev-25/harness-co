import { expect, test } from "@playwright/experimental-ct-react";
import { CreateGroup } from "@/app/(console)/console/[scope]/groups/_create";
import { RevokeGrant } from "@/app/(console)/console/[scope]/groups/_revoke";
import { ChangeSources } from "@/app/(console)/console/[scope]/groups/[name]/_sources";
import { AddEntry, RemoveEntry } from "@/app/(console)/console/[scope]/groups/[name]/_verbs";
import { GROUPS, GROUPS_TEXT } from "@/content/screens/groups";
import { records } from "./writes";

test("group_create_sends_entries", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<CreateGroup />);

  await page.getByRole("button", { name: GROUPS.verbs.createGroup.label }).click();
  await page.getByLabel(GROUPS_TEXT.createGroupName).fill("crm");
  await page.getByRole("button", { name: GROUPS_TEXT.createGroupSubmit }).click();

  // `GroupIn.entries` has no default, so a body without it never reaches the
  // handler. An empty one is accepted: the first entry comes after (04 §8).
  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/groups",
      body: { name: "crm", sources: "vault", entries: [] },
    },
  ]);
});

test("revoke_grant_deletes", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<RevokeGrant grantId="g-1" aliases={["crm-token"]} />);

  await page.getByRole("button", { name: GROUPS.verbs.revokeGrant.label }).click();
  // 02 rule 22: the confirmation is the preview of what stops resolving.
  await expect(page.locator("[data-confirm-takes]")).toContainText("crm-token");
  await page.getByRole("button", { name: GROUPS_TEXT.revokeVerb }).last().click();

  await expect.poll(() => sent).toEqual([
    { method: "DELETE", path: "/v1/grants/g-1", body: undefined },
  ]);
});

test("group_patch_sources", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<ChangeSources name="crm" sources="vault" />);

  await page.getByRole("button", { name: GROUPS.verbs.changeSources.label }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("combobox", { name: GROUPS_TEXT.createGroupSources }).selectOption("vault-or-local");
  await modal.getByRole("button", { name: GROUPS.verbs.changeSources.label }).click();

  // The name is the key, so it is in the path and never in the body.
  await expect.poll(() => sent).toEqual([
    { method: "PATCH", path: "/v1/groups/crm", body: { sources: "vault-or-local" } },
  ]);
});

/** What `/v1/console/groups/{name}` hands back, verbatim (03 §4.5). */
const HELD = [
  {
    alias: "anthropic-api-key",
    secret: { vault: "bundled", ref: "secret://acme/anthropic" },
    upstream: "https://api.anthropic.com",
    attach: { header: "Authorization", prefix: "Bearer " },
  },
];

test("group_add_entry_patches_full_list", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<AddEntry name="crm" entries={HELD} vaults={["aws", "bundled"]} />);

  await page.getByRole("button", { name: GROUPS.verbs.addEntry.label }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel(GROUPS_TEXT.addEntryAlias).fill("crm-token");
  await modal.getByLabel(GROUPS_TEXT.addEntryRef).fill("secret://acme/crm");
  await modal.getByLabel(GROUPS_TEXT.addEntryUpstream).fill("https://crm.example.com/v1");
  await modal.getByRole("button", { name: GROUPS_TEXT.addEntrySubmit }).click();

  // `validate_group`: an entry names the *origin* it is used at. A path is
  // refused here rather than sent for the server to refuse.
  await expect(modal.getByText(GROUPS_TEXT.addEntryUpstreamOrigin)).toBeVisible();
  expect(sent).toEqual([]);

  await modal.getByLabel(GROUPS_TEXT.addEntryUpstream).fill("https://crm.example.com");
  await modal.getByRole("button", { name: GROUPS_TEXT.addEntrySubmit }).click();

  // A PATCH replaces the whole list, so the held entry goes back untouched
  // and the new one is appended — the vault defaults to the bundled one.
  await expect.poll(() => sent).toEqual([
    {
      method: "PATCH",
      path: "/v1/groups/crm",
      body: {
        entries: [
          ...HELD,
          {
            alias: "crm-token",
            secret: { vault: "bundled", ref: "secret://acme/crm" },
            upstream: "https://crm.example.com",
            attach: { header: "Authorization", prefix: "Bearer " },
          },
        ],
      },
    },
  ]);
});

test("group_remove_entry_patches_without_it", async ({ mount, page }) => {
  const sent = await records(page);
  const second = {
    alias: "crm-token",
    secret: { vault: "bundled", ref: "secret://acme/crm" },
    upstream: "https://crm.example.com",
    attach: { header: "Authorization", prefix: "Bearer " },
  };
  await mount(
    <RemoveEntry name="crm" entries={[...HELD, second]} index={0} alias="anthropic-api-key" />,
  );

  await page.getByRole("button", { name: GROUPS.verbs.removeEntry.label }).first().click();
  await expect(page.locator("[data-confirm-takes]")).toContainText("anthropic-api-key");
  await page.getByRole("button", { name: GROUPS.verbs.removeEntry.label }).last().click();

  await expect.poll(() => sent).toEqual([
    { method: "PATCH", path: "/v1/groups/crm", body: { entries: [second] } },
  ]);
});
