"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollStory, useInView, usePhase, useReducedMotion, type Story } from "./scroll-story";

type UseCase = Story & {
  /** Who does what — the situation the card plays out. */
  situation: string;
};

const PRINCIPLES: readonly UseCase[] = [
  {
    id: "propagation",
    label: "Instant propagation",
    situation: "Ana, in Sales, finds a faster way to build a pricing quote.",
  },
  {
    id: "membership",
    label: "Membership-based access",
    situation: "Priya joins Engineering on Monday.",
  },
  {
    id: "policy",
    label: "Policy inheritance",
    situation: "Legal says customer records must never leave the company's own systems.",
  },
  {
    id: "truth",
    label: "Single source of truth",
    situation: "An auditor asks who can see payment data, and who approved it.",
  },
];

export function ApprovalScroll() {
  return (
    <ScrollStory
      heading={
        <div>
          <p className="text-[11px] font-bold tracking-[0.16em] text-accent uppercase">In practice</p>
          <h2 className="mt-3 font-serif text-3xl tracking-[-0.03em] text-balance md:text-4xl lg:text-[2.6rem] lg:whitespace-nowrap">
            How managed harnesses reshape work.
          </h2>
        </div>
      }
      items={PRINCIPLES}
      pace={160}
      stage={(index, active) => <TreeStage step={index} active={active} situation={PRINCIPLES[index].situation} />}
    />
  );
}

/* ---------- the company every story plays out on ---------- */

type NodeId = "org" | "sales" | "eng" | "s1" | "s2" | "s3" | "e1" | "e2" | "e3";

const NODES: Record<NodeId, { x: number; y: number; r: number; depth: number; parent?: NodeId; name?: string }> = {
  org: { x: 240, y: 44, r: 17, depth: 0 },
  sales: { x: 130, y: 136, r: 13, depth: 1, parent: "org" },
  eng: { x: 350, y: 136, r: 13, depth: 1, parent: "org" },
  s1: { x: 70, y: 226, r: 9, depth: 2, parent: "sales", name: "Ana" },
  s2: { x: 130, y: 226, r: 9, depth: 2, parent: "sales", name: "Jo" },
  s3: { x: 190, y: 226, r: 9, depth: 2, parent: "sales", name: "Cal" },
  e1: { x: 290, y: 226, r: 9, depth: 2, parent: "eng", name: "Lee" },
  e2: { x: 350, y: 226, r: 9, depth: 2, parent: "eng", name: "Ben" },
  e3: { x: 410, y: 226, r: 9, depth: 2, parent: "eng", name: "Priya" },
};

const IDS = Object.keys(NODES) as NodeId[];

type Edge = [from: NodeId, to: NodeId];

type Frame = {
  /** Nodes that hold the thing — the idea, the grant, the answer. */
  lit: NodeId[];
  /** Where it is moving right now, drawn as an arrow whose head travels the shaft. */
  flows?: Edge[];
  /** Nodes wearing the company rule. */
  ringed?: NodeId[];
  /** Someone whose reach outside the company the rule refuses. */
  blockedOut?: NodeId;
  /** Priya is on the tree. */
  joined?: boolean;
  /** Where this frame's attention is, drawn with a pulse. */
  source?: NodeId;
  caption: string;
};

const SALES: NodeId[] = ["s1", "s2", "s3"];
const PEOPLE: NodeId[] = [...SALES, "e1", "e2"];

