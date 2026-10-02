import type { InputHTMLAttributes } from "react";
import { CONTROL, LABEL } from "./control";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Field({ label, hint, error, id, ...props }: FieldProps) {
  const describedBy = error || hint ? `${id ?? props.name}-note` : undefined;
  return (
    <label className="grid gap-1">
      <span className={LABEL}>{label}</span>
      <input
        id={id}
        className={CONTROL}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {(error || hint) && (
        <span id={describedBy} className={error ? "text-xs text-warn" : "font-mono text-xs text-faint"}>
          {error ?? hint}
        </span>
      )}
    </label>
  );
}
