import { expect, test } from "@playwright/experimental-ct-react";
import { Greeting } from "./greeting";

/** Proves the Playwright component-test rig (01 D62, 02 rule 30) with a
    trivial component — the screens and `ui/` land their own specs later. */
test("mounts a trivial component", async ({ mount }) => {
  const component = await mount(<Greeting name="rig" />);
  await expect(component).toContainText("Hello, rig");
});
