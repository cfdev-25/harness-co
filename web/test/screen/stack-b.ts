import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * V3 against the real backbone (02 rule 30, D22): `web/test/server/stack-b.sh`
 * starts `definitions` + `api` on 8422/8421 over the scratch database
 * `harness_cutover_dryrun` and `next dev` on 3021, and prints the values
 * below. There is no MSW and no mocked `api`.
 *
 *   eval "$(bash web/test/server/stack-b.sh env | sed 's/^/export /')"
 *   npx playwright test --project=screen
 *
 * `baseURL` and the session cookie are **fixtures**, not `test.use` /
 * `test.beforeEach`: those two register against the spec file being loaded at
 * the moment this module is first evaluated, so in a worker that runs several
 * spec files only the first would get them. A fixture is per test and cannot
 * drift that way.
 *
 * Not a `.spec.ts`, so Playwright does not collect this file as a test file.
 */
export const STACK = {
  url: process.env.STACK_B_URL ?? "http://127.0.0.1:3021",
  cookieName: process.env.STACK_B_COOKIE_NAME ?? "sb-eqwaguzyrpubxqvjkwfo-auth-token",
  cookie: process.env.STACK_B_COOKIE ?? "",
};

/**
 * The scope segments D2 gives: `org`, `me`, and a dotted team path. The one
 * organisation in the scratch database is `test-org-1` and its one team is
 * `test-org-1.marketing`, which is what the team segment spells.
 */
export const ORG = "org";
export const ORG_PATH = "test-org-1";
export const TEAM = "test-org-1.marketing";

// The fixture callback is named `provide` rather than Playwright's usual
// `use`, because `eslint-plugin-react-hooks` reads a bare `use(...)` as
// React's `use` hook and fails the file.
export const test = base.extend({
  baseURL: async ({}, provide) => {
    await provide(STACK.url);
  },
  storageState: async ({}, provide) => {
    await provide({
      cookies:
        STACK.cookie === ""
          ? []
          : [
              {
                name: STACK.cookieName,
                value: STACK.cookie,
                domain: new URL(STACK.url).hostname,
                path: "/",
                expires: -1,
                httpOnly: false,
                secure: false,
                sameSite: "Lax" as const,
              },
            ],
      origins: [],
    });
  },
});

export { expect };

/** Every screen is asserted against a fact from the fixture, never against
 *  "it rendered" (02 rule 32). This waits for the content region, nothing
 *  more; `next dev` compiles a route the first time it is asked for. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.locator("main#content .screen").first().waitFor({ timeout: 60000 });
}

/** A table's headings in the order they are drawn. `getByRole` folds the
 *  `HelpMark`'s label into a column's accessible name, so a heading is read
 *  from its text rather than matched by role. */
export async function headings(page: Page): Promise<string[]> {
  return (await page.locator("main#content th").allTextContents()).map((text) =>
    text.replace(/\s*\?\s*$/, "").trim(),
  );
}

/** K4: every tag on the console is a link to its scale's anchor. */
export async function everyTagLinksToHow(page: Page) {
  const tags = page.locator("[data-scale]");
  for (let index = 0; index < (await tags.count()); index += 1) {
    const href = await tags.nth(index).getAttribute("href");
    const scale = await tags.nth(index).getAttribute("data-scale");
    expect(href).toBe(`/console/how#${scale}`);
  }
}
