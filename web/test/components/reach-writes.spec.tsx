import { expect, test } from "@playwright/experimental-ct-react";
import { ReachSection } from "@/app/(console)/console/[scope]/boundaries/reach/_reach";
import { REACH_TEXT } from "@/content/screens/boundaries";
import { REACH_VIEW, VIEWER } from "./fixtures";
import { records, refuses } from "./writes";

/**
 * W5-D5's three writes, proved at the network: the component calls the real
 * `lib/api.ts` and the route records what left the browser, `?scope=` and all
 * (02 rule 30). A widening the server refuses is the fourth case, and it is
 * proved by the server's own sentence appearing on the screen (rule 21).
 */

test("reach_mode_puts_the_whole_file_at_the_scope", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<ReachSection view={REACH_VIEW} viewer={VIEWER} scopeQuery="team:acme.marketing" />);

  await page.getByRole("radio", { name: REACH_TEXT.modes.on.label }).check();

  // The list does not carry over: an allow-list is not a deny-list, and the
  // radio's own sentence says the list starts empty (04 D87).
  await expect.poll(() => sent).toEqual([
    {
      method: "PUT",
      path: "/v1/reach?scope=team:acme.marketing",
      body: { mode: "on", hosts: [] },
    },
  ]);
});

test("reach_adds_a_host_from_the_field_and_from_the_suggested_list", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<ReachSection view={REACH_VIEW} viewer={VIEWER} scopeQuery="org" />);

  await page.getByLabel(REACH_TEXT.addLabel).fill("proxy.golang.org");
  await page.getByRole("button", { name: REACH_TEXT.addVerb, exact: true }).click();
  // The starter list is one click each, and a host already on the list is
  // said to be there rather than offered again.
  await expect(page.getByText(REACH_TEXT.alreadyAllowed).first()).toBeVisible();
  await page.getByRole("button", { name: "registry.npmjs.org" }).click();

  await expect.poll(() => sent).toEqual([
    { method: "POST", path: "/v1/reach/hosts?scope=org", body: { host: "proxy.golang.org" } },
    { method: "POST", path: "/v1/reach/hosts?scope=org", body: { host: "registry.npmjs.org" } },
  ]);
});

test("reach_removes_a_host_at_the_scope", async ({ mount, page }) => {
  const sent = await records(page);
  await mount(<ReachSection view={REACH_VIEW} viewer={VIEWER} scopeQuery="team:acme.marketing" />);

  await page.getByRole("button", { name: REACH_TEXT.removeVerb }).first().click();

  await expect.poll(() => sent).toEqual([
    {
      method: "DELETE",
      path: "/v1/reach/hosts/pypi.org?scope=team:acme.marketing",
      body: undefined,
    },
  ]);
});

test("reach_widening_shows_the_servers_sentence_in_place", async ({ mount, page }) => {
  // Reach only ever narrows (W5-D1a). The console does not pre-judge which
  // step widens — `definitions` does, at the push — so the refusal is
  // rendered where the control is, never a disabled control (P13).
  const refusal = {
    status: 403,
    code: "reach.not_yours",
    message:
      "Setting how far a session can reach is an admin's decision at the node that holds it, so marketing's admins decide this one.",
    remedy: "Ask an admin of marketing.",
  };
  await refuses(page, refusal);
  await mount(<ReachSection view={REACH_VIEW} viewer={VIEWER} scopeQuery="team:acme.marketing" />);

  await page.getByLabel(REACH_TEXT.addLabel).fill("competitor.example");
  await page.getByRole("button", { name: REACH_TEXT.addVerb, exact: true }).click();

  await expect(page.getByText(refusal.message)).toBeVisible();
  await expect(page.getByText(refusal.remedy)).toBeVisible();
});

test("reach_is_read_only_without_canEdit", async ({ mount, page }) => {
  await mount(
    <ReachSection view={{ ...REACH_VIEW, canEdit: false }} viewer={VIEWER} scopeQuery="me" />,
  );

  // The chip's own words: a member reads the setting and uses it.
  await expect(page.getByText(REACH_TEXT.readOnly)).toBeVisible();
  await expect(page.getByRole("radio", { name: REACH_TEXT.modes.on.label })).toBeDisabled();
  await expect(page.getByRole("button", { name: REACH_TEXT.removeVerb })).toHaveCount(0);
  await expect(page.getByLabel(REACH_TEXT.addLabel)).toHaveCount(0);
  // The inherited walk and this level's answer are still there to read.
  await expect(page.getByText("Organisation: on, except 1 host")).toBeVisible();
});

test("reach_not_set_here_offers_the_modes_and_no_list", async ({ mount, page }) => {
  // A node with no `reach.json` of its own: the three writes act on *that*
  // node, so there is no host list to remove from until a mode starts one.
  const none = {
    ...REACH_VIEW,
    chain: REACH_VIEW.chain.filter((step) => step.node !== REACH_VIEW.scope),
  };
  await mount(<ReachSection view={none} viewer={VIEWER} scopeQuery="team:acme.marketing" />);

  await expect(page.getByText(REACH_TEXT.notSetHere)).toBeVisible();
  await expect(page.getByRole("radio", { name: REACH_TEXT.modes.allow.label })).not.toBeChecked();
  await expect(page.getByRole("button", { name: REACH_TEXT.removeVerb })).toHaveCount(0);
  // What it uses instead is still read, above.
  await expect(page.getByText("Organisation: on, except 1 host")).toBeVisible();
});