const SCRIPT: Frame[][] = [
  [
    { lit: ["s1"], source: "s1", caption: "Right now it lives on Ana's machine. Without a harness, that's where it would stay." },
    {
      lit: ["s1", "sales"],
      flows: [["s1", "sales"]],
      caption: "She sends it to her team lead, who approves it once.",
    },
    {
      lit: [...SALES, "sales"],
      flows: [
        ["sales", "s2"],
        ["sales", "s3"],
      ],
      caption: "Every rep in Sales now quotes the same, better way — no training session needed.",
    },
    {
      lit: [...SALES, "sales", "org"],
      flows: [["sales", "org"]],
      caption: "It's worth sharing, so it's promoted to the whole company.",
    },
    {
      lit: [...SALES, "sales", "org", "eng"],
      flows: [["org", "eng"]],
      caption: "Engineering pulls it in to study how Sales actually quotes.",
    },
    {
      lit: [...SALES, "sales", "org", "eng", "e2"],
      flows: [["eng", "e2"]],
      source: "e2",
      caption: "Ben adds the SAP data structures it needs, so prices come straight from the system of record.",
    },
    {
      lit: [...SALES, "sales", "org", "eng", "e2"],
      flows: [
        ["e2", "eng"],
        ["eng", "org"],
        ["org", "sales"],
      ],
      caption: "His upgrade flows back up — and Sales gets it without asking.",
    },
    {
      lit: [...SALES, "sales", "org", "eng", "e2"],
      caption: "One good idea, two teams better off. It stays, even after Ana moves on.",
    },
  ],
  [
    {
      lit: ["eng"],
      source: "eng",
      caption: "Engineering is approved for three things: the code, the test servers, and the error logs.",
    },
    { lit: ["eng"], joined: true, source: "e3", caption: "Priya is added to the team — that's the only step." },
    {
      lit: ["eng", "e3"],
      joined: true,
      flows: [["eng", "e3"]],
      caption: "By 9am she has exactly what the team has — no tickets, no waiting on IT.",
    },
    {
      lit: ["eng", "e3"],
      joined: true,
      caption: "Nothing more. Payroll and customer records were never the team's, so they aren't hers.",
    },
    { lit: ["eng"], caption: "When she leaves, her access leaves with her. Nothing to hunt down." },
  ],
  [
    {
      lit: [],
      ringed: ["org"],
      source: "org",
      caption: "Security writes the rule once, at the top of the company.",
    },
    {
      lit: [],
      ringed: ["org", "sales", "eng"],
      flows: [
        ["org", "sales"],
        ["org", "eng"],
      ],
      caption: "Every team inherits it the same moment. Nobody configures it team by team.",
    },
    {
      lit: [],
      ringed: ["org", "sales", "eng", ...PEOPLE],
      flows: [
        ["sales", "s1"],
        ["sales", "s2"],
        ["sales", "s3"],
        ["eng", "e1"],
        ["eng", "e2"],
      ],
      caption: "It reaches every person — and every agent they run.",
    },
    {
      lit: [],
      ringed: ["org", "sales", "eng", ...PEOPLE],
      blockedOut: "s3",
      caption: "Cal asks his agent to upload a customer list to an outside service. Blocked.",
    },
    {
      lit: [],
      ringed: ["org", "sales", "eng", ...PEOPLE],
      caption: "Nobody had to remember the rule, or check it by hand. It was already there.",
    },
  ],
  [
    { lit: [], caption: "Usually that means weeks of reconciling spreadsheets. Here it starts with one lookup." },
    { lit: ["e2"], source: "e2", caption: "The lookup finds Ben." },
    {
      lit: ["e2", "eng"],
      flows: [["e2", "eng"]],
      caption: "He has it because he's in Engineering…",
    },
    {
      lit: ["e2", "eng", "org"],
      flows: [["eng", "org"]],
      caption: "…and Maya, Head of Security, approved that for Engineering on March 14.",
    },
    {
      lit: ["e2", "eng", "org"],
      caption: "Answered in seconds, not weeks of chasing spreadsheets.",
    },
  ],
];

const SETTLED = [6, 2, 3, 4];

/** Long enough to read each caption twice at an easy pace. */
const HOLDS = SCRIPT.map((frames) => frames.map((frame) => Math.max(3800, 1800 + frame.caption.length * 55)));

/** A segment from the rim of one node to the rim of another. */
function segment([from, to]: Edge, gap = 3) {
  const a = NODES[from];
  const b = NODES[to];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  return {
    x1: a.x + ux * (a.r + gap),
    y1: a.y + uy * (a.r + gap),
    x2: b.x - ux * (b.r + gap),
    y2: b.y - uy * (b.r + gap),
  };
}

