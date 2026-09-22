import type { Metadata } from "next";
import { Console } from "./console";

export const metadata: Metadata = {
  title: "Console · Harness Manager",
  robots: { index: false, follow: false },
};

export default function AppPage() {
  return <Console />;
}
