import type { Metadata } from "next";
import { getToken } from "@/lib/token.server";
import { PublicTheme } from "../public-theme";
import { SignUp } from "./signup";

export const metadata: Metadata = {
  title: "Create an account · Harness Manager",
  description: "Start a team or a personal account with your access code.",
  robots: { index: false, follow: false },
};

/**
 * W7-D1's door. The session and `?finish=1` are read here, in a server
 * component, for the same reason `/login` reads `?next=` here: a client hook
 * would make the whole page need a Suspense boundary (02 rule 11).
 *
 * `signedIn` is the resume path — someone sent back by `AuthApp` with an
 * account and no organization opens at the last step without a flash of the
 * first. `finish` is the email link's landing, where the session is not in
 * the cookie yet (it is in the URL the auth provider redirected to, and the
 * browser client is what reads it), so it only tells the page that a session
 * was *meant* to arrive: if none does, the link is spent and it says so.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ finish?: string | string[] }>;
}) {
  const { finish } = await searchParams;
  return (
    <PublicTheme>
      <SignUp signedIn={Boolean(await getToken())} finish={Boolean(finish)} />
    </PublicTheme>
  );
}
