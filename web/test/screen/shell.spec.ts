import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The shell's three named tests (01 §13). They live in the `screen` project
 * rather than `component` because `shell/shell.tsx` imports `shell.css` — the
 * grid's numbers — and the component rig builds without the project's
 * PostCSS, so a mounted shell would have no grid to measure.
 */
const ROUTE = "/console/me/harnesses";

/** A screen body taller than any window, added at runtime (01 §13). */
async function makeTall(page: Page) {
  // Appending before hydration finishes races React's commit and drops the node — wait for the shell to settle.
  await page.waitForLoadState("networkidle");
  await page.locator("main").waitFor();
  await page.evaluate(() => {
    const tall = document.createElement("div");
    tall.style.height = "4000px";
    tall.setAttribute("data-tall", "");
    document.querySelector("main#content .screen .body")?.appendChild(tall);
  });
}

for (const width of [1440, 1100, 800]) {
  test(`shell_only_content_scrolls @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto(ROUTE);
    await expect(page.locator("main#content")).toBeVisible();
    await makeTall(page);

    const page_ = await page.evaluate(() => ({
      scrollHeight: document.scrollingElement!.scrollHeight,
      clientHeight: document.scrollingElement!.clientHeight,
    }));
    expect(page_.scrollHeight).toBe(page_.clientHeight);

    const main = await page.evaluate(() => {
      const element = document.querySelector("main#content")!;
      return { scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
    });
    expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);

    await page.evaluate(() => document.querySelector("main#content")!.scrollBy(0, 1200));
    expect(await page.evaluate(() => document.querySelector("main#content")!.scrollTop)).toBeGreaterThan(0);
    const header = await page.locator("header").first().boundingBox();
    expect(header?.y).toBe(0);
    const after = await page.evaluate(() => document.scrollingElement!.scrollTop);
    expect(after).toBe(0);
  });
}

test("shell_rail_is_144_and_the_content_starts_beside_it", async ({ page }) => {
  // 01 §4.4, D99's third pass: the rail is half what it was, so a row that
  // does not fit truncates and the content gets the width back.
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(ROUTE);
  await expect(page.locator("main#content")).toBeVisible();
  const rail = (await page.locator(".shell > nav").boundingBox())!;
  const main = (await page.locator("main#content").boundingBox())!;
  expect(Math.round(rail.width)).toBe(144);
  expect(Math.round(main.x)).toBe(144);
});

test("shell_sub_header_sticks_under_header", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(ROUTE);
  await makeTall(page);
  await page.evaluate(() => document.querySelector("main#content")!.scrollBy(0, 900));
  const tops = await page.evaluate(() => {
    const main = document.querySelector("main#content")!.getBoundingClientRect().top;
    const sub = document.querySelector("main#content .screen > .sub")!.getBoundingClientRect().top;
    return { main: Math.round(main), sub: Math.round(sub) };
  });
  expect(tops.sub).toBe(tops.main);
});

test("shell_drawer_traps_focus", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto(ROUTE);
  const opener = page.getByRole("button", { name: "Navigation" });
  await expect(opener).toBeVisible();
  await opener.click();
  const drawer = page.locator("dialog[data-drawer]");
  await expect(drawer).toBeVisible();
  expect(await page.evaluate(() => document.querySelector("dialog[data-drawer]")!.matches(":modal"))).toBe(true);

  const inside = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[data-drawer]")!;
    return dialog.querySelectorAll("a").length;
  });
  expect(inside).toBeGreaterThan(0);
  for (let step = 0; step < inside + 2; step += 1) {
    await page.keyboard.press("Tab");
    const outside = await page.evaluate(() => {
      const active = document.activeElement;
      const dialog = document.querySelector("dialog[data-drawer]")!;
      return active !== null && active !== document.body && !dialog.contains(active);
    });
    expect(outside).toBe(false);
  }
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
});
