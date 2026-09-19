"use client";

/* Shared presentation. Every colour here is a token from globals.css, and
   every class is a literal string: Tailwind only emits what it can read in
   the source, so tones are looked up in maps rather than interpolated. */

import { ReactNode, useEffect, useRef, useState } from "react";

/* Controls ---------------------------------------------------------------- */

type ButtonVariant = "primary" | "default" | "ghost" | "bare" | "none";

/* Alignment lives in the size, not the base: `size="none"` callers lay their
   own content out, and a `justify-*` they pass cannot beat a base utility in
   the same layer — the stylesheet order decides, not the class order. */
const BUTTON_BASE =
  "inline-flex cursor-pointer rounded-md transition duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-accent bg-accent font-semibold text-ink hover:bg-accent-deep",
  default: "border border-line bg-surface text-fg hover:border-accent hover:bg-overlay",
  ghost: "border border-line bg-surface text-fg hover:border-accent",
  bare: "bg-transparent",
  none: "",
};

const BUTTON_SIZES = {
  md: "items-center justify-center gap-1.5 px-3.5 py-2.5 text-[13px] whitespace-nowrap",
  sm: "items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs whitespace-nowrap",
  icon: "size-7 items-center justify-center text-[13px]",
  none: "",
};

export function Button({
  variant = "default",
  size = "md",
  full = false,
  className = "",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
  full?: boolean;
}) {
  return (
    <button
      type={type}
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${full ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
}

export const CONTROL_CLASS =
  "w-full rounded-md border border-line bg-surface px-3 py-2.5 text-[13px] text-fg outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20";

export function Field({
  label,
  hint,
  children,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-bold tracking-[0.09em] text-muted uppercase">{label}</span>
      {children ?? <input className={CONTROL_CLASS} {...props} />}
      {hint && <span className="font-mono text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

/* Collapsed, this is one more icon button beside (?), so a page with
   nothing to search costs nothing. Typing opens it; clearing or Escape while
   empty closes it again. */
export function HeaderSearch({
  value,
  onValueChange,
  placeholder,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <Button
        size="icon"
        className="text-[17px] leading-none"
        onClick={() => setOpen(true)}
        aria-label={placeholder}
        title={placeholder}
      >
        ⌕
      </Button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="search"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (value) onValueChange("");
        else setOpen(false);
      }}
      onBlur={() => {
        if (!value) setOpen(false);
      }}
      className="w-40 rounded-md border border-accent bg-surface px-2.5 py-1 font-mono text-[11px] text-fg outline-none transition placeholder:text-faint focus:ring-3 focus:ring-accent/20"
    />
  );
}

/* Status and identifiers -------------------------------------------------- */

export function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "\u2014";
}

export function day(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function shortId(value?: string | null) {
  return value ? value.slice(0, 8) : "\u2014";
}

export type Tone = "ok" | "hold" | "warn" | "accent" | "neutral";

const BADGE_TONES: Record<Tone, string> = {
  ok: "border-ok/25 bg-ok-soft text-ok",
  hold: "border-hold/25 bg-hold-soft text-hold",
  warn: "border-warn/30 bg-warn-soft text-warn",
  accent: "border-accent/35 bg-accent-soft text-accent",
  neutral: "border-line bg-sunken text-muted",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.05em] whitespace-nowrap uppercase ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const DOT_TONES: Record<Tone, string> = {
  ok: "bg-ok",
  hold: "bg-hold",
  warn: "bg-warn",
  accent: "bg-accent",
  neutral: "bg-faint",
};

/* The halo has to be the dot's own colour, so it cannot ride on currentColor:
   the dot inherits the muted text colour of whatever encloses it. */
const DOT_GLOW: Record<Tone, string> = {
  ok: "ring-3 ring-ok/20",
  hold: "ring-3 ring-hold/20",
  warn: "ring-3 ring-warn/20",
  accent: "ring-3 ring-accent/25",
  neutral: "ring-3 ring-faint/20",
};

export function Dot({ tone = "neutral", glow = false }: { tone?: Tone; glow?: boolean }) {
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${DOT_TONES[tone]} ${glow ? DOT_GLOW[tone] : ""}`}
    />
  );
}

/* One colour per asset kind, from the asset_kinds table. */
const KIND_DOT: Record<string, string> = {
  connection: "bg-accent",
  memory: "bg-hold",
  prompt: "bg-accent-deep",
  system_prompt: "bg-ink-text",
  skill: "bg-ok",
  tool: "bg-muted",
};

export function KindTag({ kind }: { kind?: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={`size-2 shrink-0 rounded-full ${KIND_DOT[kind ?? ""] ?? "bg-faint"}`} />
      <span className="font-mono text-[11px] tracking-[0.05em] uppercase">{kind ?? "\u2014"}</span>
    </span>
  );
}

/** A bordered monospace value: refs, env vars, action names. */
export function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center truncate rounded-md border border-line bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-fg"
    >
      {children}
    </span>
  );
}

/** An unbordered monospace value: timestamps, counts, ids. */
export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="font-mono text-[11px] text-muted">
      {children}
    </span>
  );
}

/* Containers -------------------------------------------------------------- */

/* The strip above a table. The tab bar already names the collection, so this
   carries only what you act with: a filter, how many rows you are looking at,
   and the action that adds one. */
export function Toolbar({ count, actions }: { count?: ReactNode; actions?: ReactNode }) {
  if (!count && !actions) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-5 pb-3.5">
      {count && <span className="font-mono text-[11px] text-faint">{count}</span>}
      {actions && <span className="ml-auto flex items-center gap-2">{actions}</span>}
    </div>
  );
}

/** A recessed container for lists that scroll inside a panel. */
function Well({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-line bg-sunken p-1.5">{children}</div>;
}

/** The inventory pattern: many short values, scannable, capped in height. */
export function TagGrid({ items }: { items: string[] }) {
  return (
    <Well>
      <div className="grid max-h-44 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5 overflow-y-auto">
        {items.map((item) => (
          <span
            key={item}
            title={item}
            className="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-[11px]"
          >
            <Dot tone="accent" />
            <span className="truncate">{item}</span>
          </span>
        ))}
      </div>
    </Well>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="py-14 text-center font-mono text-xs text-faint">{children}</div>;
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-line bg-sunken px-4 py-3.5 text-[13px] text-muted">
      <span className="mt-1">
        <Dot tone={tone} glow />
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-[13px] text-warn">
      {children}
    </div>
  );
}

/** A collapsed detail: the payload of an audit event, a raw policy document. */
export function Disclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group min-w-0">
      <summary className="flex cursor-pointer items-center gap-1.5 text-muted select-none hover:text-fg">
        <span className="font-mono text-[10px] transition-transform group-open:rotate-90">▶</span>
        <span className="min-w-0 flex-1 truncate">{summary}</span>
      </summary>
      {children}
    </details>
  );
}

export function Json({ value }: { value: unknown }) {
  return (
    <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-sunken px-3.5 py-3 font-mono text-[11px] leading-relaxed whitespace-pre text-fg">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/* Tables ------------------------------------------------------------------ */

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-left">
        <thead>
          <tr>
            {head.map((label, index) => (
              <th
                key={index}
                scope="col"
                className="border-b border-line px-4 py-2.5 text-[10px] font-bold tracking-[0.1em] whitespace-nowrap text-muted uppercase first:pl-0 last:pr-0"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return (
    <tr className="border-b border-hairline last:border-b-0 hover:bg-sunken/70">{children}</tr>
  );
}

export function Td({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <td className={`px-4 py-3 align-top text-[13px] first:pl-0 last:pr-0 ${className}`}>
      {children}
    </td>
  );
}

/* Brand and shell --------------------------------------------------------- */

const BRAND_MASK =
  "shrink-0 bg-current [mask:url(/harness-mark.png)_center/contain_no-repeat] [-webkit-mask:url(/harness-mark.png)_center/contain_no-repeat]";

export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span
      role="img"
      aria-label="Harness Manager"
      className={small ? `inline-block h-8 w-12 ${BRAND_MASK}` : `inline-block h-12 w-18 ${BRAND_MASK}`}
    />
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold tracking-[0.13em] text-accent uppercase">{children}</p>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-black/50 p-5 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="max-h-[min(720px,90vh)] w-full max-w-[540px] overflow-auto rounded-xl border border-line bg-overlay shadow-[0_16px_64px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 flex items-center justify-between gap-4 border-b border-line bg-overlay px-5 py-4">
          <h2 className="text-[13px] font-bold tracking-[0.06em] uppercase">{title}</h2>
          <Button
            variant="bare"
            size="none"
            className="items-center justify-center px-2 py-0.5 text-xl text-muted hover:text-fg"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </Button>
        </header>
        {children}
      </section>
    </div>
  );
}

/* The CLI is the product's front door, so the thing you copy has to be the
   thing you run — not a token you then have to assemble a command around. */
export function CommandBlock({
  label,
  command,
  hint,
}: {
  label: string;
  command: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-bold tracking-[0.13em] text-muted uppercase">
          {label}
        </span>
        {hint && <span className="font-mono text-[11px] text-faint">{hint}</span>}
      </div>
      <div className="flex min-w-0 items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-sunken px-3 py-2.5 font-mono text-[11px] whitespace-pre text-fg">
          {command}
        </code>
        <Button
          variant={copied ? "default" : "primary"}
          className={copied ? "shrink-0 border-ok/40 bg-ok-soft text-ok" : "shrink-0"}
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
