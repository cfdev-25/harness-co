import { expect, test } from "@playwright/experimental-ct-react";
import { SCALES } from "@/content/scales";
import { SCALE_IDS, resolveTag } from "@/lib/views/scales";
import { ScaleTag } from "@/app/(console)/ui/scale-tag";

test("scale_tag_renders_every_registered_value", async ({ mount }) => {
  for (const scale of SCALE_IDS) {
    for (const entry of SCALES[scale].values) {
      const tag = await mount(<ScaleTag scale={scale} value={entry.value} />);
      await expect(tag).toHaveText(entry.value);
      await expect(tag).toHaveAttribute("data-tone", entry.tone);
      await expect(tag).toHaveAttribute("title", entry.meaning);
      await tag.unmount();
    }
  }
});

test("scale_tag_links_to_how", async ({ mount }) => {
  for (const scale of SCALE_IDS) {
    const tag = await mount(<ScaleTag scale={scale} value={SCALES[scale].values[0].value} />);
    await expect(tag).toHaveAttribute("href", `/console/how#${scale}`);
    await tag.unmount();
  }
});

test("scale_tag_unregistered_throws_in_dev", async ({ mount }) => {
  // The component-test bundle is built with NODE_ENV=production, so the
  // production half is asserted here and the development throw is asserted on
  // `resolveTag`'s own branch (D64; the same call the component makes).
  expect(() => resolveTag("approval", "wobbly", true)).toThrow(
    'Unregistered value "wobbly" for scale "approval"',
  );
  expect(resolveTag("approval", "wobbly", false)).toEqual({
    value: "wobbly",
    tone: "neutral",
    meaning: "Not yet explained",
  });
  const tag = await mount(<ScaleTag scale="approval" value="wobbly" />);
  await expect(tag).toHaveAttribute("data-tone", "neutral");
  await expect(tag).toHaveAttribute("title", "Not yet explained");
});
