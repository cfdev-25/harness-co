import { expect, test } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import { SignUp } from "@/app/signup/signup";
import { SIGNUP } from "@/app/signup/words";
import type { AuthCall, AuthStub } from "./supabase.client";
import { records, refuses } from "./writes";

const CODE = "mcbreezy";
const CHOICE = "harness.signup";

/** The auth provider for one spec. Set before `mount()`; see the stub. */
async function auth(page: Page, stub: AuthStub) {
  await page.evaluate((value) => {
    window.__auth = value;
  }, stub);
}

async function calls(page: Page): Promise<AuthCall[]> {
  return page.evaluate(() => window.__authCalls ?? []);
}

async function remembered(page: Page, key: string): Promise<string | null> {
  return page.evaluate((name) => localStorage.getItem(name), key);
}

test("signup_asks_the_kind_then_the_email_and_mails_the_link", async ({ mount, page }) => {
  const component = await mount(<SignUp />);

  // Step 1: two cards, one sentence each, and nothing else open yet.
  await expect(component.getByText(SIGNUP.team.sentence)).toBeVisible();
  await expect(component.getByText(SIGNUP.personal.sentence)).toBeVisible();
  await expect(page.getByLabel(SIGNUP.email)).toHaveCount(0);
  await expect(page.getByLabel(SIGNUP.code)).toHaveCount(0);

  // Team is the one kind that has a name, and it is asked for here, on the
  // step whose answer has to survive the link.
  await component.getByRole("button", { name: SIGNUP.team.label }).click();
  await page.getByLabel(SIGNUP.orgName).fill("Acme");
  await component.getByRole("button", { name: SIGNUP.next }).click();

  // Step 2 asks for the address and nothing else — no password anywhere.
  await expect(page.getByLabel(SIGNUP.email)).toBeVisible();
  await expect(page.getByLabel(SIGNUP.password)).toHaveCount(0);
  await page.getByLabel(SIGNUP.email).fill("dana@harnessmanager.dev");
  await component.getByRole("button", { name: SIGNUP.sendLink }).click();

  // What went to the auth provider: one link, for a user it may create,
  // pointing back at this page's own finish step.
  await expect.poll(() => calls(page)).toContainEqual({
    name: "signInWithOtp",
    arg: {
      email: "dana@harnessmanager.dev",
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${new URL(page.url()).origin}/signup?finish=1`,
      },
    },
  });
  // And the sentence that is the whole of the waiting.
  await expect(component.getByText(SIGNUP.sent)).toBeVisible();
  // The choice is kept, because the link may be opened in another tab and
  // the account it signs in has no organisation to read it off.
  expect(JSON.parse((await remembered(page, CHOICE)) ?? "null")).toEqual({
    edition: "team",
    orgName: "Acme",
  });
});

test("signup_finishes_from_the_link_with_the_password_and_the_code", async ({ mount, page }) => {
  await auth(page, { session: true });
  await page.evaluate(
    ([key, held]) => localStorage.setItem(key, held),
    [CHOICE, JSON.stringify({ edition: "personal", orgName: "" })],
  );
  const sent = await records(page);
  // `finish`: the link's landing. The session is the stub's, as the browser
  // client's would be once it has read the token out of the URL.
  const component = await mount(<SignUp finish />);

  // Step 3, with the choice step 1 made — no second answer asked for.
  await expect(component.getByText(SIGNUP.personal.label)).toBeVisible();
  await expect(page.getByLabel(SIGNUP.orgName)).toHaveCount(0);
  await page.getByLabel(SIGNUP.password).fill("a-long-enough-one");
  await page.getByLabel(SIGNUP.code).fill(CODE);
  await component.getByRole("button", { name: SIGNUP.finish }).click();

  // The password is set through the auth provider, then the organisation is
  // made with the code — one write, the only place the code is checked.
  await expect.poll(() => calls(page)).toContainEqual({
    name: "updateUser",
    arg: { password: true },
  });
  await expect.poll(() => sent).toEqual([
    { method: "POST", path: "/v1/orgs", body: { code: CODE, personal: true } },
  ]);
});

test("signup_renders_a_wrong_code_in_place_and_sets_the_password_once", async ({ mount, page }) => {
  const message = "That access code is not right.";
  const sent = await refuses(page, { status: 403, code: "signup.code_wrong", message });
  await auth(page, { session: true });
  await page.evaluate(
    ([key, held]) => localStorage.setItem(key, held),
    [CHOICE, JSON.stringify({ edition: "team", orgName: "Acme" })],
  );
  const component = await mount(<SignUp finish />);

  await expect(page.getByLabel(SIGNUP.orgName)).toHaveValue("Acme");
  await page.getByLabel(SIGNUP.password).fill("a-long-enough-one");
  await page.getByLabel(SIGNUP.code).fill("wrong-code");
  await component.getByRole("button", { name: SIGNUP.finish }).click();

  await expect.poll(() => sent).toEqual([
    { method: "POST", path: "/v1/orgs", body: { code: "wrong-code", org_name: "Acme" } },
  ]);
  // In place: the field that was wrong is still open with the server's own
  // words under it, and the password — already set — is not asked for again.
  await expect(component.getByText(message)).toBeVisible();
  await expect(page.getByLabel(SIGNUP.code)).toHaveValue("wrong-code");
  await expect(page.getByLabel(SIGNUP.password)).toHaveCount(0);

  // The second attempt carries the right code and nothing else: one
  // `updateUser` for the whole form, because the provider refuses the same
  // password twice.
  await page.getByLabel(SIGNUP.code).fill(CODE);
  await component.getByRole("button", { name: SIGNUP.finish }).click();
  await expect.poll(() => sent).toHaveLength(2);
  expect((await calls(page)).filter((call) => call.name === "updateUser")).toHaveLength(1);
});

test("signup_asks_the_kind_again_when_nothing_was_remembered", async ({ mount, page }) => {
  await auth(page, { session: true });
  const sent = await records(page);
  // A session and an empty `localStorage`: another browser, or a sign-in
  // that `AuthApp` sent back here with no organisation to land on.
  const component = await mount(<SignUp finish />);

  await expect(component.getByText(SIGNUP.choose)).toBeVisible();
  await expect(component.getByRole("button", { name: SIGNUP.finish })).toBeDisabled();
  await component.getByRole("button", { name: SIGNUP.personal.label }).click();
  await page.getByLabel(SIGNUP.password).fill("a-long-enough-one");
  await page.getByLabel(SIGNUP.code).fill(CODE);
  await component.getByRole("button", { name: SIGNUP.finish }).click();

  await expect.poll(() => sent).toEqual([
    { method: "POST", path: "/v1/orgs", body: { code: CODE, personal: true } },
  ]);
});

test("signup_says_so_when_the_link_established_no_session", async ({ mount, page }) => {
  await auth(page, { session: false });
  const component = await mount(<SignUp finish />);

  // `?finish=1` and no session: the link is spent, or was opened where it was
  // not asked for. The page says it once and offers the way out — step 1.
  await expect(component.getByText(SIGNUP.linkDead)).toBeVisible();
  await expect(component.getByText(SIGNUP.personal.sentence)).toBeVisible();
  await expect(page.getByLabel(SIGNUP.code)).toHaveCount(0);
});
