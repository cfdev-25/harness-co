"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./scroll-story";

type Tone = "cmd" | "dim" | "text" | "accent";

type Line = {
  text: string;
  tone: Tone;
  /** "leader": dots then a tick, for boot. "glyph": a spinner ahead of the text, for work. */
  task?: "leader" | "glyph";
  state?: "running" | "done";
  detail?: string;
  /** A tick at the end of the line, for output that has landed. */
  tick?: boolean;
};

type Step =
  | { kind: "type"; text: string }
  | { kind: "line"; text?: string; tone?: Tone; tick?: boolean }
  | { kind: "task"; label: string; detail?: string; ms: number }
  | { kind: "work"; label: string; ms: number }
  | { kind: "choose"; text: string; options: readonly string[]; pick: string; ms: number }
  | { kind: "wait"; ms: number };

/** Pi's working indicator. */
const SPIN = ["▖", "▘", "▝", "▗"] as const;

const SCRIPT: Step[] = [
  { kind: "type", text: "harness run pi --marketing" },
  { kind: "wait", ms: 500 },
  { kind: "task", label: "Securing environment", ms: 700 },
  { kind: "task", label: "Loading skills", detail: "3", ms: 620 },
  { kind: "task", label: "Loading tools", detail: "2", ms: 560 },
  { kind: "task", label: "Loading memories", detail: "1", ms: 560 },
  { kind: "task", label: "Issuing session key", ms: 780 },
  { kind: "line" },
  { kind: "line", text: "  Pi marketing started", tone: "accent" },
  { kind: "line" },
  { kind: "wait", ms: 800 },

  { kind: "type", text: "Rebuild the Q2 launch deck in dark mode" },
  { kind: "wait", ms: 700 },
  { kind: "work", label: "Editing tool · marketing-deck", ms: 1700 },
  { kind: "work", label: "Creating deliverable", ms: 1900 },
  { kind: "line", text: "  Wrote ~/marketing/q2-launch-deck.pdf", tone: "text", tick: true },
  { kind: "line" },
  { kind: "wait", ms: 1400 },

  { kind: "type", text: "exit" },
  { kind: "wait", ms: 500 },
  { kind: "task", label: "Closing session", ms: 620 },
  { kind: "task", label: "Revoking session key", ms: 700 },
  { kind: "task", label: "Checking changes", detail: "1", ms: 760 },
  { kind: "line" },
  {
    kind: "choose",
    text: "  Keep the change to marketing-deck?",
    options: ["Yes", "No"],
    pick: "Yes",
    ms: 1500,
  },
  { kind: "wait", ms: 700 },
  { kind: "line", text: "  Progress saved", tone: "dim", tick: true },
  { kind: "wait", ms: 5200 },
];

const TONE: Record<Tone, string> = {
  cmd: "text-ink-text",
  dim: "text-ink-muted",
  text: "text-ink-text",
  accent: "text-accent",
};

/** What the person typed, underlined so it reads as input rather than output. */
const TYPED = "underline decoration-ink-line decoration-1 underline-offset-[5px]";

/** Dot leader, so every tick lands in the same column. */
const COLUMN = 30;
function leader(label: string) {
  return ` ${".".repeat(Math.max(3, COLUMN - label.length))} `;
}

/** The whole session, already played — what reduced motion shows. */
function finalFrame(): Line[] {
  const lines: Line[] = [];
  for (const step of SCRIPT) {
    if (step.kind === "type") lines.push({ text: step.text, tone: "cmd" });
    else if (step.kind === "line")
      lines.push({ text: step.text ?? "", tone: step.tone ?? "text", tick: step.tick });
    else if (step.kind === "task")
      lines.push({ text: `  ${step.label}`, tone: "dim", task: "leader", state: "done", detail: step.detail });
    else if (step.kind === "work")
      lines.push({ text: step.label, tone: "dim", task: "glyph", state: "done" });
    else if (step.kind === "choose") {
      lines.push({ text: step.text, tone: "accent" });
      lines.push({ text: step.pick, tone: "dim", task: "glyph", state: "done" });
    }
  }
  return lines;
}

const FINAL = finalFrame();