function TreeStage({ step, active, situation }: { step: number; active: boolean; situation: string }) {
  const frames = SCRIPT[step];
  const { phase, go } = usePhase(active, frames.length, HOLDS[step], SETTLED[step]);
  const reduce = useReducedMotion();
  const frame = frames[phase];
  const lit = new Set(frame.lit);
  const ringed = new Set(frame.ringed ?? []);
  const visible = (id: NodeId) => id !== "e3" || !!frame.joined;

  return (
    <figure className="overflow-hidden rounded-xl border border-ink-line bg-ink shadow-[0_30px_70px_-40px_rgb(0_0_0/0.6)]">
      <header className="relative flex items-center gap-2 border-b border-ink-line px-4 py-3">
        <span className="size-3 rounded-full bg-warn/80" aria-hidden />
        <span className="size-3 rounded-full bg-hold/80" aria-hidden />
        <span className="size-3 rounded-full bg-ok/80" aria-hidden />
      </header>
      <div className="px-6 pt-5 md:px-8">
        <p className="font-serif text-lg tracking-[-0.01em] text-ink-text md:text-xl">{situation}</p>
        <p
          key={frame.caption}
          className="mt-2.5 flex items-center text-[15px] leading-snug text-ink-muted md:min-h-[3rem] md:motion-safe:animate-[fade-up_500ms_ease-out]"
        >
          {frame.caption}
        </p>
      </div>
      <svg
        viewBox="0 0 480 290"
        className="mx-auto block h-auto max-h-[38svh] w-full max-w-[34rem] px-4 pt-3 pb-5"
        role="img"
        aria-label={frame.caption}
      >
        {IDS.map((id) => {
          const node = NODES[id];
          if (!node.parent) return null;
          const on = lit.has(id) && lit.has(node.parent);
          return (
            <line
              key={id}
              {...segment([node.parent, id], 0)}
              className={`transition-all duration-700 ${on ? "stroke-accent/60" : "stroke-ink-line"}`}
              strokeWidth={on ? 1.5 : 1}
              opacity={visible(id) ? 1 : 0}
            />
          );
        })}

        {(frame.flows ?? []).map((edge) => (
          <Flow key={`${phase}-${edge.join("-")}`} edge={edge} moving={!reduce} />
        ))}

        {frame.blockedOut && <BlockedOut from={frame.blockedOut} />}

        {IDS.map((id) => {
          const node = NODES[id];
          const on = lit.has(id);
          const ring = ringed.has(id);
          const delay = `${node.depth * 160}ms`;
          return (
            <g key={id} className="transition-opacity duration-700" opacity={visible(id) ? 1 : 0}>
              {frame.source === id && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  className="origin-center fill-accent/40 [transform-box:fill-box] motion-safe:animate-ping"
                />
              )}
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r + 5}
                fill="none"
                strokeDasharray="3 3"
                className={`stroke-accent transition-opacity duration-700 ${ring ? "opacity-100" : "opacity-0"}`}
                style={{ transitionDelay: ring ? delay : "0ms" }}
              />
              <circle
                cx={node.x}
                cy={node.y}
                r={node.r}
                strokeWidth={1.5}
                className={`transition-colors duration-700 ${on ? "fill-accent stroke-accent" : "fill-ink stroke-ink-line"}`}
              />
              {node.name && (
                <text
                  x={node.x}
                  y={node.y + node.r + 16}
                  textAnchor="middle"
                  className={`font-sans text-[11px] transition-colors duration-700 ${on || frame.source === id ? "fill-ink-text" : "fill-ink-muted"}`}
                >
                  {node.name}
                </text>
              )}
            </g>
          );
        })}

        <text x={240} y={16} textAnchor="middle" className="fill-ink-muted font-sans text-[11px] font-semibold">
          Company
        </text>
        <text x={106} y={140} textAnchor="end" className="fill-ink-muted font-sans text-[11px] font-semibold">
          Sales
        </text>
        <text x={374} y={140} className="fill-ink-muted font-sans text-[11px] font-semibold">
          Engineering
        </text>
      </svg>

      <div className="flex items-center gap-4 border-t border-ink-line px-6 py-3 md:px-8">
        <span className="font-mono text-[10px] tracking-[0.14em] text-ink-muted uppercase">Step</span>
        <span className="flex flex-1 gap-1.5" aria-hidden>
          {frames.map((_, index) => (
            <span key={index} className="h-0.5 flex-1 overflow-hidden rounded-full bg-ink-line">
              <span
                className={`block h-full origin-left bg-accent transition-transform duration-500 ease-out ${
                  index < phase ? "scale-x-100" : index === phase ? "scale-x-100" : "scale-x-0"
                } ${index === phase ? "" : "opacity-40"}`}
              />
            </span>
          ))}
        </span>
        <span className="font-mono text-[11px] tracking-[0.08em] tabular-nums">
          <span className="text-accent">{String(phase + 1).padStart(2, "0")}</span>
          <span className="text-ink-muted"> / {String(frames.length).padStart(2, "0")}</span>
        </span>
        <span className="flex gap-1.5">
          <StepButton label="Previous step" onClick={() => go(-1)} />
          <StepButton label="Next step" onClick={() => go(1)} next />
        </span>
      </div>
    </figure>
  );
}

