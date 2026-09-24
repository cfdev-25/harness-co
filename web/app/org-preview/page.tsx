import type { Metadata } from "next";
import { OrgPreview } from "./preview";

export const metadata: Metadata = {
  title: "Org configuration · prototype",
  robots: { index: false, follow: false },
};

export default function OrgPreviewPage() {
  return <OrgPreview />;
}
