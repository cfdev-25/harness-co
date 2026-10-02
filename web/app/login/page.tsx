import type { Metadata } from "next";
import { AuthApp } from "../auth";
import { PublicTheme } from "../public-theme";

export const metadata: Metadata = {
  title: "Sign in · Harness Manager",
  // A private console: keep it out of search results.
  robots: { index: false, follow: false },
};

/**
 * `?next=` is read here, in a server component, and handed down as a prop:
 * `useSearchParams` in `AuthApp` would make the whole page need a Suspense
 * boundary at build time (02 rule 11).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return (
    <PublicTheme>
      <AuthApp next={Array.isArray(next) ? next[0] : next} />
    </PublicTheme>
  );
}
