import { expect, test } from "@playwright/experimental-ct-react";
import { Segmented } from "@/app/(console)/ui/segmented";

const OPTIONS = [
  { id: "files", label: "Files" },
  { id: "history", label: "History" },
  { id: "requests", label: "Requests" },
];

test("segmented_is_a_radiogroup", async ({ mount, page }) => {
  let value = "files";
  const group = await mount(
    <Segmented options={OPTIONS} value="files" label="Panel" onChange={(id) => (value = id)} />,
  );
  await expect(group).toHaveAttribute("role", "radiogroup");
  await expect(group).toHaveAttribute("aria-label", "Panel");
  const files = page.getByRole("radio", { name: "Files" });
  await expect(files).toHaveAttribute("aria-checked", "true");
  await files.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => value).toBe("history");
  await page.getByRole("radio", { name: "Requests" }).click();
  await expect.poll(() => value).toBe("requests");
});
