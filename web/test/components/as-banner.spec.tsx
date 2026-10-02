import { expect, test } from "@playwright/experimental-ct-react";
import { AsBanner } from "@/app/(console)/shell/as-banner";
import { SHELL } from "@/content/shell";

/**
 * 02 rule 17: the `?as` strip belongs to the shell, and its sentence to
 * `content/shell.ts`. The client half reads `?as` from the router, which the
 * component rig does not have, so the V2 mounts the pure strip the shell
 * renders and asserts it says the shell's sentence and nothing of its own.
 */
test("as_banner_from_shell", async ({ mount }) => {
  const banner = await mount(
    <AsBanner name="Sam Ojo" href="/console/me/harnesses/h_1" />,
  );
  await expect(banner).toHaveAttribute("data-as-banner", "Sam Ojo");
  await expect(banner).toContainText("Reading Sam Ojo's branch");
  await expect(banner).toContainText("they have not offered these");
  await expect(banner.getByRole("link", { name: SHELL.as.leave })).toHaveAttribute(
    "href",
    "/console/me/harnesses/h_1",
  );
  // The sentence is the content module's, filled — no placeholder survives.
  await expect(banner.locator("p")).not.toContainText("{");
});
