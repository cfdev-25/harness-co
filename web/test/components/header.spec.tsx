import { expect, test } from "@playwright/experimental-ct-react";
import { Header } from "@/app/(console)/shell/header";
import { ADMIN } from "./fixtures";

/** 01 §4.3: *Harness › Assets* on the left, the controls on the right. */
const TEAM = { kind: "team" as const, path: "acme.marketing" };

test("header_is_one_breadcrumb_then_the_controls", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  const header = await mount(<Header scope={TEAM} viewer={ADMIN} />);
  const brand = (await header.getByRole("link", { name: "Harness" }).boundingBox())!;
  const section = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
  const switcher = (await header.getByRole("button", { name: /Marketing/ }).boundingBox())!;
  const account = (await header.getByRole("button", { name: /Jo Adeyemi|Account/ }).boundingBox())!;

  // Left to right, on one line: brand, the screen's name, then the level
  // switcher beside the palette and the account menu.
  expect(section.x).toBeGreaterThan(brand.x + brand.width - 1);
  expect(switcher.x).toBeGreaterThan(section.x + section.width - 1);
  expect(account.x).toBeGreaterThan(switcher.x);
  for (const box of [section, switcher, account]) {
    expect(Math.abs(box.y - brand.y)).toBeLessThan(brand.height);
  }
});

test("header_separates_the_brand_from_the_screen_with_a_muted_chevron", async ({ mount, page }) => {
  await mount(<Header scope={TEAM} viewer={ADMIN} />);
  // Decoration, so it is `aria-hidden` and the breadcrumb reads as two
  // things to a screen reader, not three.
  const chevron = page.locator("header span[aria-hidden]", { hasText: "›" }).first();
  await expect(chevron).toBeVisible();
  const [mark, name] = await page.evaluate(() => {
    const node = [...document.querySelectorAll("header span[aria-hidden]")].find(
      (span) => span.textContent === "›",
    )!;
    return [getComputedStyle(node).color, getComputedStyle(document.querySelector("h1")!).color];
  });
  // Muted: the separator is quieter than the two words it separates.
  expect(mark).not.toBe(name);
});
