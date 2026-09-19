import Link from "next/link";
import { FeatureScroll } from "./feature-scroll";
import { HeroLead } from "./hero-lead";
import { HeroTerminal } from "./hero-terminal";
import { BrandMark } from "./ui";

const CTA =
  "inline-flex items-center justify-center rounded-full px-5 py-2.5 text-[13px] font-semibold transition";

export function HomePage() {
  return (
    <div className="min-h-screen bg-canvas text-fg">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
          <Link href="/" aria-label="Harness">
            <BrandMark small />
          </Link>
          <nav className="ml-auto hidden items-center gap-7 text-[13px] text-muted md:flex">
            <a href="#features" className="hover:text-fg">
              Features
            </a>
            <a href="#who" className="hover:text-fg">
              Who it is for
            </a>
            <a href="#how" className="hover:text-fg">
              How it works
            </a>
          </nav>
          <Link href="/login" className={`${CTA} ml-auto bg-ink text-ink-text hover:bg-ink-raised md:ml-2`}>
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] text-accent uppercase">
              Harness management
            </p>
            <HeroLead />
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/login" className={`${CTA} bg-ink text-ink-text hover:bg-ink-raised`}>
                Sign in
              </Link>
              <a href="#how" className={`${CTA} text-fg hover:text-accent`}>
                See how it works →
              </a>
            </div>
          </div>
          <HeroTerminal />
        </section>

        <FeatureScroll />

        <section id="who" className="border-t border-line bg-sunken/60">
          <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
            <p className="text-[11px] font-bold tracking-[0.16em] text-accent uppercase">
              One model, two scales
            </p>
            <h2 className="mt-3 max-w-xl font-serif text-4xl tracking-[-0.03em] md:text-5xl">
              Built for a person. Ready for an enterprise.
            </h2>
            <div className="mt-12 grid gap-5 md:grid-cols-2">
              <article className="rounded-2xl border border-line bg-surface p-8">
                <p className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
                  For you
                </p>
                <h3 className="mt-3 font-serif text-3xl tracking-[-0.02em]">A desk you can switch</h3>
                <p className="mt-4 text-[15px] leading-relaxed text-muted">
                  Pack a job into a harness and leave the rest of the library on the shelf. Your
                  skills stay yours until you promote them. No harness means everything you
                  already resolve — same as sitting down to work today.
                </p>
              </article>
              <article className="rounded-2xl border border-line bg-surface p-8">
                <p className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
                  For the company
                </p>
                <h3 className="mt-3 font-serif text-3xl tracking-[-0.02em]">A tree you can govern</h3>
                <p className="mt-4 text-[15px] leading-relaxed text-muted">
                  Org, team, person. Capabilities resolve nearest-ancestor-wins. Boundaries inherit
                  top-down and only tighten. Admins look down the tree; nobody widens a fence from
                  below.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
            <p className="text-[11px] font-bold tracking-[0.16em] text-accent uppercase">
              Three layers
            </p>
            <h2 className="mt-3 max-w-lg font-serif text-4xl tracking-[-0.03em] md:text-5xl">
              The job, the tree, the fence.
            </h2>
            <div className="mt-12 grid gap-10 md:grid-cols-3">
              {[
                {
                  title: "The harness",
                  body: "A named selection of what the session may load — prompts, skills, tools, memories. Empty on purpose. Nothing arrives unless somebody put it there.",
                },
                {
                  title: "The tree",
                  body: "Whose copy of each name you get. A user can change how a task is done. The nearest live ancestor still wins the slot.",
                },
                {
                  title: "The boundary",
                  body: "Permissions, egress, approvals. A floor you can raise, never lower. No harness reaches further than another.",
                },
              ].map((layer) => (
                <article key={layer.title}>
                  <h3 className="font-serif text-2xl tracking-[-0.02em]">{layer.title}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-muted">{layer.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="border-t border-line bg-sunken/60">
          <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
            <p className="text-[11px] font-bold tracking-[0.16em] text-accent uppercase">
              How it works
            </p>
            <h2 className="mt-3 font-serif text-4xl tracking-[-0.03em] md:text-5xl">
              Name the job. Run it locally.
            </h2>
            <ol className="mt-12 grid gap-5 md:grid-cols-3">
              {[
                {
                  step: "01",
                  title: "Name the job",
                  body: "Create a harness. It starts empty, so what it contains is always a decision somebody took.",
                },
                {
                  step: "02",
                  title: "Tick what belongs",
                  body: "Skills, tools, memories, prompts. The tree still picks whose copy of each name you receive.",
                },
                {
                  step: "03",
                  title: "Run it on your machine",
                  body: "The client hydrates and the agent works locally. We resolve, issue keys, and keep the audit — not the inference.",
                },
              ].map((item) => (
                <li key={item.step} className="rounded-2xl border border-line bg-surface p-7">
                  <span className="font-mono text-[11px] text-accent">{item.step}</span>
                  <h3 className="mt-3 font-serif text-2xl tracking-[-0.02em]">{item.title}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-muted">{item.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-ink text-ink-text">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-6 py-20 md:flex-row md:items-center md:py-24">
            <h2 className="max-w-xl font-serif text-4xl tracking-[-0.03em] md:text-5xl">
              Give every agent a harness.
            </h2>
            <Link
              href="/login"
              className={`${CTA} bg-accent text-ink hover:bg-accent-deep`}
            >
              Sign in
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-line bg-ink text-ink-muted">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <Link href="/" aria-label="Harness" className="text-ink-text">
            <BrandMark small />
          </Link>
          <Link href="/login" className="text-[13px] hover:text-ink-text">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}

