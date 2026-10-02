import { expect, test } from "@playwright/experimental-ct-react";
import { RemoveBoundary } from "@/app/(console)/console/[scope]/boundaries/_remove";
import { BOUNDARIES_TEXT } from "@/content/screens/boundaries";
import { records } from "./writes";

test("remove_boundary_deletes", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<RemoveBoundary boundaryId="b-7f2c11a4" />);

  await page.getByRole("button", { name: BOUNDARIES_TEXT.removeVerb }).click();
  await expect(page.locator("[data-confirm-takes]")).toContainText(BOUNDARIES_TEXT.removeTakes);
  await page.getByRole("button", { name: BOUNDARIES_TEXT.removeVerb }).last().click();

  await expect.poll(() => sent).toEqual([
    { method: "DELETE", path: "/v1/boundaries/b-7f2c11a4", body: undefined },
  ]);
});
