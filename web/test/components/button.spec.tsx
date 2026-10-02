import { expect, test } from "@playwright/experimental-ct-react";
import { Button } from "@/app/(console)/ui/button";

const EXPLAIN = "Publishes it to everyone on Marketing.";

test("button_explain_is_a_tooltip", async ({ mount, page }) => {
  const button = await mount(<Button explain={EXPLAIN}>Accept all 3</Button>);
  await button.hover();
  await expect(page.getByRole("tooltip")).toHaveText(EXPLAIN);
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await button.focus();
  await expect(page.getByRole("tooltip")).toHaveText(EXPLAIN);
  await expect(button).toHaveAttribute("aria-describedby", /.+/);
});

test("button_href_explain_is_a_tooltip", async ({ mount, page }) => {
  // A `href` Button is a `next/link`, and since W6-D94 the bubble is placed
  // from a ref spread onto it — so the ref has to reach the `<a>`.
  await mount(
    <Button href="/console/org/harnesses" explain={EXPLAIN}>
      Import
    </Button>,
  );
  await page.getByRole("link").hover();
  await expect(page.getByRole("tooltip")).toHaveText(EXPLAIN);
});
