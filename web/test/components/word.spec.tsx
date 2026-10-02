import { expect, test } from "@playwright/experimental-ct-react";
import { WORDS } from "@/content/words";
import { Word } from "@/app/(console)/ui/word";

test("word_opens_on_focus", async ({ mount, page }) => {
  const component = await mount(<Word term="boundary">boundary</Word>);
  const trigger = component.getByRole("button");
  await trigger.focus();
  // The bubble is a portal at the body (W6-D94), so it is on the page and
  // not inside the mounted component.
  const tip = page.getByRole("tooltip");
  await expect(tip).toHaveText(WORDS.boundary.short);
  await expect(trigger).toHaveAttribute("aria-describedby", await tip.getAttribute("id") ?? "");
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
});
