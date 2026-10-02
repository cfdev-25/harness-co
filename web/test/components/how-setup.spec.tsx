import { expect, test } from "@playwright/experimental-ct-react";
import { SetUp } from "@/app/(console)/console/how/_setup";
import { API_ORIGIN_PLACEHOLDER, INSTALL_COMMAND, TOKEN_PLACEHOLDER } from "@/lib/views/account";
import { HOW, HOW_SETUP } from "@/content/screens/how";

/**
 * *How this works* → *Set up* — console D105, 04 §16.1. Proved at the wire
 * like the other write specs (02 rule 30): the component calls the real
 * `lib/pat.ts` through the real `lib/api.ts`, and the route below records what
 * left the browser and answers what `routes_auth.create_pat` answers.
 */

const ORIGIN = "https://api.harness.example";

/** `routes_auth.create_pat`'s row, raw `token` and all. */
const CREATED = {
  id: "pat_1",
  name: "console setup 2026-10-02",
  expires_at: null,
  created_at: "2026-10-02T09:00:00Z",
  token: "hpat_0123456789abcdef",
};

test("setup_is_three_commands_and_a_token_slot", async ({ mount }) => {
  const component = await mount(<SetUp apiOrigin={ORIGIN} />);

  // One block per command, numbered, in the order they are pasted.
  await expect(component.locator("[data-setup-step]")).toHaveCount(3);
  await expect(component.locator("[data-setup-step='install']")).toContainText(INSTALL_COMMAND);
  await expect(component.locator("[data-setup-step='login']")).toContainText(
    `harness login --api-url ${ORIGIN} --token ${TOKEN_PLACEHOLDER}`,
  );
  await expect(component.locator("[data-setup-step='register']")).toContainText("harness setup");
  await expect(component.locator("[data-setup-step='install']")).toContainText(
    `1. ${HOW_SETUP.steps.install}`,
  );

  // Every block is copy-able, and the one line after them names a screen.
  await expect(component.getByRole("button", { name: "Copy" })).toHaveCount(3);
  await expect(component).toContainText(HOW_SETUP.then);

  // The token's slot is a button until it is pressed, and nothing claims a
  // token has been shown yet.
  await expect(
    component.locator("[data-setup-step='login']").getByRole("button", {
      name: HOW.verbs.generateToken.label,
    }),
  ).toHaveCount(1);
  await expect(component).not.toContainText(HOW_SETUP.tokenOnce);
});

test("setup_generates_a_token_and_writes_it_into_the_login_line_once", async ({ mount, page }) => {
  const sent: { method: string; body: unknown }[] = [];
  await page.route("**/v1/personal-access-tokens", async (route) => {
    sent.push({ method: route.request().method(), body: route.request().postDataJSON() });
    await route.fulfill({ status: 201, json: CREATED });
  });

  const component = await mount(<SetUp apiOrigin={ORIGIN} />);
  const login = component.locator("[data-setup-step='login']");
  await expect(login).not.toContainText("hpat_");

  await component.getByRole("button", { name: HOW.verbs.generateToken.label }).click();

  // One POST, named after what made it and the day it was made.
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].method).toBe("POST");
  expect((sent[0].body as { name: string }).name).toMatch(/^console setup \d{4}-\d{2}-\d{2}$/);

  // The raw value lands in the line the person pastes, whole.
  await expect(login).toContainText(
    `harness login --api-url ${ORIGIN} --token ${CREATED.token}`,
  );
  await expect(login).not.toContainText(TOKEN_PLACEHOLDER);

  // And it is said to be the only showing: the button is gone, the sentence is
  // there, and nothing offers to show it again (P2 — it is not stored).
  await expect(login).toContainText(HOW_SETUP.tokenOnce);
  await expect(
    component.getByRole("button", { name: HOW.verbs.generateToken.label }),
  ).toHaveCount(0);
});

test("setup_asks_for_an_origin_rather_than_printing_a_localhost", async ({ mount }) => {
  // A console deployed without `HARNESS_API_ORIGIN` prints a slot, not a host
  // the CLI would dial and reach the wrong machine (02 D23).
  const component = await mount(<SetUp apiOrigin={null} />);
  await expect(component.locator("[data-setup-step='login']")).toContainText(
    `--api-url ${API_ORIGIN_PLACEHOLDER}`,
  );
  await expect(component.locator("[data-setup-step='login']")).not.toContainText("localhost");
});

test("setup_shows_the_servers_refusal_beside_the_button", async ({ mount, page }) => {
  await page.route("**/v1/personal-access-tokens", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ code: "forbidden", message: "You may not mint a token here." }),
    });
  });

  const component = await mount(<SetUp apiOrigin={ORIGIN} />);
  await component.getByRole("button", { name: HOW.verbs.generateToken.label }).click();

  // The server's own words (02 rule 21), and the slot stays a slot.
  await expect(component).toContainText("You may not mint a token here.");
  await expect(component.locator("[data-setup-step='login']")).toContainText(TOKEN_PLACEHOLDER);
});
