"use client";

import { useEffect, useRef, useState } from "react";

type Tone = "cmd" | "dim" | "ok" | "accent" | "you" | "agent";

type Step =
  | { kind: "prompt" }
  | { kind: "type"; text: string }
  | { kind: "line"; text: string; tone?: Tone }
  | { kind: "wait"; ms: number };

const SCRIPT: Step[] = [
  { kind: "prompt" },
  { kind: "type", text: "harness run pi --marketing" },
  { kind: "wait", ms: 420 },
  { kind: "line", text: "resolving marketing", tone: "dim" },
  { kind: "line", text: "  skill/campaign-brief", tone: "dim" },
  { kind: "line", text: "  skill/brand-voice", tone: "dim" },
  { kind: "line", text: "  memory/audience", tone: "dim" },
  { kind: "line", text: "  tool/cms", tone: "dim" },
  { kind: "line", text: "loaded 4 assets · boundary as the org set it", tone: "ok" },
  { kind: "wait", ms: 500 },
  { kind: "line", text: "" },
  { kind: "line", text: "pi · marketing", tone: "accent" },
  { kind: "wait", ms: 280 },
  { kind: "prompt" },
  { kind: "type", text: "Draft a launch email for the spring collection" },
  { kind: "wait", ms: 360 },
  { kind: "line", text: "Wrote launch-email.md — subject, three variants, brand voice applied.", tone: "agent" },
  { kind: "wait", ms: 420 },
  { kind: "prompt" },
  { kind: "type", text: "keep the follow-up as a skill so next time starts there" },
  { kind: "wait", ms: 360 },
  { kind: "line", text: "added skill/follow-up-sequence to marketing", tone: "ok" },
  { kind: "line", text: "wrote memory/spring-audience", tone: "ok" },
  { kind: "wait", ms: 280 },
  { kind: "prompt" },
  { kind: "type", text: "exit" },
  { kind: "wait", ms: 380 },
  { kind: "line", text: "" },
  { kind: "line", text: "session ended", tone: "dim" },
  { kind: "line", text: "detected 2 harness modifications", tone: "accent" },
  { kind: "line", text: "  + skill/follow-up-sequence", tone: "dim" },
  { kind: "line", text: "  + memory/spring-audience", tone: "dim" },
  { kind: "line", text: "push them to your profile? [Y/n]", tone: "accent" },
  { kind: "prompt" },
  { kind: "type", text: "Y" },
  { kind: "wait", ms: 320 },
  { kind: "line", text: "pushed 2 assets · marketing", tone: "ok" },
  { kind: "wait", ms: 2800 },
];

type Line = { text: string; tone?: Tone };

const TONE: Record<Tone, string> = {
  cmd: "text-ink-text",
  dim: "text-ink-muted",
  ok: "text-ok",
  accent: "text-accent",
  you: "text-ink-text",
  agent: "text-ink-text",
};

function playable() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function finalLines(): { lines: Line[]; input: string | null } {
  const lines: Line[] = [];
  let input: string | null = null;
  for (const step of SCRIPT) {
    if (step.kind === "prompt") input = "";
    else if (step.kind === "type") {
      lines.push({ text: step.text, tone: "cmd" });
      input = null;
    } else if (step.kind === "line") lines.push({ text: step.text, tone: step.tone });
  }
  return { lines, input };
}

export function HeroTerminal() {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState<string | null>(null);
  const [cursor, setCursor] = useState(true);
  const scroller = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!playable()) {
      const next = finalLines();
      setLines(next.lines);
      setInput(next.input);
      return;
    }

    let alive = true;
    let timer: number | undefined;
    setLines([]);
    setInput(null);

    const later = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, ms);
      });

    async function run() {
      while (alive) {
        setLines([]);
        setInput(null);
        for (const step of SCRIPT) {
          if (!alive) return;
          if (step.kind === "wait") {
            await later(step.ms);
          } else if (step.kind === "prompt") {
            setInput("");
            await later(160);
          } else if (step.kind === "type") {
            let typed = "";
            for (const char of step.text) {
              if (!alive) return;
              typed += char;
              setInput(typed);
              await later(28 + (char === " " ? 20 : 0));
            }
            const committed = typed;
            setLines((current) => [...current, { text: committed, tone: "cmd" }]);
            setInput(null);
            await later(120);
          } else {
            setLines((current) => [...current, { text: step.text, tone: step.tone }]);
            await later(step.text ? 200 : 80);
          }
        }
      }
    }

    void run();
    const blink = window.setInterval(() => setCursor((on) => !on), 530);
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
      window.clearInterval(blink);
    };
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines, input]);

  return (
    <div className="relative">
      <div className="absolute -inset-8 rounded-full bg-accent/10 blur-3xl" aria-hidden />
      <div className="relative overflow-hidden rounded-2xl border border-ink-line bg-ink text-ink-text shadow-[0_24px_64px_rgba(43,33,28,0.18)]">
        <div className="flex items-center gap-2 border-b border-ink-line px-4 py-2.5">
          <span className="size-2 rounded-full bg-ink-line" aria-hidden />
          <span className="size-2 rounded-full bg-ink-line" aria-hidden />
          <span className="size-2 rounded-full bg-ink-line" aria-hidden />
          <span className="ml-2 font-mono text-[10px] tracking-[0.12em] text-ink-muted uppercase">
            harness
          </span>
        </div>
        <pre
          ref={scroller}
          aria-label="Harness CLI session"
          className="h-[22rem] overflow-hidden px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap"
        >
          {lines.map((line, index) => (
            <span key={`${index}-${line.text}`} className={`block ${line.tone ? TONE[line.tone] : ""}`}>
              {line.tone === "cmd" ? (
                <>
                  <span className="text-ink-muted">{"% "}</span>
                  {line.text}
                </>
              ) : (
                line.text || "\u00a0"
              )}
            </span>
          ))}
          {input !== null && (
            <span className="block">
              <span className="text-ink-muted">{"% "}</span>
              {input}
              <span className={cursor ? "text-accent" : "text-transparent"}>▍</span>
            </span>
          )}
        </pre>
      </div>
    </div>
  );
}
