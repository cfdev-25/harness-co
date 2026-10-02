import { expect, test } from "@playwright/experimental-ct-react";
import { Import } from "@/app/(console)/console/[scope]/harnesses/_import";
import { SETUP_HREF } from "@/lib/views/account";
import { HARNESSES_WORDS as WORDS } from "@/content/screens/harnesses";

/**
 * *Import*, beside *New harness* (04 §4). It used to be a link to *Set up*,
 * which answered a question nobody had asked: the command runs on the
 * person's machine and reads what is already there, so what they need is the
 * line, not the install page. The dialog is where the line is.
 */

test("import_is_a_dialog_with_a_line_for_each_provider", async ({ mount, page }) => {
  await mount(<Import installed />);
  await page.getByRole("button", { name: WORDS.importLabel }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(WORDS.importLede);

  // Claude Code is the one in front; the block is the one command.
  await expect(dialog.locator("code")).toHaveText(WORDS.importCommands.claude);
  await expect(dialog.locator("[data-import-next]")).toContainText(WORDS.importThenSwitch);
  await expect(dialog.locator("[data-import-next]")).toContainText("harness run claude --<name>");

  // Pi is the other choice, and it swaps both the line and what it prints.
  await dialog.getByRole("radio", { name: WORDS.importProviders.pi }).click();
  await expect(dialog.locator("code")).toHaveText(WORDS.importCommands.pi);
  await expect(dialog.locator("[data-import-next]")).toContainText("harness run pi --<name>");

  // One block, one copy button — the follow-on lines are text, because they
  // carry the name of a harness that does not exist yet.
  await expect(dialog.getByRole("button", { name: "Copy" })).toHaveCount(1);
});

test("import_says_to_install_first_only_when_nothing_has_run_yet", async ({ mount, page }) => {
  const component = await mount(<Import installed={false} />);
  await page.getByRole("button", { name: WORDS.importLabel }).click();

  const first = page.getByRole("dialog").locator("[data-install-first]");
  await expect(first).toHaveText(WORDS.importInstallFirst);
  await expect(first).toHaveAttribute("href", SETUP_HREF);

  // And it is gone the moment the console has evidence of a machine.
  await component.update(<Import installed />);
  await expect(page.getByRole("dialog").locator("[data-install-first]")).toHaveCount(0);
});
