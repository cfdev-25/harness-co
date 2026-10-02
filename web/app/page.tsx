import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getToken } from "@/lib/token.server";
import { HomePage } from "./home";
import { PublicTheme } from "./public-theme";

/** Where a signed-in person lands; the console's own layout sends an account
    with no workspace yet on to `/signup`. */
const CONSOLE = "/console/me/harnesses";

export const metadata: Metadata = {
  title: "Harness",
  description:
    "A harness-agnostic management and collaboration solution for preserving, iterating, and proliferating agentic work across your organization.",
};

export default async function Home() {
  // A signed-in visitor has no business on the front page: the console is
  // theirs. Reading the cookie is the whole check — the console verifies it.
  if (await getToken()) redirect(CONSOLE);
  return (
    <PublicTheme>
      <HomePage />
    </PublicTheme>
  );
}
