import { expect, test } from "@playwright/experimental-ct-react";
import { EntityHeader } from "@/app/(console)/ui/entity-header";

/**
 * The object a detail screen is showing, as its first block of content
 * (01 §7.5, D99) — never a header row and never the page's name.
 */

const FACTS = [
  { label: "Runtime", value: "pi 0.4.2" },
  { label: "Model", value: "claude-opus-5" },
  { label: "Files", value: "5" },
  { label: "Preflight", value: "passing" },
  { label: "Sessions", value: "4" },
  { label: "Owner", value: "Corby Furrer" },
];

const LONG = "campaign-brief-writer-with-a-very-long-unbroken-name";

test("entity_header_name_wraps_at_800", async ({ mount, page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  const block = await mount(
    <EntityHeader
      name={LONG}
      facts={FACTS}
      mark={<span data-mark style={{ display: "block", width: 56, height: 56 }} />}
    />,
  );

  const title = block.locator("h2");
  await expect(title).toBeVisible();
  // The name has somewhere to wrap to: the word breaks rather than running
  // under the facts grid (the 800px overlap the screens agent found).
  await expect(title).toHaveCSS("overflow-wrap", "break-word");

  const titleBox = (await title.boundingBox())!;
  const factsBox = (await block.locator("dl").boundingBox())!;
  // Below 960 the blocks stack, so the grid starts under the name.
  expect(factsBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
  expect(titleBox.width).toBeLessThanOrEqual(800);
});

test("entity_header_facts_sit_beside_the_name_above_960", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  const block = await mount(<EntityHeader name="Campaign drafts" facts={FACTS} />);
  const title = (await block.locator("h2").boundingBox())!;
  const facts = (await block.locator("dl").boundingBox())!;
  expect(facts.x).toBeGreaterThan(title.x);
  expect(facts.y).toBeLessThan(title.y + title.height);
});

test("entity_header_mark_is_at_the_start_of_the_name", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  const block = await mount(
    <EntityHeader name="Campaign drafts" mark={<span data-mark>drawing</span>} facts={FACTS} />,
  );
  const mark = (await block.locator("[data-mark]").boundingBox())!;
  const title = (await block.locator("h2").boundingBox())!;
  // PRD §17.1: the drawing is top-left, before the name, not in the actions.
  expect(mark.x).toBeLessThan(title.x);
});

test("entity_header_name_is_not_the_pages_h1", async ({ mount }) => {
  // D99: the document's one `h1` is the section in the top bar; a harness is
  // a thing on the Harnesses screen, not a screen of its own.
  const block = await mount(<EntityHeader name="Campaign drafts" facts={FACTS} />);
  await expect(block.locator("h1")).toHaveCount(0);
  await expect(block.getByRole("heading", { name: "Campaign drafts", level: 2 })).toBeVisible();
});
