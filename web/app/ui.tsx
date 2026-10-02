"use client";

/* What is left of the public site's shared presentation after the console
   moved to its own component library under `app/(console)/ui` (01 §7). Only
   sign-in and the theme picker read from here now; every colour is a token
   from globals.css, and every class is a literal string, because Tailwind
   only emits what it can read in the source. */

import type { ReactNode } from "react";

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

/* Notices ----------------------------------------------------------------- */

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-[13px] text-warn">
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold tracking-[0.13em] text-accent uppercase">{children}</p>
  );
}
