import { expect, test } from "@playwright/experimental-ct-react";
import { GettingStarted } from "@/app/(console)/console/[scope]/account/_getting-started";
import { SETUP_HREF, gettingStarted } from "@/lib/views/account";
import { GETTING_STARTED } from "@/content/screens/account";
import type { Viewer } from "@/lib/views/types";
import { VIEWER } from "./fixtures";

/**
 * W7-D5, 04 §17. The list is `gettingStarted(viewer)`'s and the component only
 * draws it, so the two halves are checked together: what the four rows say,
 * and that the list is absent when it has nothing to ask for.
 */

const PERSONAL: Viewer = {
  ...VIEWER,
  edition: "personal",
  role: { level: "org-admin", at: "jo" },
  teams: [],
  setup: { installed: false, loggedIn: false, model: null, harness: false },
};

const done = { installed: true, loggedIn: true, model: "key", harness: true } as const;

test("getting_started_is_four_rows_of_one_thing_each", async ({ mount }) => {
  const steps = gettingStarted(PERSONAL);
  expect(steps?.map((step) => step.key)).toEqual(["install", "login", "model", "harness"]);

  const component = await mount(<GettingStarted steps={steps ?? []} />);
  await expect(component.locator("[data-step]")).toHaveCount(4);
  // Nothing is done, so every row carries its one command or its one link and
  // no row carries both (W7-D5).
  await expect(component.locator("[data-check='done']")).toHaveCount(0);
  // The first two are links now, to the one place the commands are printed
  // with this deployment's API address and a token on them (console D105).
  // The row does not repeat a command it would then have to keep true.
  for (const key of ["install", "login"] as const) {
    const row = component.locator(`[data-step='${key}']`);
    await expect(row.getByRole("link", { name: GETTING_STARTED.steps[key].link })).toHaveAttribute(
      "href",
      SETUP_HREF,
    );
    await expect(row).not.toContainText("curl");
    await expect(row).not.toContainText("harness login");
  }
  await expect(
    component.locator("[data-step='model']").getByRole("link", { name: GETTING_STARTED.steps.model.link }),
  ).toHaveAttribute("href", "/console/me/providers/model");
  // The one row with a second way to close it (W7-D2).
  await expect(component.locator("[data-step='model']")).toContainText(
    GETTING_STARTED.steps.model.noteCommand,
  );
  await expect(
    component.locator("[data-step='harness']").getByRole("link", { name: GETTING_STARTED.steps.harness.link }),
  ).toHaveAttribute("href", "/console/me/harnesses");
});

test("getting_started_checks_what_is_done_and_asks_for_the_rest", async ({ mount }) => {
  const steps = gettingStarted({ ...PERSONAL, setup: { ...done, harness: false } });
  const component = await mount(<GettingStarted steps={steps ?? []} />);
  // A closed row is a check and the fact that closed it — no command, no link.
  await expect(component.locator("[data-check='done']")).toHaveCount(3);
  await expect(component.locator("[data-step='install']")).toContainText(
    GETTING_STARTED.steps.install.done,
  );
  await expect(component.locator("[data-step='install']").getByRole("link")).toHaveCount(0);
  await expect(component.locator("[data-step='model']")).toContainText(
    GETTING_STARTED.steps.model.done.key,
  );
  await expect(component.locator("[data-step='harness']").getByRole("link")).toHaveCount(1);
});

test("getting_started_hides_itself_when_all_four_are_done", () => {
  // The list is furniture once it is complete (P8), so the page draws nothing.
  expect(gettingStarted({ ...PERSONAL, setup: { ...done } })).toBeNull();
  expect(gettingStarted({ ...PERSONAL, setup: { ...done, model: "sign-in" } })).toBeNull();
});

test("getting_started_is_absent_for_an_enterprise_account", () => {
  // An enterprise first hour is an admin's: `harness setup` and the admin
  // guide own it, and a member's account page never had this list.
  expect(gettingStarted({ ...VIEWER, setup: { ...done, harness: false } })).toBeNull();
  expect(gettingStarted(VIEWER)).toBeNull();
});
