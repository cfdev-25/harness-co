import { expect, test } from "@playwright/experimental-ct-react";
import { CreateToken } from "@/app/(console)/console/[scope]/account/_token";
import { ACCOUNT, ACCOUNT_TEXT } from "@/content/screens/account";

test("account_create_token_shows_once", async ({ mount, page }) => {
  const bodies: unknown[] = [];
  await page.route("**/v1/personal-access-tokens", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      json: { id: "pat_1", name: "Laptop", expires_at: null, created_at: "2026-09-26T09:00:00Z",
              token: "hpat_0123456789abcdef" },
    });
  });
  const component = await mount(<CreateToken />);
  await component.getByRole("button", { name: ACCOUNT.verbs.createToken.label }).click();
  const modal = component.getByRole("dialog");
  await modal.getByLabel(ACCOUNT_TEXT.tokenName).fill("Laptop");
  await modal.getByRole("button", { name: ACCOUNT_TEXT.tokenSubmit }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toEqual({ name: "Laptop" });
  // The raw value is in the response and nowhere else, so the card says so and
  // shows the command it is for (engine 08 §11.14, D40).
  const shown = component.locator("[data-token]");
  await expect(shown).toContainText("hpat_0123456789abcdef");
  await expect(shown).toContainText(ACCOUNT_TEXT.tokenOnce);
  await expect(shown).toContainText("harness login");
  await expect(component.getByRole("dialog")).toHaveCount(0);
});
