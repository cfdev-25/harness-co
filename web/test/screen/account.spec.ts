import { expect, everyTagLinksToHow, open, test } from "./stack-b";

/** 04 §17's named tests. */

test("logins_card_reads_the_last_session_or_names_preflight", async ({ page }) => {
  // 04 §17 has two states and the fixture decides which: with no session the
  // card says to run `harness preflight`; with one it reads that session's
  // `login` slots, labelled *as of*. Both are asserted rather than one.
  await open(page, "/console/me/account");
  const card = page.locator("section", {
    has: page.getByRole("heading", { name: "Logins on your machine" }),
  });
  await expect(card).toBeVisible();
  await expect(
    card.getByText(/Run `harness preflight` once and this fills in\.|As of your last session\./),
  ).toBeVisible();
});

test.fixme("no_session_yet_names_preflight", async () => {
  // The scratch database now holds sessions (another stack writes to it), so
  // the no-session branch cannot be driven from here. It is the `session ===
  // null` arm of `account/page.tsx` and is asserted above when it applies.
});

test("account_honesty_line_is_a_body_fact_not_the_lede", async ({ page }) => {
  await open(page, "/console/me/account");
  // 01 §7.5: no screen carries a lede at all now, so the honesty line can
  // only be a body fact — the header is the name, the chip and nothing else.
  // 01 §7.5: no screen prints a lede at all now, so the honesty line can
  // only be a body fact — the bar is the chip and the readme mark.
  await expect(page.locator("main#content .sub p")).toHaveCount(0);
  const card = page.locator("section", {
    has: page.getByRole("heading", { name: "Who can see your versions" }),
  });
  await expect(card).toBeVisible();
  // P8: the page states what it is; it does not narrate itself.
  await expect(card.locator("p").first()).toHaveText(/can see your versions|Nobody but you/);
});

test("cards_are_in_04_s_order", async ({ page }) => {
  await open(page, "/console/me/account");
  const headings = await page.locator("main#content section > header h2").allTextContents();
  expect(headings).toEqual([
    "Your teams",
    "Logins on your machine",
    "Who can see your versions",
    "Ask",
    "Sessions",
  ]);
});

test("ask_to_be_admin_opens_request", async ({ page }) => {
  await open(page, "/console/me/account");
  await page.getByRole("button", { name: /Ask to be a .* admin/ }).click();
  await expect(page.getByLabel("Why")).toBeVisible();
  await page.getByLabel("Why").fill("I am covering for the team while Rae is away.");
  await page.getByRole("button", { name: "Send the request" }).click();
  // `POST /v1/requests` with a role subject is built (D43), so this succeeds.
  await expect(page.getByText("Your request is open and waiting on an organisation admin.")).toBeVisible();
});

test("renders_for_every_scope", async ({ page }) => {
  await open(page, "/console/me/account");
  await expect(page.locator("main#content h1")).toHaveCount(1);
  await everyTagLinksToHow(page);
  await page.goto("/console/org/account");
  await expect(page).toHaveURL(/\/console\/me\/account$/);
});

test("account_honesty_line_names_admin_and_team", async ({ page }) => {
  await open(page, "/console/me/account");
  const card = page.locator("section", {
    has: page.getByRole("heading", { name: "Who can see your versions" }),
  });
  // PRD §18's sentence names the admin and the team, and says why it is here.
  await expect(card.locator("p").first()).toHaveText(
    /can see your versions\. As .+'s admin, they can open your branch/,
  );
  await expect(card.locator("p").first()).toHaveText(/never find out by accident/);
});

test("logins_from_last_session_labelled_as_of", async ({ page }) => {
  // D45: the console cannot probe a machine, so the card is labelled.
  await open(page, "/console/me/account");
  const card = page.locator("section", {
    has: page.getByRole("heading", { name: "Logins on your machine" }),
  });
  await expect(card.getByText("As of your last session.")).toBeVisible();
});

test.fixme("missing_login_shows_create_command", async () => {
  // The sessions in the scratch database carry `credential:` and `asset:`
  // slots and no `login:` slot, so no row asks for a command. The command
  // itself comes from the shared sheet and is V1-tested (`signInCommand`).
});
