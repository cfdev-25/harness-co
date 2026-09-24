import type { Metadata } from "next";
import { TeamPreview } from "./team";

export const metadata: Metadata = {
  title: "Team · prototype",
  robots: { index: false, follow: false },
};

export default function TeamPreviewPage() {
  return <TeamPreview />;
}
