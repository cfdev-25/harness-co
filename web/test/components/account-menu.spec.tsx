import { expect, test } from "@playwright/experimental-ct-react";
import { AccountMenu } from "@/app/(console)/shell/account-menu";
import { VIEWER } from "./fixtures";

test("account_menu_is_a_menu", async ({ mount, page }) => {
  const component = await mount(<AccountMenu viewer={VIEWER} />);
  const button = component.getByRole("button", { name: VIEWER.user.name });
  await expect(button).toHaveAttribute("aria-haspopup", "menu");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const items = component.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(component.getByRole("menu")).toHaveCount(0);
  await expect(button).toBeFocused();
});
