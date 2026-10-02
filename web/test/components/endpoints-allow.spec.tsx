import { expect, test } from "@playwright/experimental-ct-react";
import { AllowHost } from "@/app/(console)/console/[scope]/logs/endpoints/_allow";
import { LOGS, LOGS_TEXT } from "@/content/screens/logs";
import { records, refuses } from "./writes";

/**
 * W5-D4, D136: the refusal in the log and the setting that caused it, one
 * click apart. The write is proved at the network, aimed at the node the
 * refused row named in `setBy` and carried in `AllowAction.scope`.
 */

test("allow_writes_the_host_at_the_node_that_refused", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<AllowHost host="registry.npmjs.org" scope="team:acme.marketing" />);

  await page.getByRole("button", { name: LOGS.verbs.allow.label }).click();

  await expect.poll(() => sent).toEqual([
    {
      method: "POST",
      path: "/v1/reach/hosts?scope=team:acme.marketing",
      body: { host: "registry.npmjs.org" },
    },
  ]);
  // The honest tense: a session already running keeps the plan it started
  // with, so nothing is claimed about this one.
  await expect(page.getByText(LOGS_TEXT.allowedNext)).toBeVisible();
});

test("allow_shows_the_servers_refusal_in_place", async ({ mount, page }) => {
  const refusal = {
    status: 403,
    code: "reach.off",
    message: "Reach is off for marketing; turn it on under Boundaries → Reach before adding a host.",
    remedy: "Set reach to an allow-list first; the suggested hosts are one click each.",
  };
  await refuses(page, refusal);
  await mount(<AllowHost host="registry.npmjs.org" scope="team:acme.marketing" />);

  await page.getByRole("button", { name: LOGS.verbs.allow.label }).click();

  // 02 rule 21: the server's message *and* its remedy, beside the control.
  await expect(page.getByText(refusal.message)).toBeVisible();
  await expect(page.getByText(refusal.remedy)).toBeVisible();
  await expect(page.getByText(LOGS_TEXT.allowedNext)).toHaveCount(0);
});
