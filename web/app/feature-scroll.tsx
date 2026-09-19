"use client";

import { useEffect, useRef, useState } from "react";

const FEATURES = [
  {
    id: "agnostic",
    label: "Agnostic",
    eyebrow: "One apex",
    title: "The harness sits above whoever is doing the work.",
    body: "People, teams, Pi, Claude Code — they are leaves. They pull a resolved copy down and push what they learned back up. The apex does not change when the leaf does. Port the same harness between runtimes, or between people. What you own stays at the top.",
  },
  {
    id: "security",
    label: "Security",
    eyebrow: "The box",
    title: "The agent can only do what the box allows.",
    body: "A resource is assigned to a team, or to a single person — marketing can have a read on the customer table, and nothing else. If someone asks the agent to overwrite a row, the harness manager bounces it. The session never had that action. What was never given cannot be reached. The fence only tightens.",
  },
  {
    id: "share",
    label: "Shareability",
    eyebrow: "Collaboration",
    title: "Move work through the tree. Not through chat.",
    body: "Promote lifts a skill to the team. Share lifts it toward the org. Port moves it sideways. Every node holds the same kinds of asset, so sharing never needs a new mechanism. You get the nearest live copy of a name — yours, then the team's, then the org's. When someone leaves, the work does not.",
  },
  {
    id: "lifecycle",
    label: "Lifecycle",
    eyebrow: "Iteration",
    title: "Edit locally. Push when it's yours. Promote when it's ready.",
    body: "Hydration never overwrites a file you changed. Push publishes to your own profile and shadows the team for you alone. An admin promotes it when the team should have it. Last Tuesday's skill is a versioned asset — not a thread you cannot find.",
  },
] as const;

export function FeatureScroll() {
  const section = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduce) return;

    const onScroll = () => {
      const el = section.current;
      if (!el) return;
      const total = el.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      const scrolled = Math.min(Math.max(-el.getBoundingClientRect().top, 0), total);
      setActive(Math.min(FEATURES.length - 1, Math.floor((scrolled / total) * FEATURES.length)));
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduce]);

  function goTo(index: number) {
    const el = section.current;
    if (!el) return;
    const total = el.offsetHeight - window.innerHeight;
    const top = el.getBoundingClientRect().top + window.scrollY + (index / FEATURES.length) * total + 8;
    window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  }

  if (reduce) {
    return (
      <section id="features" className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20">
          {FEATURES.map((feature) => (
            <article key={feature.id} className="grid gap-4 md:grid-cols-2">
              <h2 className="font-serif text-3xl tracking-[-0.02em]">{feature.label}</h2>
              <div>
                <p className="text-[11px] font-bold tracking-[0.14em] text-accent uppercase">
                  {feature.eyebrow}
                </p>
                <h3 className="mt-2 font-serif text-2xl tracking-[-0.02em]">{feature.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">{feature.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section ref={section} id="features" className="relative h-[400vh] border-t border-line">
      <div className="sticky top-16 flex h-[calc(100vh-4rem)] items-center">
        <div className="mx-auto grid h-full w-full max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-[0.4fr_0.6fr]">
          <ol className="grid gap-1">
            {FEATURES.map((feature, index) => {
              const on = index === active;
              return (
                <li key={feature.id}>
                  <button
                    type="button"
                    onClick={() => goTo(index)}
                    className={`flex w-full items-baseline gap-3 rounded-lg px-2 py-2.5 text-left transition ${
                      on ? "text-fg" : "text-faint hover:text-muted"
                    }`}
                  >
                    <span className="font-mono text-[10px] tracking-[0.12em]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={`font-serif tracking-[-0.02em] ${on ? "text-[1.7rem] md:text-3xl" : "text-xl"}`}
                    >
                      {feature.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="relative min-h-88">
            {FEATURES.map((feature, index) => (
              <article
                key={feature.id}
                aria-hidden={index !== active}
                className={`absolute inset-0 grid content-start gap-6 transition-all duration-500 ${
                  index === active ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
                }`}
              >
                <FeatureStage id={feature.id} active={index === active} />
                <div>
                  <p className="text-[11px] font-bold tracking-[0.14em] text-accent uppercase">
                    {feature.eyebrow}
                  </p>
                  <h3 className="mt-2 font-serif text-2xl tracking-[-0.02em] md:text-3xl">
                    {feature.title}
                  </h3>
                  <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">{feature.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TerminalFrame({ title, children }: { title: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-line bg-ink text-ink-text">
      <div className="flex items-center gap-2 border-b border-ink-line px-4 py-2">
        <span className="size-2 rounded-full bg-ink-line" aria-hidden />
        <span className="size-2 rounded-full bg-ink-line" aria-hidden />
        <span className="size-2 rounded-full bg-ink-line" aria-hidden />
        <span className="ml-2 font-mono text-[10px] tracking-[0.12em] text-ink-muted uppercase">{title}</span>
      </div>
      <pre className="min-h-44 overflow-x-auto px-4 py-3 font-mono text-[11px] leading-[1.45] text-ink-text whitespace-pre">
        {children}
      </pre>
    </div>
  );
}

function center(text: string, width: number) {
  const pad = Math.max(0, width - text.length);
  const left = Math.floor(pad / 2);
  return `${" ".repeat(left)}${text}${" ".repeat(pad - left)}`;
}

function FeatureStage({ id, active }: { id: (typeof FEATURES)[number]["id"]; active: boolean }) {
  return (
    <div className={`transition-opacity duration-500 ${active ? "opacity-100" : "opacity-0"}`}>
      {id === "agnostic" ? (
        <AgnosticDiagram active={active} />
      ) : (
        <TerminalFrame title={id}>
          {id === "security"
            ? [
                "  +---------------- marketing box ----------------+",
                "  |                                               |",
                "  |                    agent                      |",
                "  |                                               |",
                "  +-----------+-----------------------+-----------+",
                "              |                       |",
                "         read | ok               write| bounced",
                "              v                       x",
                "          customers              not in the box",
                "          (assigned)",
              ].join("\n")
            : id === "share"
              ? [
                  "  you                         sales                        org",
                  "   |                            |                           |",
                  "   |  -- promote ------------>  |  -- share ------------>   |",
                  "   |                            |                           |",
                  "  v3 yours                   inherits                    older copy",
                ].join("\n")
              : [
                  "  edit -----> push -----> review -----> promote",
                  "   |           |            |              |",
                  "  local      your         optional        team",
                  "  never      profile      gate            next",
                  "  overwritten             before it       session",
                  "                          travels",
                ].join("\n")}
        </TerminalFrame>
      )}
    </div>
  );
}

const LEAF_PAIRS = [
  { left: "Pi", right: "Claude Code" },
  { left: "Ana", right: "Ben" },
  { left: "marketing", right: "engineering" },
  { left: "you", right: "Pi" },
] as const;

function AgnosticDiagram({ active }: { active: boolean }) {
  const [pair, setPair] = useState(0);

  useEffect(() => {
    if (!active) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setPair((current) => (current + 1) % LEAF_PAIRS.length);
    }, 2600);
    return () => window.clearInterval(id);
  }, [active]);

  const { left, right } = LEAF_PAIRS[pair];
  const width = 47;
  const art = [
    center("[ marketing ]", width),
    center("/ \\", width),
    center("pull /   \\ push", width),
    center("/     \\", width),
    `${left.padStart(12)}${" ".repeat(width - 12 - right.length)}${right}`,
  ].join("\n");

  return <TerminalFrame title="agnostic">{art}</TerminalFrame>;
}
