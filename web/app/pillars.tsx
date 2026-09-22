"use client";

import { useRef, type ReactNode } from "react";
import { AwsLogo, ClaudeLogo, CursorLogo, GitLogo, OpenBaoLogo, PiLogo, VaultLogo } from "./logos";
import { useInView, usePhase } from "./scroll-story";

const PILLARS = [
  {
    id: "portable",
    label: "Portable",
    headline: "Write it once. Use it everywhere.",
    body: "Set up how your team works once, and it works the same in Claude Code, Cursor, Pi — or whatever your team picks up next. Nobody is tied to one vendor, and trying a new tool never means building it all again.",
  },
  {
    id: "scalable",
    label: "Scalable",
    headline: "Capability at the speed of git.",
    body: "When one person finds a better way to work, it doesn't stay with them. Pass it to the team, or to the whole company, and everyone who should have it simply has it — with a record of what changed and who approved it.",
  },
  {
    id: "secure",
    label: "Secure",
    headline: "Security you can trust.",
    body: "Keys and passwords are never handed out for keeps. People — and the agents working for them — reach sensitive systems for exactly as long as the job takes, then that access is taken back. Keep the key manager you already trust, or use ours. Nothing is left lying around.",
  },
] as const;

export function Pillars() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
      <p className="text-[11px] font-bold tracking-[0.16em] text-accent uppercase">Built on three promises</p>
      <h2 className="mt-3 max-w-4xl font-serif text-3xl tracking-[-0.03em] text-balance md:text-4xl lg:text-[2.6rem]">
        Built on trusted technology, for portability, scalability, and security.
      </h2>
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {PILLARS.map((pillar, index) => (
          <article
            key={pillar.id}
            className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_60px_-40px_rgb(0_0_0/0.35)]"
          >
            <div className="flex h-56 items-center justify-center border-b border-hairline bg-canvas/60 px-6">
              {pillar.id === "portable" ? <Portable /> : pillar.id === "scalable" ? <Scalable /> : <Secure />}
            </div>
            <div className="p-7">
              <p className="font-mono text-[11px] tracking-[0.12em] text-accent uppercase">
                {String(index + 1).padStart(2, "0")} · {pillar.label}
              </p>
              <h2 className="mt-3 font-serif text-2xl tracking-[-0.02em] text-balance">{pillar.headline}</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">{pillar.body}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ---------- portable: one definition, every agent ---------- */

const TARGETS: { name: string; mark: ReactNode }[] = [
  { name: "Claude Code", mark: <ClaudeLogo className="size-7" /> },
  { name: "Cursor", mark: <CursorLogo className="size-7 text-fg" /> },
  { name: "Pi", mark: <PiLogo className="size-7" /> },
  {
    name: "What's next",
    mark: <span className="grid size-7 place-items-center font-mono text-lg leading-none text-faint">+</span>,
  },
];

const X = [50, 150, 250, 350];

function Portable() {
  const { phase } = usePhase(true, TARGETS.length, 1800, 0);

  return (
    <div className="w-full max-w-sm">
      <div className="mx-auto w-fit rounded-full border border-line bg-surface px-4 py-1.5 font-mono text-[11px] text-fg shadow-sm">
        one harness
      </div>
      <svg viewBox="0 0 400 56" preserveAspectRatio="none" className="block h-12 w-full" aria-hidden>
        {/* the lit line is painted last, so it crosses above the others */}
        {[...X.keys()]
          .sort((a, b) => Number(a === phase) - Number(b === phase))
          .map((index) => (
            <path
              key={X[index]}
              d={`M200 0 C200 30, ${X[index]} 26, ${X[index]} 56`}
              fill="none"
              vectorEffect="non-scaling-stroke"
              strokeWidth={index === phase ? 2 : 1}
              className={`transition-colors duration-500 ${index === phase ? "stroke-accent" : "stroke-line"}`}
            />
          ))}
      </svg>
      <ul className="grid grid-cols-4 gap-2">
        {TARGETS.map((target, index) => {
          const on = index === phase;
          return (
            <li
              key={target.name}
              className={`grid justify-items-center gap-2 rounded-xl border px-1 py-3 transition-all duration-500 ${
                on ? "border-accent bg-surface shadow-sm" : "border-line bg-surface/60"
              } ${target.name === "What's next" ? "border-dashed" : ""}`}
            >
              {target.mark}
              <span className={`text-center text-[10px] leading-tight ${on ? "text-fg" : "text-muted"}`}>
                {target.name}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- scalable: a commit that travels the tree ---------- */

const LANES = [
  { id: "org", label: "org", y: 26 },
  { id: "team", label: "team", y: 62 },
  { id: "you", label: "you", y: 98 },
] as const;

const [ORG, TEAM, YOU] = LANES;
/** Where the work is done, where it is promoted, and where it comes back. */
const COMMIT = 116;
const UP_TEAM = 158;
const UP_ORG = 200;
const BACK = 250;

const SCALABLE_HOLDS = [700, 900, 900, 900, 1400, 0] as const;

function Scalable() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.5);
  // 0 lanes · 1 commit · 2 up to team · 3 up to org · 4 back down · 5 held
  const { phase } = usePhase(seen, 6, SCALABLE_HOLDS, 5, false);
  const shown = (step: number) => phase >= step;
  const draw = (step: number) =>
    `transition-[stroke-dashoffset] duration-700 ease-out ${shown(step) ? "[stroke-dashoffset:0]" : "[stroke-dashoffset:1]"}`;

  return (
    <div ref={ref} className="grid w-full max-w-sm gap-2">
      <div className="flex items-center gap-2">
        <GitLogo className="size-4" />
        <span className="font-mono text-[11px] text-muted">one shared history</span>
      </div>
      <svg viewBox="0 0 300 118" className="block h-auto w-full" aria-hidden>
        {LANES.map((lane) => (
          <g key={lane.id}>
            <line x1={44} y1={lane.y} x2={292} y2={lane.y} strokeWidth={1.5} className="stroke-line" />
            <text x={38} y={lane.y + 4} textAnchor="end" className="fill-muted font-mono text-[10px]">
              {lane.label}
            </text>
          </g>
        ))}

        {/* the work, on your own branch */}
        <circle
          cx={COMMIT}
          cy={YOU.y}
          r={5}
          strokeWidth={2}
          className={`fill-canvas stroke-accent transition-opacity duration-500 ${shown(1) ? "opacity-100" : "opacity-0"}`}
        />

        {/* promoted to the team, then shared with the org */}
        <path
          d={`M${COMMIT + 5} ${YOU.y} C${COMMIT + 26} ${YOU.y}, ${UP_TEAM - 26} ${TEAM.y}, ${UP_TEAM - 5} ${TEAM.y}`}
          fill="none"
          strokeWidth={2}
          pathLength={1}
          strokeDasharray={1}
          className={`stroke-accent ${draw(2)}`}
        />
        <circle
          cx={UP_TEAM}
          cy={TEAM.y}
          r={5}
          strokeWidth={2}
          className={`fill-canvas stroke-accent transition-opacity duration-500 ${shown(2) ? "opacity-100" : "opacity-0"}`}
        />
        <path
          d={`M${UP_TEAM + 5} ${TEAM.y} C${UP_TEAM + 26} ${TEAM.y}, ${UP_ORG - 26} ${ORG.y}, ${UP_ORG - 6} ${ORG.y}`}
          fill="none"
          strokeWidth={2}
          pathLength={1}
          strokeDasharray={1}
          className={`stroke-accent ${draw(3)}`}
        />
        <circle
          cx={UP_ORG}
          cy={ORG.y}
          r={6}
          strokeWidth={2}
          className={`stroke-accent transition-all duration-500 ${shown(3) ? "fill-accent opacity-100" : "fill-canvas opacity-0"}`}
        />

        {/* and inherited back down, by everyone */}
        <path
          d={`M${UP_ORG + 6} ${ORG.y} C${BACK - 16} ${ORG.y}, ${BACK - 8} ${TEAM.y}, ${BACK + 15} ${TEAM.y}`}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          pathLength={1}
          className={`stroke-accent transition-opacity duration-500 ${shown(4) ? "opacity-100" : "opacity-0"}`}
        />
        <path
          d={`M${BACK + 25} ${TEAM.y} C${BACK + 38} ${TEAM.y}, ${BACK + 28} ${YOU.y}, ${BACK + 37} ${YOU.y}`}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          pathLength={1}
          className={`stroke-accent transition-opacity duration-500 ${shown(4) ? "opacity-100" : "opacity-0"}`}
        />
        {[
          { x: BACK + 20, y: TEAM.y },
          { x: BACK + 42, y: YOU.y },
        ].map((landing) => (
          <circle
            key={landing.y}
            cx={landing.x}
            cy={landing.y}
            r={4.5}
            strokeWidth={2}
            className={`fill-canvas stroke-accent transition-opacity duration-500 ${shown(4) ? "opacity-100" : "opacity-0"}`}
          />
        ))}
      </svg>
      <p className="text-center font-mono text-[11px] text-faint">
        <span className={shown(1) ? "text-accent" : ""}>improve</span> →{" "}
        <span className={shown(2) ? "text-accent" : ""}>team</span> →{" "}
        <span className={shown(3) ? "text-accent" : ""}>company</span> →{" "}
        <span className={shown(4) ? "text-accent" : ""}>everyone has it</span>
      </p>
    </div>
  );
}

/* ---------- secure: where the key comes from, and how long it lives ---------- */

const KEY_MANAGERS = [
  { name: "OpenBao", mark: <OpenBaoLogo className="size-6" /> },
  { name: "AWS KMS", mark: <AwsLogo className="size-6" /> },
  { name: "HashiCorp Vault", mark: <VaultLogo className="size-6" /> },
] as const;

function Secure() {
  return (
    <ul className="grid w-full max-w-sm gap-2.5">
      {KEY_MANAGERS.map((manager) => (
        <li
          key={manager.name}
          className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-fg"
        >
          {manager.mark}
          {manager.name}
        </li>
      ))}
    </ul>
  );
}
