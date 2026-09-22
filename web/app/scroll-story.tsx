"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";

const MOTION = "(prefers-reduced-motion: reduce)";

export function useReducedMotion() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(MOTION);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(MOTION).matches,
    () => false,
  );
}

/**
 * Steps 0..count-1 on a loop while active, holding each step for `ms` — one
 * number, or one per step for steps that need longer to read (pass a stable
 * array). Reduced motion holds on `settled`. `go` steps by hand and stops the
 * loop, which starts again next time the caller becomes active. With
 * `loop: false` it plays through once and holds on the last step.
 */
export function usePhase(
  active: boolean,
  count: number,
  ms: number | readonly number[],
  settled = count - 1,
  loop = true,
) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState(0);
  const [paused, setPaused] = useState(false);
  // The timer reads the live step without restarting on every advance.
  const current = useRef(0);

  const go = useCallback(
    (delta: number) => {
      setPaused(true);
      current.current = (current.current + delta + count) % count;
      setPhase(current.current);
    },
    [count],
  );

  useEffect(() => {
    if (!active || reduce || paused) return;
    let timer: number | undefined;
    const next = () => {
      if (!loop && current.current === count - 1) return;
      const wait = typeof ms === "number" ? ms : ms[current.current];
      timer = window.setTimeout(() => {
        current.current = (current.current + 1) % count;
        setPhase(current.current);
        next();
      }, wait);
    };
    next();
    return () => window.clearTimeout(timer);
  }, [active, reduce, paused, count, ms, loop]);

  // Rewind once the caller scrolls out of view, so it replays from the top.
  useEffect(() => {
    if (!active) return;
    return () => {
      current.current = 0;
      setPhase(0);
      setPaused(false);
    };
  }, [active]);

  return { phase: reduce ? settled : phase, go, paused };
}

/** True once the element has scrolled into view; stays true. */
export function useInView<T extends Element>(ref: RefObject<T | null>, threshold = 0.4) {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, threshold]);

  return seen;
}

export type Story = {
  id: string;
  label: string;
};

/**
 * A pinned panel that advances one story per stretch of scroll: the heading
 * across the top, the story list on the left, centred on the active story's
 * stage to its right. The stage carries all of the story's words.
 */
export function ScrollStory({
  heading,
  items,
  stage,
  pace = 100,
}: {
  heading: ReactNode;
  items: readonly Story[];
  stage: (index: number, active: boolean) => ReactNode;
  /** Viewport heights of scroll each story holds the screen for. */
  pace?: number;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;

    const onScroll = () => {
      const el = track.current;
      if (!el) return;
      const total = el.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      const scrolled = Math.min(Math.max(-el.getBoundingClientRect().top, 0), total);
      setActive(Math.min(items.length - 1, Math.floor((scrolled / total) * items.length)));
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduce, items.length]);

  function goTo(index: number) {
    const el = track.current;
    if (!el) return;
    const total = el.offsetHeight - window.innerHeight;
    const top = el.getBoundingClientRect().top + window.scrollY + (index / items.length) * total + 8;
    // Jump rather than glide: a smooth scroll would play every story in between.
    window.scrollTo({ top, behavior: "auto" });
  }

  if (reduce) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        {heading}
        <div className="mt-14 grid gap-16">
          {items.map((item, index) => (
            <article key={item.id} className="grid items-center gap-6 lg:grid-cols-[0.3fr_0.7fr] lg:gap-12">
              <h3 className="font-serif text-2xl tracking-[-0.02em]">{item.label}</h3>
              {stage(index, true)}
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mx-auto max-w-6xl px-6 pt-20 lg:hidden">{heading}</div>
      <div ref={track} className="relative" style={{ height: `${items.length * pace}vh` }}>
        <div className="sticky top-16 flex h-[calc(100svh-4rem)] items-center">
          <div className="mx-auto w-full max-w-6xl px-6 py-8">
            <div className="hidden lg:block">{heading}</div>
            <div className="grid gap-5 lg:mt-10 lg:grid-cols-[19rem_1fr] lg:items-center lg:gap-14">
              <ol className="-mx-2 flex min-w-0 gap-1 lg:mx-0 lg:grid lg:gap-1">
                {items.map((item, index) => {
                  const on = index === active;
                  const done = index < active;
                  return (
                    <li key={item.id} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => goTo(index)}
                        aria-current={on ? "step" : undefined}
                        className={`group flex items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors duration-300 lg:w-full lg:gap-4 lg:py-3 ${
                          on ? "text-fg" : "text-faint hover:text-muted"
                        }`}
                      >
                        <span
                          className={`grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10px] transition-colors duration-300 ${
                            on
                              ? "bg-accent text-canvas"
                              : done
                                ? "text-accent ring-1 ring-accent/40"
                                : "text-faint ring-1 ring-line group-hover:ring-muted"
                          }`}
                        >
                          {index + 1}
                        </span>
                        <span
                          className={`font-serif text-lg tracking-[-0.02em] whitespace-nowrap lg:text-xl ${
                            on ? "" : "hidden lg:inline"
                          }`}
                        >
                          {item.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              <div className="grid min-w-0">
                {items.map((item, index) => {
                  const on = index === active;
                  return (
                    <Swap key={item.id} on={on}>
                      {stage(index, on)}
                    </Swap>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Swap({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!on}
      className={`transition-all duration-500 [grid-area:1/1] ${
        on ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}
