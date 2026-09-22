import Link from "next/link";
import { ApprovalScroll, GrowthCurve } from "./approval-scroll";
import { HeroLead } from "./hero-lead";
import { HeroTerminal } from "./hero-terminal";
import { Pillars } from "./pillars";
import { CTA, SiteFooter, SiteHeader } from "./site-chrome";

export function HomePage() {
  return (
    <div className="min-h-screen bg-canvas text-fg">
      <SiteHeader />

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
          <div>
            <HeroLead />
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/request" className={`${CTA} bg-ink text-ink-text hover:bg-ink-raised`}>
                Request an account
              </Link>
              <a href="#how" className={`${CTA} text-fg hover:text-accent`}>
                See how it works →
              </a>
            </div>
          </div>
          <HeroTerminal />
        </section>

        <section id="features" className="border-t border-line">
          <Pillars />
        </section>

        <section id="how" className="border-t border-line bg-sunken/60">
          <ApprovalScroll />
        </section>

        <section className="border-t border-line bg-sunken/60">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:py-28 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-[11px] font-bold tracking-[0.16em] text-accent uppercase">A different growth curve</p>
              <h2 className="mt-3 font-serif text-4xl tracking-[-0.03em] md:text-5xl">Compounding innovation</h2>
              <p className="mt-6 text-[16px] leading-relaxed text-muted">
                In most organizations, access and trust are decided one relationship at a time — this
                person, this tool, this system — which means the same judgment gets made hundreds of
                times over. We collapse that. Approve a resource once, and every team authorized to use
                it inherits that decision automatically. Approve a workflow once, and it&apos;s instantly
                available to everyone who should have it — no re-approval, no re-provisioning, no
                repeated trip through security review.
              </p>
              <p className="mt-4 text-[16px] leading-relaxed text-muted">
                The result isn&apos;t just faster onboarding. It&apos;s a different growth curve.
                Capability no longer scales with the number of approvals an organization can push
                through — it scales with the number of decisions it&apos;s willing to make, and each
                decision reaches everyone beneath it at once.
              </p>
            </div>
            <GrowthCurve />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
