"use client";

import { useEffect, useState } from "react";

const TERMS = [
  "your side projects",
  "engineering",
  "marketing",
  "sales",
  "support",
  "finance",
  "research",
  "ops",
] as const;

const LONGEST = "your side projects";

export function HeroLead() {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let swap: number | undefined;
    const id = window.setInterval(() => {
      setShown(false);
      swap = window.setTimeout(() => {
        setIndex((current) => (current + 1) % TERMS.length);
        setShown(true);
      }, 220);
    }, 2400);

    return () => {
      window.clearInterval(id);
      if (swap !== undefined) window.clearTimeout(swap);
    };
  }, []);

  return (
    <>
      <h1 className="mt-4 font-serif text-[2.6rem] leading-[1.08] tracking-[-0.03em] text-pretty md:text-6xl">
        Secure, manage, and scale harnesses across{" "}
        <span className="relative inline-block align-baseline">
          <em className="invisible italic" aria-hidden>
            {LONGEST}.
          </em>
          <em
            className={`absolute inset-y-0 left-0 italic transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
            aria-live="polite"
          >
            {TERMS[index]}.
          </em>
        </span>
      </h1>
      <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-muted">
        A harness-agnostic management and collaboration solution for preserving, iterating, and proliferating
        agentic work.
      </p>
    </>
  );
}
