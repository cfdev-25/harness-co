import { expect, test } from "@playwright/experimental-ct-react";
import { ConnectVault } from "@/app/(console)/console/[scope]/vaults/_connect";
import { RotateSecret } from "@/app/(console)/console/[scope]/vaults/[id]/_rotate";
import { VAULTS, VAULTS_TEXT, VAULT_CONNECT } from "@/content/screens/vaults";
import { records } from "./writes";

test("connect_vault_matches_vault_in", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<ConnectVault />);

  await page.getByRole("button", { name: VAULTS.verbs.connectVault.label }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("textbox", { name: VAULT_CONNECT.id }).fill("acme-aws");
  await modal.getByRole("textbox", { name: VAULT_CONNECT.auth }).fill("arn:aws:iam::1:role/harness");
  await modal.getByRole("button", { name: VAULT_CONNECT.submit }).click();

  // `VaultIn`: `id` is required, the flag is `lists_secrets`, `auth` is an
  // object — a bare string was dropped and the vault connected unusable.
  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/vaults",
      body: {
        id: "acme-aws",
        provider: "aws",
        auth: { method: "arn:aws:iam::1:role/harness" },
        lists_secrets: true,
      },
    },
  ]);
});

test("rotate_secret_posts", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<RotateSecret vaultId="bundled" secretRef="acme/crm-token" />);

  await page.getByRole("button", { name: VAULTS.verbs.rotate.label }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel(VAULTS_TEXT.rotateValue).fill("sk-new");
  await modal.getByRole("button", { name: VAULTS.verbs.rotate.label }).click();

  // `{secret_ref:path}` — a ref with slashes in it is the path's tail.
  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/vaults/bundled/secrets/acme/crm-token/rotate",
      body: { value: "sk-new" },
    },
  ]);
});