export function HeroTerminal() {
  const reduce = useReducedMotion();
  const [played, setLines] = useState<Line[]>([]);
  const lines = reduce ? FINAL : played;
  const [input, setInput] = useState<string | null>(null);
  const [cursor, setCursor] = useState(true);
  const [spin, setSpin] = useState(0);
  const scroller = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (reduce) return;

    let alive = true;
    let timer: number | undefined;
    const later = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, ms);
      });

    async function typeInto(text: string, into: (typed: string) => void) {
      let typed = "";
      for (const char of text) {
        if (!alive) return;
        typed += char;
        into(typed);
        await later(char === " " ? 62 : 42);
      }
    }

    async function run() {
      while (alive) {
        setLines([]);
        setInput(null);

        for (const step of SCRIPT) {
          if (!alive) return;

          if (step.kind === "wait") {
            await later(step.ms);
          } else if (step.kind === "line") {
            setLines((current) => [
              ...current,
              { text: step.text ?? "", tone: step.tone ?? "text", tick: step.tick },
            ]);
            await later(step.text ? 260 : 140);
          } else if (step.kind === "type") {
            setInput("");
            await later(260);
            await typeInto(step.text, setInput);
            const typed = step.text;
            setLines((current) => [...current, { text: typed, tone: "cmd" }]);
            setInput(null);
            await later(180);
          } else if (step.kind === "task" || step.kind === "work") {
            const shape = step.kind === "task" ? "leader" : "glyph";
            setLines((current) => [
              ...current,
              step.kind === "task"
                ? { text: `  ${step.label}`, tone: "dim", task: shape, state: "running" }
                : { text: step.label, tone: "dim", task: shape, state: "running" },
            ]);
            await later(step.ms);
            setLines((current) =>
              current.map((line, index) =>
                index === current.length - 1
                  ? { ...line, state: "done", detail: step.kind === "task" ? step.detail : undefined }
                  : line,
              ),
            );
            await later(step.kind === "task" ? 160 : 320);
          } else {
            setLines((current) => [
              ...current,
              { text: step.text, tone: "accent" },
              ...step.options.map((option, index) => ({
                text: `    ${index === 0 ? "\u25b8" : " "} ${option}`,
                tone: (index === 0 ? "text" : "dim") as Tone,
              })),
            ]);
            await later(step.ms);
            // the choice lands: the menu collapses to the option taken
            setLines((current) => [
              ...current.slice(0, current.length - step.options.length),
              { text: step.pick, tone: "dim", task: "glyph", state: "done" },
            ]);
          }
        }
      }
    }

    void run();
    const blink = window.setInterval(() => setCursor((on) => !on), 560);
    const spinner = window.setInterval(() => setSpin((frame) => frame + 1), 130);
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
      window.clearInterval(blink);
      window.clearInterval(spinner);
    };
  }, [reduce]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines, input]);

  return (
    <div className="relative">
      <div className="absolute -inset-8 rounded-full bg-accent/10 blur-3xl" aria-hidden />
      <div className="relative overflow-hidden rounded-xl border border-ink-line bg-ink text-ink-text shadow-[0_30px_70px_-40px_rgb(0_0_0/0.6)]">
        <div className="flex items-center gap-2 border-b border-ink-line px-4 py-3">
          <span className="size-3 rounded-full bg-warn/80" aria-hidden />
          <span className="size-3 rounded-full bg-hold/80" aria-hidden />
          <span className="size-3 rounded-full bg-ok/80" aria-hidden />
          <span className="ml-2 font-mono text-[11px] text-ink-muted">harness</span>
        </div>
        <pre
          ref={scroller}
          aria-label="A Harness session, from launch to save"
          className="h-[22rem] overflow-hidden px-4 py-4 font-mono text-[10px] leading-[1.75] whitespace-pre-wrap sm:px-5 sm:text-[11px] md:h-[31rem] md:text-[12px]"
        >
          {lines.map((line, index) => (
            <span key={`${index}-${line.text}`} className={`block ${TONE[line.tone]}`}>
              {line.task === "glyph" && (
                <span className={line.state === "done" ? "text-accent" : "text-ink-muted"}>
                  {`  ${line.state === "done" ? "✓" : SPIN[spin % SPIN.length]} `}
                </span>
              )}
              {line.tone === "cmd" ? (
                <>
                  <span className="text-accent">{"% "}</span>
                  <span className={TYPED}>{line.text}</span>
                </>
              ) : (
                line.text || "\u00a0"
              )}
              {line.tick && <span className="text-accent">{"  \u2713"}</span>}
              {line.task === "leader" && (
                <>
                  <span className="text-ink-line">{leader(line.text)}</span>
                  {line.state === "done" ? (
                    <span className="text-accent">✓</span>
                  ) : (
                    <span className="text-ink-muted">{SPIN[spin % SPIN.length]}</span>
                  )}
                  {line.detail && <span className="text-ink-muted">{`  ${line.detail}`}</span>}
                </>
              )}
            </span>
          ))}
          {input !== null && (
            <span className="block">
              <span className="text-accent">{"% "}</span>
              <span className={TYPED}>{input}</span>
              <span className={cursor ? "text-accent" : "text-transparent"}>▍</span>
            </span>
          )}
        </pre>
      </div>
    </div>
  );
}
