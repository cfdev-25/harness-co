import { expect, test } from "@playwright/experimental-ct-react";
import { PixelEditor } from "@/app/(console)/ui/pixel-editor";
import type { PixelIcon } from "@/lib/views/types";

/** `SIZE` is 16 and `SWATCHES[4]` is the default swatch (01 §7.13). */
const BLANK: PixelIcon = { palette: [], rows: Array<string>(16).fill(".".repeat(16)) };
const DEFAULT_SWATCH = "#e6eaf0";

test("pixel_editor_paints_by_keyboard", async ({ mount, page }) => {
  let icon: PixelIcon = BLANK;
  const editor = await mount(
    <PixelEditor
      value={BLANK}
      onChange={(next) => (icon = next)}
      eraseLabel="Erase"
      clearLabel="Clear"
    />,
  );
  await editor.locator("[data-cell='0']").focus();
  await page.keyboard.press("Space");
  await expect.poll(() => icon.palette).toEqual([DEFAULT_SWATCH]);
  await expect.poll(() => icon.rows[0][0]).toBe("0");
});
