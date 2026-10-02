import Link from "next/link";
import { LEGAL } from "./legal";
import { BrandMark } from "./(console)/ui/brand-mark";

export const CTA =
  "inline-flex items-center justify-center rounded-full px-5 py-2.5 text-[13px] font-semibold transition";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <Link href="/" className="flex items-center gap-3.5" aria-label="Harness Manager, home">
          <BrandMark small />
          <span className="h-7 w-[3px] rounded-full bg-fg max-sm:hidden" aria-hidden />
          {/* The mark's ink sits high in its box, so the name drops a little to meet it. */}
          <span className="mt-[3px] font-serif text-[17px] font-semibold tracking-[-0.01em] whitespace-nowrap max-sm:hidden">
            The Harness Manager
          </span>
        </Link>
        <nav className="ml-auto hidden items-center gap-7 text-[13px] text-muted md:flex">
          <Link href="/#features" className="hover:text-fg">
            Features
          </Link>
          <Link href="/#how" className="hover:text-fg">
            How it works
          </Link>
        </nav>
        <Link href="/signup" className={`${CTA} ml-auto bg-ink text-ink-text hover:bg-ink-raised md:ml-2`}>
          Create an account
        </Link>
      </div>
    </header>
  );
}

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "How it works", href: "/#how" },
      { label: "Create an account", href: "/signup" },
      { label: "Request an account", href: "/request" },
      { label: "Sign in", href: "/login" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Contact", href: `mailto:${LEGAL.email}` },
      { label: "Report a security issue", href: `mailto:${LEGAL.email}?subject=Security%20report` },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms of Service", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="bg-ink text-ink-muted">
      <div className="mx-auto max-w-6xl px-6 pt-16 pb-8">
        <div className="grid gap-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" aria-label="Harness Manager, home" className="flex items-center gap-3 text-ink-text">
              <BrandMark small />
              <span className="font-serif text-[17px] font-semibold tracking-[-0.01em]">The Harness Manager</span>
            </Link>
            <p className="mt-5 max-w-xs font-serif text-xl leading-snug tracking-[-0.01em] text-ink-text">
              Give every agent a harness. Let your people drive.
            </p>
          </div>
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-[11px] font-bold tracking-[0.14em] text-ink-text uppercase">{column.title}</p>
              <ul className="mt-4 grid gap-2.5 text-[13px]">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="hover:text-ink-text">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col gap-2 border-t border-ink-line pt-6 text-[12px] md:flex-row md:justify-between">
          <span>
            © {new Date().getFullYear()} {LEGAL.company}. All rights reserved.
          </span>
          <span>Claude, Cursor and Pi are trademarks of their respective owners.</span>
        </div>
      </div>
    </footer>
  );
}
