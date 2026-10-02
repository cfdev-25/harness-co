"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useTip } from "./use-tip";

export type ButtonVariant = "primary" | "default" | "ghost" | "danger";
export type ButtonSize = "md" | "sm" | "icon";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** The consequence, on hover and on focus (P8, 05 R4). */
  explain?: string;
  /** The only disabled state; it swaps the label, never a spinner (01 §7.1). */
  busy?: boolean;
  busyLabel?: string;
  href?: string;
  children?: ReactNode;
}

const BASE =
  "relative inline-flex cursor-pointer items-center justify-center gap-2 rounded-md text-base font-semibold whitespace-nowrap transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-45";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-accent bg-accent text-ink hover:bg-accent-deep",
  default: "border border-line bg-surface text-fg hover:border-accent",
  ghost: "border border-transparent bg-transparent text-fg hover:border-line",
  danger: "border border-warn bg-transparent text-warn hover:bg-warn-soft",
};

const SIZES: Record<ButtonSize, string> = {
  md: "h-8 px-3",
  sm: "h-6 px-2 text-xs",
  icon: "size-8",
};

export function Button(props_: ButtonProps) {
  const { variant = "default", size = "md", explain, busy = false, busyLabel,
    href, type = "button", className = "", children, ...props } = props_;
  const tip = useTip(explain);
  const classes = `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
  const label = busy ? (busyLabel ?? children) : children;
  if (href) {
    return (
      <Link href={href} className={classes} {...tip.anchor}>
        {label}
        {tip.element}
      </Link>
    );
  }
  return (
    <button type={type} className={classes} disabled={busy} {...tip.anchor} {...props}>
      {label}
      {tip.element}
    </button>
  );
}
