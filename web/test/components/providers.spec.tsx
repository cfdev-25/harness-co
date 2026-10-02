import { expect, test } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import { PROVIDERS_TEXT } from "@/content/screens/providers";
import { HarnessProviders, ModelProviders } from "./providers-story";
import { type Sent, records } from "./writes";

const PIN = { repo: "https://example.com/pi", commit: "60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759" };
const SPEAKS = ["anthropic-messages", "openai-completions"];

test("providers_row_select_puts_full_row", async ({ mount, page }) => {
  const sent = await records(page);
  const table = await mount(<HarnessProviders />);

  await table.getByRole("combobox", { name: "Approval" }).selectOption("approved");

  // The verb moves the approval and nothing else: `HarnessProviderIn` requires
  // the pin and the wire formats too, and a `scope` left out would widen the
  // approval to every team. The CLI sends the same five fields.
  await expect.poll(() => sent).toEqual([
    {
      method: "PUT",
      path: "/v1/providers/harness/pi",
      body: { approval: "approved", scope: { teams: ["acme.marketing"] }, pin: PIN, speaks: SPEAKS },
    },
  ]);
});

test("providers_decline_requires_reason_inline", async ({ mount, page }) => {
  const sent = await records(page);
  const table = await mount(<HarnessProviders approved />);

  await table.getByRole("combobox", { name: "Approval" }).selectOption("not-approved");
  // The reason opens where the switch is; there is no picker modal (04 §10).
  await expect(table.getByRole("dialog")).toHaveCount(0);
  const reason = table.getByRole("textbox", { name: PROVIDERS_TEXT.declineReason });
  await expect(reason).toBeVisible();
  await expect(table.getByText(PROVIDERS_TEXT.declineReasonHint)).toBeVisible();

  const confirm = table.getByRole("button", { name: PROVIDERS_TEXT.decideSubmit });
  await expect(confirm).toHaveAttribute("aria-disabled", "true");
  await confirm.dispatchEvent("click");
  expect(sent).toEqual([]);

  await reason.fill("It has not been reviewed.");
  await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
  await confirm.click();
  await expect.poll(() => sent).toEqual([
    {
      method: "PUT",
      path: "/v1/providers/harness/pi",
      body: {
        approval: "not-approved",
        reason: "It has not been reviewed.",
        scope: { teams: ["acme.marketing"] },
        pin: PIN,
        speaks: SPEAKS,
      },
    },
  ]);
});

test("providers_first_run_notice_when_none_approved", async ({ mount }) => {
  // The dev organisation is migrated and has both runtimes approved, so the
  // notice is proved here rather than on a screen (04 §10 States, 05 §12).
  const none = await mount(<HarnessProviders />);
  await expect(none.getByText(PROVIDERS_TEXT.firstRun.harness)).toBeVisible();
  await none.unmount();
  const one = await mount(<HarnessProviders approved />);
  await expect(one.getByText(PROVIDERS_TEXT.firstRun.harness)).toHaveCount(0);
});

test("model_set_up_posts_key_and_model", async ({ mount, page }) => {
  const sent = await setupRoute(page);
  const table = await mount(<ModelProviders />);
  await expect(table.getByText(PROVIDERS_TEXT.firstRun.model)).toBeVisible();

  await table.getByRole("button", { name: "Set up" }).click();
  const modal = table.getByRole("dialog");
  await expect(modal).toContainText("Connect a key for anthropic");
  // 04 §10: the words the other two screens own are not in this one.
  for (const word of ["group", "grant", "routing"]) {
    expect((await modal.innerText()).toLowerCase()).not.toContain(word);
  }

  // `Field` wraps its input, so the accessible name carries the hint too.
  await modal.getByLabel(PROVIDERS_TEXT.setUpKey).fill("sk-ant-0123456789");
  await modal.getByLabel(PROVIDERS_TEXT.setUpModel).fill("claude-opus-5");
  await modal.getByRole("button", { name: PROVIDERS_TEXT.setUpSubmit }).click();

  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/providers/model/anthropic/setup",
      body: { key: "sk-ant-0123456789", model: "claude-opus-5" },
    },
  ]);
  // The one fact the write returns that the row cannot show (00 §4.10).
  await expect(table.getByText(PROVIDERS_TEXT.setUpDoneDefault)).toBeVisible();
});

test("model_set_up_hidden_when_credential_present", async ({ mount }) => {
  const table = await mount(<ModelProviders connected />);
  await expect(table.getByRole("button", { name: "Set up" })).toHaveCount(0);
  await expect(table.getByText(PROVIDERS_TEXT.firstRun.model)).toHaveCount(0);
});

/** `records` answers every write with an empty document, and *Set up* reads a
 *  field of its own from the response (`CommitResult & { default }`), so this
 *  one route both records and answers. */
async function setupRoute(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route("**/v1/providers/model/*/setup", async (route) => {
    const raw = route.request().postData();
    sent.push({
      method: route.request().method(),
      path: new URL(route.request().url()).pathname,
      body: raw ? (JSON.parse(raw) as unknown) : undefined,
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ commit: "abc1234", ref: "refs/heads/org", default: true }),
    });
  });
  return sent;
}
