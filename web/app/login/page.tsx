import type { Metadata } from "next";
import { AuthApp } from "../auth";
import { PublicTheme } from "../public-theme";

export const metadata: Metadata = {
  title: "Sign in · Harness Manager",
  // A private console: keep it out of search results.
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <PublicTheme>
      <AuthApp />
    </PublicTheme>
  );
}
