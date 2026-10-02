import { expect, test } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import { HelpMark } from "@/app/(console)/ui/help-mark";
import { BottomMark, MarkInDialog, WideTable } from "./tip-story";

const LAST_HELP =
  "Lets this host through at the level that refused it, from the next session on.";
const BOTTOM_HELP =
  "A help mark at the very bottom of the viewport, whose bubble has nowhere to go below it.";

/** The bubble's box and the viewport it has to stay inside. */
async function boxes(page: Page) {
  return page.evaluate(() => {
    const tip = document.querySelector('[role="tooltip"]');
    if (!tip) throw new Error("no tooltip");
    const box = tip.getBoundingClientRect();
    return {
      left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      width: box.width, height: box.height,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      parent: tip.parentElement?.tagName ?? "",
    };
  });
}

test("tip_in_the_last_column_opens_inside_the_viewport", async ({ mount, page }) => {
  await mount(<WideTable help={LAST_HELP} />);
  // The table is wider than the rig; scroll it so the last heading's `(?)`
  // is against the right edge, which is the case that used to fail.
  const mark = page.locator("thead th").last().getByRole("button");
  await mark.scrollIntoViewIfNeeded();
  await mark.hover();

  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(LAST_HELP);

  const box = await boxes(page);
  const trigger = (await mark.boundingBox())!;
  // This is the worst case and not a table that happens to fit: left-aligned
  // with its trigger — what the bubble did before W6-D94 — it would run off
  // the right edge.
  expect(trigger.x + box.width).toBeGreaterThan(box.innerWidth);
  // Drawn at the body, not in the `<th>`, so no `overflow` ancestor clips it.
  expect(box.parent).toBe("BODY");
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(box.innerWidth);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(box.innerHeight);
  // Up to 20rem and wrapping, so the whole sentence is readable.
  expect(box.width).toBeLessThanOrEqual(320);
  expect(box.height).toBeGreaterThan(20);
});

test("tip_at_the_bottom_opens_above_its_trigger", async ({ mount, page }) => {
  await mount(<BottomMark help={BOTTOM_HELP} />);
  const mark = page.getByRole("button", { name: BOTTOM_HELP });
  await mark.hover();

  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  const box = await boxes(page);
  const trigger = (await mark.boundingBox())!;
  expect(box.bottom).toBeLessThanOrEqual(trigger.y);
  expect(box.bottom).toBeLessThanOrEqual(box.innerHeight);
  expect(box.top).toBeGreaterThanOrEqual(0);
});

test("tip_opens_on_focus_and_escape_closes_it", async ({ mount, page }) => {
  const component = await mount(<HelpMark text={LAST_HELP} />);
  const mark = component.getByRole("button");
  await mark.focus();

  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  // The accessibility contract (01 §11) survives the portal.
  await expect(mark).toHaveAttribute("aria-describedby", (await tip.getAttribute("id")) ?? "");
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  await expect(mark).not.toHaveAttribute("aria-describedby", /.+/);
});

test("tip_inside_a_dialog_goes_to_the_dialog", async ({ mount, page }) => {
  // A modal is in the top layer; a bubble at the body would paint under its
  // backdrop, so the portal's container is the dialog the trigger is in.
  await mount(<MarkInDialog help={LAST_HELP} />);
  await page.getByRole("button", { name: LAST_HELP }).hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  const box = await boxes(page);
  const trigger = (await page.getByRole("button", { name: LAST_HELP }).boundingBox())!;
  expect(box.parent).toBe("DIALOG");
  // `position: fixed` inside the top layer still resolves against the
  // viewport, so the bubble sits below its trigger and not at the dialog.
  expect(box.top).toBeGreaterThanOrEqual(trigger.y + trigger.height);
  expect(box.right).toBeLessThanOrEqual(box.innerWidth);
  expect(box.bottom).toBeLessThanOrEqual(box.innerHeight);
});
