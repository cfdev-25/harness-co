import type { Metadata } from "next";
import { PublicTheme } from "../public-theme";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { RequestForm } from "./request-form";

export const metadata: Metadata = {
  title: "Request an account · Harness Manager",
  description: "Harness Manager is invite-only. Tell us about your team and we'll be in touch.",
};

export default function RequestPage() {
  return (
    <PublicTheme>
      <div className="min-h-screen bg-canvas text-fg">
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-6 py-20 md:py-24">
          <p className="text-[11px] font-bold tracking-[0.16em] text-accent uppercase">Invite only</p>
          <h1 className="mt-3 font-serif text-4xl tracking-[-0.03em] md:text-5xl">Request an account</h1>
          <p className="mt-5 text-[17px] leading-relaxed text-muted">
            We&apos;re onboarding teams one at a time so every organization starts with its harnesses
            set up properly. Tell us a little about yours and we&apos;ll be in touch.
          </p>
          <div className="mt-10">
            <RequestForm />
          </div>
        </main>
        <SiteFooter />
      </div>
    </PublicTheme>
  );
}
