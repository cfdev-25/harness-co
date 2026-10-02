import { expect, test } from "@playwright/experimental-ct-react";
import { Confirm } from "@/app/(console)/ui/confirm";

test("confirm_lists_what_it_takes", async ({ mount }) => {
  const takes = (
    <ul>
      <li>Marketing writers</li>
      <li>anthropic-key</li>
    </ul>
  );
  const component = await mount(
    <Confirm
      title="Remove Jo Adeyemi"
      takes={takes}
      verb="Remove Jo Adeyemi"
      cancel="Cancel"
      onConfirm={() => {}}
      onClose={() => {}}
    />,
  );
  const list = component.locator("[data-confirm-takes]");
  await expect(list).toContainText("Marketing writers");
  await expect(list).toContainText("anthropic-key");
  const verb = component.getByRole("button", { name: "Remove Jo Adeyemi" });
  await expect(verb).toBeEnabled();
  const items = await list.locator("li").allInnerTexts();
  expect(items.length).toBeGreaterThan(0);
});

test("confirm_disabled", async ({ mount }) => {
  let confirmed = 0;
  const component = await mount(
    <Confirm
      title="Revoke session"
      takes={<p>The session&rsquo;s proxy will refuse every credential.</p>}
      verb="Revoke"
      cancel="Cancel"
      disabled
      onConfirm={() => {
        confirmed += 1;
      }}
      onClose={() => {}}
    />,
  );
  const verb = component.getByRole("button", { name: "Revoke" });
  // The verb waits on what the dialog itself shows — a reason not yet typed,
  // a preview still loading. It is never a refusal (P13, 01 §7.1).
  await expect(verb).toHaveAttribute("aria-disabled", "true");
  // Playwright treats `aria-disabled` as not actionable, so the event is
  // dispatched directly: the proof wanted is that no handler runs.
  await verb.dispatchEvent("click");
  expect(confirmed).toBe(0);
  // Cancel is always live, so the dialog is never a trap.
  await expect(component.getByRole("button", { name: "Cancel" })).not.toHaveAttribute(
    "aria-disabled",
    "true",
  );
});