function StepButton({ label, onClick, next = false }: { label: string; onClick: () => void; next?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-7 place-items-center rounded-md border border-ink-line text-ink-muted transition-colors hover:border-ink-muted hover:text-ink-text focus-visible:border-accent focus-visible:text-ink-text"
    >
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-3.5 stroke-current" aria-hidden>
        <path d={next ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"} />
      </svg>
    </button>
  );
}

/** Arrowhead with its tip at the origin, pointing along +x. */
const HEAD = "M0 0 L-10 -5 L-10 5 Z";
const DRAW_MS = 1100;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * A directed edge that draws itself once: the head leads from the source and
 * the shaft bolds in behind it, then both hold.
 */
function Flow({ edge, moving }: { edge: Edge; moving: boolean }) {
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!moving) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / DRAW_MS, 1);
      setT(progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [moving]);

  const { x1, y1, x2, y2 } = segment(edge);
  const length = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  // The tip travels from one head-length out of the source to the target rim.
  const reach = 10 + (length - 10) * ease(moving ? t : 1);
  const tipX = x1 + ux * reach;
  const tipY = y1 + uy * reach;

  return (
    <g>
      <line x1={x1} y1={y1} x2={tipX - ux * 9} y2={tipY - uy * 9} strokeWidth={2.5} strokeLinecap="round" className="stroke-accent" />
      <path d={HEAD} transform={`translate(${tipX} ${tipY}) rotate(${angle})`} className="fill-accent" />
    </g>
  );
}

/** A reach beyond the company that the rule refuses, stopped short of the outside. */
function BlockedOut({ from }: { from: NodeId }) {
  const node = NODES[from];
  const boxX = node.x + 56;
  const boxY = 250;
  const stopX = node.x + 30;
  const stopY = node.y + 30;

  return (
    <g className="motion-safe:animate-[fade-up_500ms_ease-out]">
      <rect
        x={boxX}
        y={boxY}
        width={96}
        height={26}
        rx={13}
        fill="none"
        strokeDasharray="4 3"
        className="stroke-ink-line"
      />
      <text
        x={boxX + 48}
        y={boxY + 17}
        textAnchor="middle"
        className="fill-ink-muted font-sans text-[10px]"
      >
        outside service
      </text>
      <path
        d={`M${node.x + node.r * 0.7} ${node.y + node.r * 0.7} L${stopX} ${stopY}`}
        strokeWidth={2}
        strokeDasharray="4 3"
        strokeLinecap="round"
        className="stroke-warn"
      />
      <circle cx={stopX + 8} cy={stopY + 7} r={9} className="fill-warn" />
      <path
        d={`M${stopX + 4.5} ${stopY + 3.5} L${stopX + 11.5} ${stopY + 10.5} M${stopX + 11.5} ${stopY + 3.5} L${stopX + 4.5} ${stopY + 10.5}`}
        strokeWidth={1.8}
        strokeLinecap="round"
        className="stroke-ink"
      />
    </g>
  );
}

/* ---------- the growth curve under the section intro ---------- */

export function GrowthCurve() {
  const ref = useRef<SVGSVGElement>(null);
  const drawn = useInView(ref, 0.5);

  const draw = (delay: number) => ({
    strokeDasharray: 1,
    strokeDashoffset: drawn ? 0 : 1,
    transition: `stroke-dashoffset 1.6s cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms`,
  });
  const appear = `transition-opacity duration-500 ${drawn ? "opacity-100" : "opacity-0"}`;

  return (
    <figure className="rounded-2xl border border-line bg-surface p-5 md:p-6">
      <svg ref={ref} viewBox="0 0 440 230" className="block h-auto w-full" role="img" aria-label="Capability reached as decisions are made: a straight line when every relationship is approved on its own, a steepening curve when each approval is inherited below.">
        {[60, 110, 160].map((y) => (
          <line key={y} x1={30} x2={420} y1={y} y2={y} className="stroke-hairline" />
        ))}
        <line x1={30} x2={420} y1={200} y2={200} className="stroke-line" />
        <line x1={30} x2={30} y1={20} y2={200} className="stroke-line" />

        <path d="M30 200 L420 150" fill="none" pathLength={1} strokeWidth={1.5} className="stroke-faint" style={draw(0)} />
        <path
          d="M30 200 C 200 196, 320 150, 420 30"
          fill="none"
          pathLength={1}
          strokeWidth={2.5}
          strokeLinecap="round"
          className="stroke-accent"
          style={draw(250)}
        />
        <circle cx={420} cy={30} r={4} className={`fill-accent ${appear}`} style={{ transitionDelay: "1700ms" }} />

        <text x={414} y={178} textAnchor="end" className={`fill-muted font-mono text-[10px] ${appear}`} style={{ transitionDelay: "1400ms" }}>
          one relationship at a time
        </text>
        <text x={408} y={26} textAnchor="end" className={`fill-accent font-mono text-[10px] ${appear}`} style={{ transitionDelay: "1800ms" }}>
          approve once, inherit below
        </text>
        <text x={420} y={220} textAnchor="end" className="fill-faint font-mono text-[10px]">
          decisions made →
        </text>
        <text x={36} y={30} className="fill-faint font-mono text-[10px]">
          reach
        </text>
      </svg>

    </figure>
  );
}
