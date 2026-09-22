import type { ReactNode } from "react";
import { LEGAL } from "./legal";
import { PublicTheme } from "./public-theme";
import { SiteFooter, SiteHeader } from "./site-chrome";

export function LegalDocument({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <PublicTheme>
      <div className="min-h-screen bg-canvas text-fg">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-6 py-20 md:py-24">
          <p className="text-[11px] font-bold tracking-[0.16em] text-accent uppercase">Legal</p>
          <h1 className="mt-3 font-serif text-4xl tracking-[-0.03em] md:text-5xl">{title}</h1>
          <p className="mt-4 font-mono text-[12px] text-faint">Effective {LEGAL.effective}</p>
          <div className="mt-8 text-[17px] leading-relaxed text-muted">{lead}</div>
          <div className="mt-4 text-[15px] leading-relaxed text-muted [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-12 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:tracking-[-0.02em] [&_h2]:text-fg [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-fg [&_li]:mt-2 [&_p]:mt-4 [&_strong]:font-semibold [&_strong]:text-fg [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-5">
            {children}
          </div>
        </main>
        <SiteFooter />
      </div>
    </PublicTheme>
  );
}

export function Contact() {
  return (
    <p>
      {LEGAL.entity}
      <br />
      {LEGAL.address}
      <br />
      <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
    </p>
  );
}
