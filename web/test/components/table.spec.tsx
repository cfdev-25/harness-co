import { expect, test } from "@playwright/experimental-ct-react";
import { Table } from "@/app/(console)/ui/table";
import { CHANGED, COLUMNS, ROWS, type Row } from "./fixtures";
import { RenderedTable } from "./rendered-table";

const props = {
  columns: COLUMNS,
  rows: ROWS,
  rowKey: (row: Row) => row.name,
  rowHref: (row: Row) => `/console/org/harnesses/${row.name}`,
  empty: "No harnesses yet.",
};

test("table_keyboard_row_navigation", async ({ mount, page }) => {
  const table = await mount(<Table<Row> {...props} />);
  const rows = table.locator("tbody tr");
  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(rows.nth(2)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(rows.nth(0)).toBeFocused();
  // The row is one link, in the first cell, and Enter activates it (P1).
  // `next/link` resolves its `href` against the router, which the component
  // rig has none of, so the assertion is that Enter clicks that link.
  const first = rows.first().locator("td").first().locator("a");
  await expect(first).toHaveCount(1);
  await first.evaluate((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      node.setAttribute("data-activated", "yes");
    });
  });
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("data-activated", "yes");
});

test("table_empty_cells_render_dash", async ({ mount }) => {
  const table = await mount(<Table<Row> {...props} />);
  await expect(table.locator("tbody tr").nth(1).locator("td").nth(2)).toHaveText("—");
});

test("table_chip_cell", async ({ mount }) => {
  const table = await mount(<Table<Row> {...props} />);
  // `kind: "chip"` is a bordered mono value (01 §7), not a `Fact` smuggled
  // through `kind: "fact"`, and not a bare string.
  const alias = table.locator("tbody tr").first().locator("td").nth(3);
  await expect(alias).toHaveText("anthropic-api-key");
  const chip = alias.locator("span");
  await expect(chip).toHaveCount(1);
  // A `Chip` is the bordered mono value (01 §7); the rig has no `next/font`,
  // so the family is asserted from the class and the border from the box.
  await expect(chip).toHaveClass(/font-mono/);
  await expect(chip).toHaveCSS("border-top-style", "solid");
  await expect(chip).toHaveCSS("border-top-width", "1px");
});

test("table_time_cell_relative_with_title", async ({ mount }) => {
  const table = await mount(<Table<Row> {...props} />);
  const when = table.locator("tbody tr").first().locator("td").nth(4).locator("time");
  await expect(when).toHaveCount(1);
  // Relative in the cell, absolute on hover, the instant machine-readable.
  await expect(when).toHaveAttribute("datetime", CHANGED);
  await expect(when).toHaveAttribute("title", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
  await expect(when).toHaveText("12 minutes ago");
  await expect(when).not.toHaveText(CHANGED);
});

test("table_row_href_from_a_template", async ({ mount }) => {
  // A template and a key instead of two functions, so a server `page.tsx`
  // can render the table without a client wrapper.
  const table = await mount(
    <Table<Row>
      columns={COLUMNS}
      rows={ROWS}
      rowKey="id"
      rowHref="/console/org/harnesses/{id}"
      empty="No harnesses yet."
    />,
  );
  await expect(table.locator("tbody tr").first().locator("a").first()).toHaveAttribute(
    "href",
    "/console/org/harnesses/h_1",
  );
});

test("table_render_escape_hatch", async ({ mount }) => {
  const table = await mount(<RenderedTable />);
  await expect(table.locator("[data-rendered]").first()).toHaveText("3 files");
  await expect(table.locator("[data-rendered]").nth(1)).toHaveText("none");
});
