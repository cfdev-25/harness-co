import type { ReactNode, SelectHTMLAttributes } from "react";
import { CONTROL, LABEL } from "./control";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  /**
   * The label is read but not drawn: a select inside a table cell or a
   * toolbar whose column heading already names it. It stays in the accessible
   * name (01 §11) — it is never simply dropped.
   */
  labelHidden?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function Select({ label, labelHidden, hint, error, children, ...props }: SelectProps) {
  return (
    <label className="grid gap-1">
      <span className={labelHidden ? "sr-only" : LABEL}>{label}</span>
      <select className={CONTROL} aria-invalid={error ? true : undefined} {...props}>
        {children}
      </select>
      {(error || hint) && (
        <span className={error ? "text-xs text-warn" : "font-mono text-xs text-faint"}>
          {error ?? hint}
        </span>
      )}
    </label>
  );
}
