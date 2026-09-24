import type { Metadata } from "next";
import { UserPreview } from "./user";

export const metadata: Metadata = {
  title: "You · prototype",
  robots: { index: false, follow: false },
};

export default function UserPreviewPage() {
  return <UserPreview />;
}
