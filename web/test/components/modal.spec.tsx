import { expect, test } from "@playwright/experimental-ct-react";
import { Modal } from "@/app/(console)/ui/modal";
import { Field } from "@/app/(console)/ui/field";

test("modal_traps_and_restores_focus", async ({ mount, page }) => {
  let closed = false;
  const component = await mount(
    <Modal title="Narrow a group" onClose={() => (closed = true)}>
      <Field label="Sub-team" name="team" />
    </Modal>,
  );
  await expect(component).toBeVisible();
  const close = component.getByRole("button", { name: "Close" });
  await close.focus();
  await page.keyboard.press("Tab");
  await expect(component.locator("input")).toBeFocused();
  // The dialog is in the top layer, so Tab cycles back round to the first
  // control rather than leaving for anything behind it.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect.poll(() => closed).toBe(true);
});
