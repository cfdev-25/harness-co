import { expect, test } from "@playwright/experimental-ct-react";
import { Card } from "@/app/(console)/console/[scope]/harnesses/_card";
import { HARNESSES_WORDS as WORDS } from "@/content/screens/harnesses";
import type { HarnessCard } from "@/lib/views/harness";

/**
 * W5-D13's launch row on a harness card (04 §4). The runtimes come from the
 * server (`HarnessCard.runners`), the breadcrumb from the viewer's own last
 * session (`lastWorkspace`), and both sit above the card's overlay link.
 */

const SCOPE = { kind: "me" } as const;
const ID = "8ceca1ae-ee7b-4638-bb3e-6a77443429e8";

function card(over: Partial<HarnessCard> = {}): HarnessCard {
  return {
    id: ID,
    name: "test-harness-1",
    description: "the one the founder runs",
    team: { path: "acme.marketing", name: "marketing" },
    fileCount: 2,
    runners: [{ id: "pi", name: "Pi" }],
    ...over,
  };
}

test("runner_buttons_come_from_the_server", async ({ mount, page }) => {
  await mount(
    <Card scope={SCOPE} card={card({ runners: [{ id: "pi", name: "Pi" }, { id: "claude", name: "Claude Code" }] })} />,
  );

  // One button per runtime, labelled with the runtime's own name, each the
  // one link shape engine 08 §11.24 parses.
  await expect(page.getByRole("link", { name: "Open in Pi" })).toHaveAttribute(
    "href", `harness://run?harness=${ID}&provider=pi`);
  await expect(page.getByRole("link", { name: "Open in Claude Code" })).toHaveAttribute(
    "href", `harness://run?harness=${ID}&provider=claude`);
});

test("a_card_with_no_runners_shows_none", async ({ mount, page }) => {
  await mount(<Card scope={SCOPE} card={card({ runners: [] })} />);

  await expect(page.getByText(WORDS.openIn)).toHaveCount(0);
  await expect(page.locator('a[href^="harness://"]')).toHaveCount(0);
  // The card itself is still a card.
  await expect(page.getByRole("link", { name: "test-harness-1" })).toBeVisible();
});

test("no_workspace_no_breadcrumb", async ({ mount, page }) => {
  // W5-D14: the server nulls another person's workspace and every workspace
  // under `?as`, so absence is the whole rule the page applies.
  await mount(<Card scope={SCOPE} card={card()} />);

  await expect(page.locator('a[href*="workspace="]')).toHaveCount(0);
  await expect(page.getByText("Open again", { exact: false })).toHaveCount(0);
});

test("the_breadcrumb_encodes_the_path_and_shortens_it_only_to_read", async ({ mount, page }) => {
  await mount(
    <Card
      scope={SCOPE}
      card={card({ lastWorkspace: "/Users/corby/my projects/foo", lastHost: "corby-mbp" })}
    />,
  );
  const again = page.getByRole("link", { name: "Open again in ~/my projects/foo on corby-mbp" });
  // `~` is display only; the link carries the absolute path, percent-encoded,
  // because a relative one is `cli.link_malformed`.
  await expect(again).toHaveAttribute(
    "href",
    `harness://run?harness=${ID}&provider=pi&workspace=%2FUsers%2Fcorby%2Fmy%20projects%2Ffoo`,
  );
});

test("the_card_overlay_does_not_swallow_a_runner", async ({ mount, page }) => {
  await mount(<Card scope={SCOPE} card={card()} />);

  // Record what the click actually reaches and stop the browser from trying
  // to hand `harness://` to the operating system from a test run.
  const reached = await page.evaluateHandle(() => {
    const seen: string[] = [];
    document.addEventListener("click", (event) => {
      const anchor = (event.target as Element).closest("a");
      if (anchor) seen.push(anchor.getAttribute("href") ?? "");
      event.preventDefault();
    }, true);
    return seen;
  });

  // Playwright's actionability check fails outright if the overlay intercepts
  // the pointer, so a click that lands at all is half the proof; the href it
  // landed on is the other half.
  await page.getByRole("link", { name: "Open in Pi" }).click();

  expect(await reached.jsonValue()).toEqual([`harness://run?harness=${ID}&provider=pi`]);
  // Not the harness page: the overlay is below the row, not over it.
  expect(page.url()).not.toContain("/harnesses/");
});
